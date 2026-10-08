import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantEntry, createRegistry, Harness, type Conversation, watchEvents } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type {
  ConfiguredProvider,
  ModelSelection,
  RunExecutionContext,
  RunControlAction,
  RunInput,
  RunReceipt,
  RunRecord,
  RunResponse,
  RuntimeConfig,
} from "./types.js";
import { RunStore, type StoredRunInput } from "./run-store.js";
import { PlatformClient } from "./platform-client.js";
import { createPlatformTools } from "./platform-tools.js";
import { registerConfiguredProvider, type ConfiguredModelRegistration } from "./configured-provider.js";
import { createMcpExtension } from "./mcp-tools.js";
import { createSandboxExtension } from "./sandbox-tools.js";
import { SandboxClient } from "./sandbox-client.js";

interface AgentSession {
  readonly harness: Harness;
  readonly conversation: Conversation;
}

export class RunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunConflictError";
  }
}

const DEFAULT_EXECUTION_CONFIG = {
  instructions: "",
  tool_connection_ids: [],
  sandbox_profile_id: null,
  limits: { max_turns: 20, timeout_seconds: 600 },
} as const;
const BASE_INSTRUCTIONS = "You are an Ordivant project agent. Use scoped platform tools for task context and collaboration. Submit factual findings; never approve your own work.";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class RunStoppedError extends Error {}
class RunCheckpointError extends Error {}

function assistantText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("\n");
}

function normalizeInput(value: unknown): RunInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object");
  const body = value as Record<string, unknown>;
  const fields = ["request_id", "task_id", "agent_id", "prompt"] as const;
  for (const field of fields) {
    if (typeof body[field] !== "string" || body[field].length < 1 || body[field].length > (field === "prompt" ? 100_000 : 200)) {
      throw new Error(`${field} is required and must be a valid string`);
    }
  }
  if (body.model !== undefined && (typeof body.model !== "string" || body.model.length > 300)) {
    throw new Error("model must be a string of at most 300 characters");
  }
  let modelConfig: ModelSelection | null | undefined;
  if (body.model_config !== undefined) {
    if (body.model_config === null) {
      modelConfig = null;
    } else if (body.model_config && typeof body.model_config === "object" && !Array.isArray(body.model_config)) {
      const selection = body.model_config as Record<string, unknown>;
      const efforts = ["low", "medium", "high", "xhigh", "max"];
      if (typeof selection.provider_id !== "string" || selection.provider_id.length < 1 || selection.provider_id.length > 200 ||
          typeof selection.model_id !== "string" || selection.model_id.length < 1 || selection.model_id.length > 300 ||
          typeof selection.reasoning_effort !== "string" || !efforts.includes(selection.reasoning_effort) ||
          typeof selection.max_output_tokens !== "number" || !Number.isInteger(selection.max_output_tokens)) {
        throw new Error("model_config is invalid");
      }
      modelConfig = {
        provider_id: selection.provider_id,
        model_id: selection.model_id,
        reasoning_effort: selection.reasoning_effort as ModelSelection["reasoning_effort"],
        max_output_tokens: selection.max_output_tokens,
      };
    } else {
      throw new Error("model_config is invalid");
    }
  }
  const executionConfig = body.execution_config;
  if (executionConfig !== undefined && (!executionConfig || typeof executionConfig !== "object" || Array.isArray(executionConfig))) {
    throw new Error("execution_config is invalid");
  }
  const toolConnections = body.tool_connections;
  if (toolConnections !== undefined && (!Array.isArray(toolConnections) || toolConnections.length > 20)) {
    throw new Error("tool_connections is invalid");
  }
  const sandboxProfile = body.sandbox_profile;
  if (sandboxProfile !== undefined && sandboxProfile !== null && (!sandboxProfile || typeof sandboxProfile !== "object" || Array.isArray(sandboxProfile))) {
    throw new Error("sandbox_profile is invalid");
  }
  return {
    request_id: body.request_id as string,
    task_id: body.task_id as string,
    agent_id: body.agent_id as string,
    prompt: body.prompt as string,
    ...(typeof body.model === "string" ? { model: body.model } : {}),
    ...(modelConfig === undefined ? {} : { model_config: modelConfig }),
    ...(typeof body.execution_id === "string" || body.execution_id === null ? { execution_id: body.execution_id } : {}),
    ...(typeof body.retry_of === "string" || body.retry_of === null ? { retry_of: body.retry_of } : {}),
    ...(executionConfig !== undefined ? { execution_config: executionConfig as RunInput["execution_config"] } : {}),
    ...(Array.isArray(toolConnections) ? { tool_connections: toolConnections as RunInput["tool_connections"] } : {}),
    ...(sandboxProfile !== undefined ? { sandbox_profile: sandboxProfile as RunInput["sandbox_profile"] } : {}),
  };
}

export class RuntimeEngine {
  readonly store: RunStore;
  readonly #models = createModels();
  readonly #registry = createRegistry();
  readonly #client: PlatformClient;
  readonly #sandboxClient: SandboxClient;
  readonly #sessions = new Map<string, Promise<AgentSession>>();
  readonly #runPromises = new Map<string, Promise<void>>();
  readonly #agentQueues = new Map<string, Promise<void>>();
  readonly #executionContexts = new Map<string, RunExecutionContext>();
  readonly #configuredModels = new Map<string, ConfiguredModelRegistration>();
  readonly #activeRunsByConversation = new Map<string, RunExecutionContext & {
    request_id: string;
    task_id: string;
    agent_id: string;
  }>();
  readonly #platformExtension;
  readonly #sandboxExtension;
  readonly #demoModelRef = { provider: "ordivant-demo", modelId: "deterministic-v1" };
  #closed = false;

  constructor(readonly config: RuntimeConfig) {
    mkdirSync(config.runtimeDir, { recursive: true });
    this.store = new RunStore(join(config.runtimeDir, "runs.sqlite"));
    this.#client = new PlatformClient(config);
    this.#sandboxClient = new SandboxClient(config);

    const faux = fauxProvider({
      provider: "ordivant-demo",
      models: [{ id: "deterministic-v1", name: "Ordivant deterministic demo", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      tokenSize: { min: 4096, max: 4096 },
    });
    const responder: FauxResponseFactory = (context) => {
      faux.appendResponses([responder]);
      const input = [...context.messages].reverse().find((message) => message.role === "user");
      const prompt = typeof input?.content === "string" ? input.content : JSON.stringify(input?.content ?? "");
      const lastUserIndex = context.messages.findLastIndex((message) => message.role === "user");
      const taskContextAlreadyRead = context.messages
        .slice(lastUserIndex + 1)
        .some((message) => message.role === "toolResult");
      if (prompt.includes("get_task_context") && !taskContextAlreadyRead) {
        return fauxAssistantMessage(fauxToolCall("get_task_context", {}), { stopReason: "toolUse" });
      }
      const digest = createHash("sha256").update(prompt).digest("hex");
      return fauxAssistantMessage(
        `DEMO MODE deterministic receipt\nNo paid model was called and this output does not claim task completion.\nInput characters: ${prompt.length}\nInput SHA-256: ${digest}`,
      );
    };
    faux.setResponses([responder]);
    this.#models.setProvider(faux.provider);
    this.#platformExtension = createPlatformTools(this.#client, (conversationId) =>
      this.#activeRunsByConversation.get(conversationId));
    this.#registry.install(this.#platformExtension);
    this.#sandboxExtension = createSandboxExtension(this.#sandboxClient, (conversationId) =>
      this.#activeRunsByConversation.get(conversationId));
    this.#registry.install(this.#sandboxExtension);
  }

  async enqueue(
    value: unknown,
    executionContext?: RunExecutionContext,
    configuredProvider?: ConfiguredProvider,
  ): Promise<RunResponse> {
    if (this.#closed) throw new Error("Runtime is closing");
    const input = normalizeInput(value);
    const isLive = input.model_config !== undefined && input.model_config !== null;
    if (isLive && !configuredProvider) throw new Error("Configured provider credentials are required for this model selection");
    if (!isLive && this.config.mode !== "demo") throw new Error("Live runtime requires a configured outbox model selection");
    const registration = isLive
      ? registerConfiguredProvider(this.#models, input.request_id, input.model_config!, configuredProvider!)
      : undefined;
    const storedInput: StoredRunInput = {
      ...input,
      mode: isLive ? "live" : "demo",
      ...(executionContext?.project_id ? { project_id: executionContext.project_id } : {}),
    };
    let reserved: { record: RunRecord; created: boolean };
    try {
      const session = await this.#sessionFor(input.agent_id);
      reserved = this.store.reserve(storedInput, String(session.conversation.id));
      if (executionContext?.desired_action && executionContext.control_revision && executionContext.control_revision > reserved.record.control_revision) {
        this.store.setControl(input.request_id, executionContext.desired_action, executionContext.control_revision);
      }
      if (registration && (reserved.record.status === "queued" || reserved.record.status === "running" || reserved.record.status === "paused")) {
        this.#configuredModels.set(input.request_id, registration);
      } else if (registration) {
        this.#models.deleteProvider(registration.providerId);
      }
      if (executionContext) this.#mergeExecutionContext(input.request_id, executionContext);
      if (reserved.record.status === "queued" || reserved.record.status === "running" || reserved.record.status === "paused") this.#schedule(reserved.record, session);
    } catch (error) {
      if (registration) this.#models.deleteProvider(registration.providerId);
      if (error instanceof Error && error.message.includes("request_id was already used")) {
        throw new RunConflictError(error.message);
      }
      throw error;
    }

    return this.#response(this.store.get(input.request_id) ?? reserved.record);
  }

  async resume(requestId: string, executionContext?: RunExecutionContext): Promise<RunResponse | undefined> {
    const record = this.store.get(requestId);
    if (!record) return undefined;
    if (executionContext) this.#mergeExecutionContext(requestId, executionContext);
    if (record.mode === "live" && !this.#configuredModels.has(requestId)) return this.#response(record);
    if (record.status === "queued" || record.status === "running" || record.status === "paused") {
      if (record.status === "paused" && !this.#executionContexts.has(requestId)) {
        this.store.setStatus(requestId, "failed", { error: "Run could not resume because its fenced execution lease was not recovered." });
        return this.#response(this.store.get(requestId)!);
      }
      const session = await this.#sessionFor(record.agent_id);
      this.#schedule(record, session);
    }
    return this.#response(this.store.get(requestId) ?? record);
  }

  async resumePending(): Promise<void> {
    for (const record of this.store.pending()) {
      if (record.mode === "live") continue;
      await this.resume(record.request_id);
    }
  }

  async waitFor(requestId: string): Promise<RunRecord | undefined> {
    const work = this.#runPromises.get(requestId);
    if (work) await work;
    return this.store.get(requestId);
  }

  async abort(requestId: string): Promise<RunRecord | undefined> {
    const record = this.store.get(requestId);
    if (!record) return undefined;
    if (record.status === "done" || record.status === "failed" || record.status === "aborted") return record;
    const session = await this.#sessionFor(record.agent_id);
    const context = this.#executionContexts.get(requestId);
    context?.wakeControlGate?.();
    const active = this.#activeRunsByConversation.get(String(session.conversation.id));
    if (active?.request_id !== requestId) {
      this.store.setStatus(requestId, "aborted", { error: "Run was cancelled before it started" });
      return this.store.get(requestId);
    }
    try {
      await session.conversation.abort(BACKGROUND_CONTEXT);
      this.store.setStatus(requestId, "aborted", { error: "Run aborted" });
    } catch {
      this.store.setStatus(requestId, "failed", { error: "Run could not be aborted cleanly" });
    }
    return this.store.get(requestId);
  }

  async applyControl(requestId: string, action: Exclude<RunControlAction, "retry">, revision: number): Promise<void> {
    if (!this.store.setControl(requestId, action, revision)) return;
    const context = this.#executionContexts.get(requestId);
    if (context) {
      context.desired_action = action;
      context.control_revision = revision;
      if (action === "resume") context.wakeControlGate?.();
    }
    if (action === "stop") await this.abort(requestId);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled([...this.#runPromises.values()]);
    const sessions = await Promise.allSettled([...this.#sessions.values()]);
    for (const result of sessions) {
      if (result.status === "fulfilled") await result.value.harness.close(BACKGROUND_CONTEXT);
    }
    this.store.close();
  }

  #mergeExecutionContext(requestId: string, next: RunExecutionContext): void {
    const current = this.#executionContexts.get(requestId);
    if (!current) {
      this.#executionContexts.set(requestId, next);
      for (const active of this.#activeRunsByConversation.values()) {
        if (active.request_id === requestId) Object.assign(active, next);
      }
      return;
    }
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined) (current as unknown as Record<string, unknown>)[key] = value;
    }
    for (const active of this.#activeRunsByConversation.values()) {
      if (active.request_id === requestId) Object.assign(active, current);
    }
  }

  #schedule(record: RunRecord, session: AgentSession): void {
    if (this.#runPromises.has(record.request_id)) return;
    const previous = this.#agentQueues.get(record.agent_id) ?? Promise.resolve();
    const run = previous.then(() => this.#execute(record, session));
    const queueTail = run.then(() => undefined, () => undefined);
    this.#agentQueues.set(record.agent_id, queueTail);
    this.#runPromises.set(record.request_id, run);
    const cleanup = () => {
      if (this.#runPromises.get(record.request_id) === run) this.#runPromises.delete(record.request_id);
      if (this.#agentQueues.get(record.agent_id) === queueTail) this.#agentQueues.delete(record.agent_id);
    };
    void run.then(cleanup, cleanup);
  }

  async #execute(record: RunRecord, session: AgentSession): Promise<void> {
    const current = this.store.get(record.request_id);
    if (!current || current.status === "aborted" || current.status === "done" || current.status === "failed") return;
    const context = this.#executionContexts.get(record.request_id);
    if (!context && record.execution_id) {
      this.store.setStatus(record.request_id, "failed", { error: "Run could not resume because its fenced execution lease was not recovered." });
      return;
    }
    const activeRun = Object.assign(context ?? {}, {
      request_id: record.request_id,
      task_id: record.task_id,
      agent_id: record.agent_id,
      project_id: context?.project_id ?? record.project_id,
    }) as RunExecutionContext & { request_id: string; task_id: string; agent_id: string };
    activeRun.recordSandboxEvidence = (evidence) => {
      this.store.saveSandboxEvidence(record.request_id, evidence);
      if (evidence.operation !== "execute") return;
      const event: Record<string, unknown> = {};
      for (const key of ["operation", "path", "exit_code", "timed_out", "truncated", "duration_seconds", "bytes_written"]) {
        if (evidence[key] !== undefined) event[key] = evidence[key];
      }
      if (typeof evidence.stdout === "string") event.observed = evidence.stdout.slice(0, 500);
      if (typeof evidence.stderr === "string") event.diagnostic = evidence.stderr.slice(0, 500);
      this.store.appendEvent(record.request_id, "sandbox", event);
    };
    this.#activeRunsByConversation.set(String(session.conversation.id), activeRun);
    const parsedStartedAt = current.started_at ? Date.parse(current.started_at) : NaN;
    const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now();
    const deadlineAt = startedAt + (record.execution_config ?? DEFAULT_EXECUTION_CONFIG).limits.timeout_seconds * 1000;
    const originalLeaseCheck = context?.assertLease;
    if (context) {
      context.abortRun = async () => session.conversation.abort(BACKGROUND_CONTEXT).catch(() => undefined);
      context.beforeToolOperation = async () => this.#toolGate(record.request_id, context, deadlineAt);
      context.assertLease = async () => {
        if (context.lease_lost) throw new RunStoppedError("The task execution lease is no longer valid");
        try {
          await originalLeaseCheck?.();
        } catch {
          context.lease_lost = true;
          await context.abortRun?.();
          throw new RunStoppedError("The task execution lease is no longer valid");
        }
      };
    }
    let installedMcpExtensionName: string | undefined;
    try {
      this.#assertSandboxCheckpoint(record, context);
      const registration = record.mode === "live" ? this.#configuredModels.get(record.request_id) : undefined;
      if (record.mode === "live" && !registration) return;
      const modelRef = registration?.modelRef ?? this.#demoModelRef;
      const thinkingLevel = record.mode === "live" ? record.model_config!.reasoning_effort : "off";
      const resolvedAgent = await session.conversation.agent(BACKGROUND_CONTEXT);
      const executionConfig = record.execution_config ?? DEFAULT_EXECUTION_CONFIG;
      const connections = context?.tool_connections ?? [];
      const mcpExtension = connections.length ? await createMcpExtension(record.request_id, connections, this.config, (conversationId) =>
        this.#activeRunsByConversation.get(conversationId)) : undefined;
      if (mcpExtension) {
        this.#registry.install(mcpExtension);
        installedMcpExtensionName = mcpExtension.name;
      }
      if (context?.sandbox_profile && this.config.sandboxUrl) {
        try {
          const created = await this.#sandboxClient.create(record.request_id, context.sandbox_profile);
          context.sandbox_capability = created.token;
          context.sandbox_summary = { run_id: record.request_id, status: "ready", workspace_available: true };
          this.store.setSandbox(record.request_id, context.sandbox_summary);
        } catch {
          context.sandbox_summary = { run_id: record.request_id, status: "failed", workspace_available: false };
          this.store.setSandbox(record.request_id, context.sandbox_summary);
          throw new Error("Sandbox workspace could not be started");
        }
      }
      const instructions = [BASE_INSTRUCTIONS, executionConfig.instructions].filter(Boolean).join("\n\n");
      const extensions = [this.#platformExtension, ...(context?.sandbox_capability ? [this.#sandboxExtension] : []), ...(mcpExtension ? [mcpExtension] : [])];
      if (resolvedAgent.model?.provider !== modelRef.provider || resolvedAgent.model.modelId !== modelRef.modelId ||
          resolvedAgent.thinkingLevel !== thinkingLevel || resolvedAgent.instructions !== instructions ||
          resolvedAgent.extensions.map((item) => item.name).join("\0") !== extensions.map((item) => item.name).join("\0")) {
        await session.conversation.configure({ model: modelRef, thinkingLevel, instructions, extensions }, BACKGROUND_CONTEXT);
      }
      session.harness.resume();
      await this.#toolGate(record.request_id, context, deadlineAt);
      this.#assertSandboxCheckpoint(record, context);
      this.store.appendEvent(record.request_id, "start", { mode: record.mode, execution_id: record.execution_id });
      const eventStream = await watchEvents(session.harness, session.conversation.id, BACKGROUND_CONTEXT);
      let resolveRunEnd!: () => void;
      const runEnded = new Promise<void>((resolve) => { resolveRunEnd = resolve; });
      let turnCount = record.turn_count;
      eventStream.start(async (events) => {
        let sawRunEnd = false;
        for (const event of events) {
          if (event.type === "turn_start") {
            turnCount = this.store.incrementTurnCount(record.request_id);
            if (turnCount > executionConfig.limits.max_turns) {
              if (context) context.turn_limit_exceeded = true;
              await session.conversation.abort(BACKGROUND_CONTEXT).catch(() => undefined);
            }
            this.store.appendEvent(record.request_id, "model", { phase: "turn_start", turn: turnCount });
          } else if (event.type === "tool_execution_start") {
            this.store.appendEvent(record.request_id, "tool_start", { tool_name: event.toolName, tool_call_id: event.toolCallId });
          } else if (event.type === "tool_execution_end") {
            this.store.appendEvent(record.request_id, "tool_end", { tool_name: event.toolName, tool_call_id: event.toolCallId, completed: Boolean(event.entry) });
          } else if (event.type === "message_end") {
            const message = event.entry.model?.[0] as AssistantMessage | undefined;
            if (message?.role === "assistant") this.store.appendEvent(record.request_id, "model", { stop_reason: message.stopReason, usage: message.usage });
          } else if (event.type === "task_failed") {
            this.store.appendEvent(record.request_id, "error", { kind: event.kind, message: event.message });
          } else if (event.type === "run_end") {
            sawRunEnd = true;
          }
        }
        if (sawRunEnd) resolveRunEnd();
      });
      const submission = await session.conversation.submit({
        type: "input",
        content: record.prompt,
        requestId: record.request_id,
        whenBusy: "followUp",
      }, BACKGROUND_CONTEXT);
      this.store.setSubmission(record.request_id, String(submission.id));
      const remainingMs = Math.max(1, deadlineAt - Date.now());
      const deadline = setTimeout(() => void session.conversation.abort(BACKGROUND_CONTEXT).catch(() => undefined), remainingMs);
      const settled = await submission.wait(BACKGROUND_CONTEXT);
      clearTimeout(deadline);
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        runEnded,
        eventStream.closed,
        new Promise<void>((resolve) => {
          drainTimer = setTimeout(resolve, Math.min(1_000, Math.max(1, deadlineAt - Date.now())));
        }),
      ]);
      if (drainTimer) clearTimeout(drainTimer);
      await eventStream.stop();
      if (settled.status === "unanswered") {
        const stopped = context?.desired_action === "stop" || this.store.get(record.request_id)?.desired_action === "stop";
        const aborted = stopped || /abort/i.test(settled.reason);
        const error = context?.turn_limit_exceeded
          ? `Run exceeded its ${executionConfig.limits.max_turns} turn limit`
          : Date.now() >= deadlineAt
            ? "Run exceeded its global execution timeout"
            : stopped
              ? "Run stopped"
              : aborted
                ? "Run aborted"
                : "Pi Durable did not produce an answer";
        this.store.setStatus(record.request_id, aborted ? "aborted" : "failed", {
          error,
        });
        return;
      }
      if (!settled.answer) throw new Error("Pi Durable submission settled without an answer entry");
      const answerEntry = await session.conversation.commit(
        (tx) => tx.entry(AssistantEntry, settled.answer!),
        BACKGROUND_CONTEXT,
      );
      const answer = assistantText(answerEntry?.model?.[0]);
      const receipt = await this.#buildReceipt(
        record,
        session.conversation,
        settled.entry,
        settled.answer,
        registration?.actualModelIds.at(-1) ?? null,
      );
      this.store.setStatus(record.request_id, "done", { answer, receipt });
    } catch (error) {
      const stopped = context?.desired_action === "stop" || this.store.get(record.request_id)?.desired_action === "stop";
      const status = stopped ? "aborted" : "failed";
      const message = error instanceof RunStoppedError
        ? "Execution lease was lost; the run stopped safely."
        : error instanceof RunCheckpointError
          ? error.message
          : error instanceof Error && /timeout/i.test(error.message)
            ? "Run exceeded its global execution timeout"
            : "Pi Durable run failed";
      this.store.setStatus(record.request_id, status, { error: message });
    } finally {
      const active = this.#activeRunsByConversation.get(String(session.conversation.id));
      if (active?.request_id === record.request_id && active.sandbox_capability) {
        try {
          await this.#sandboxClient.stop(record.request_id, active.sandbox_capability);
          const stopped = { run_id: record.request_id, status: "stopped" as const, workspace_available: false };
          active.sandbox_summary = stopped;
          this.store.setSandbox(record.request_id, stopped);
        } catch {
          const cleanupUnconfirmed = { run_id: record.request_id, status: "failed" as const, workspace_available: false };
          active.sandbox_summary = cleanupUnconfirmed;
          this.store.setSandbox(record.request_id, cleanupUnconfirmed);
          this.store.appendEvent(record.request_id, "error", {
            kind: "sandbox_cleanup_unconfirmed",
            message: "沙箱清理尚未確認，請由操作者檢查執行器。",
          });
        }
      }
      if (installedMcpExtensionName) this.#registry.uninstall({ name: installedMcpExtensionName });
      if (this.#activeRunsByConversation.get(String(session.conversation.id))?.request_id === record.request_id) {
        this.#activeRunsByConversation.delete(String(session.conversation.id));
      }
      const registration = this.#configuredModels.get(record.request_id);
      if (registration) this.#models.deleteProvider(registration.providerId);
      this.#configuredModels.delete(record.request_id);
      if (this.store.get(record.request_id)?.status !== "paused") this.#executionContexts.delete(record.request_id);
    }
  }

  async #toolGate(requestId: string, context: RunExecutionContext | undefined, deadlineAt: number): Promise<void> {
    while (true) {
      if (Date.now() >= deadlineAt) throw new Error("Run exceeded its global execution timeout");
      const record = this.store.get(requestId);
      if (!record || record.status === "aborted" || record.desired_action === "stop" || context?.desired_action === "stop") {
        throw new RunStoppedError("Run was stopped");
      }
      if (context?.lease_lost) throw new RunStoppedError("Execution lease was lost");
      if (context?.assertLease) await context.assertLease();
      const action = record.desired_action ?? context?.desired_action ?? null;
      if (action !== "pause") {
        if (record.status === "paused") this.store.setStatus(requestId, "running");
        return;
      }
      if (record.status !== "paused") this.store.setStatus(requestId, "paused");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (context?.wakeControlGate === wake) context.wakeControlGate = undefined;
          resolve();
        }, 1_000);
        const wake = () => {
          clearTimeout(timer);
          if (context?.wakeControlGate === wake) context.wakeControlGate = undefined;
          resolve();
        };
        if (context) context.wakeControlGate = wake;
      });
    }
  }

  #assertSandboxCheckpoint(record: RunRecord, context: RunExecutionContext | undefined): void {
    if (!this.store.get(record.request_id)?.sandbox?.workspace_available || context?.sandbox_capability) return;
    const lostSandbox = { run_id: record.request_id, status: "lost" as const, workspace_available: false };
    context && (context.sandbox_summary = lostSandbox);
    this.store.setSandbox(record.request_id, lostSandbox);
    throw new RunCheckpointError("Sandbox workspace was lost during runtime recovery; retry to create a new run.");
  }

  async #buildReceipt(
    record: RunRecord,
    conversation: Conversation,
    firstEntryId: Parameters<Conversation["entries"]>[0]["minEntryId"],
    finalEntryId: Parameters<Conversation["entries"]>[0]["maxEntryId"],
    actualModelId: string | null,
  ): Promise<RunReceipt> {
    const assistantMessages: AssistantMessage[] = [];
    let cursor: Parameters<Conversation["entries"]>[2];
    do {
      const page = await conversation.entries(
        { minEntryId: firstEntryId, maxEntryId: finalEntryId },
        500,
        cursor,
        BACKGROUND_CONTEXT,
      );
      for (const entry of page.items) {
        for (const message of entry.model ?? []) {
          if (message.role === "assistant") assistantMessages.push(message as AssistantMessage);
        }
      }
      cursor = page.next;
    } while (cursor);

    const toolCounts = new Map<string, number>();
    for (const message of assistantMessages) {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        toolCounts.set(block.name, (toolCounts.get(block.name) ?? 0) + 1);
      }
    }
    const tools = [...toolCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, calls]) => ({ name, calls }));
    if (record.mode !== "live" || !record.model_config) {
      return { mode: "demo", requested: null, returned: null, usage: null, tools, cost_usd: null };
    }

    let uncachedInputTokens = 0;
    let cachedInputTokens = 0;
    let cacheWriteTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let uncachedInputsComplete = assistantMessages.length > 0;
    let cachedInputsComplete = assistantMessages.length > 0;
    let cacheWritesComplete = assistantMessages.length > 0;
    let outputsComplete = assistantMessages.length > 0;
    let totalsComplete = assistantMessages.length > 0;
    for (const message of assistantMessages) {
      const usage = message.usage as unknown as Record<string, unknown> | undefined;
      if (typeof usage?.input === "number" && Number.isFinite(usage.input)) uncachedInputTokens += usage.input;
      else uncachedInputsComplete = false;
      if (typeof usage?.cacheRead === "number" && Number.isFinite(usage.cacheRead)) cachedInputTokens += usage.cacheRead;
      else cachedInputsComplete = false;
      if (typeof usage?.cacheWrite === "number" && Number.isFinite(usage.cacheWrite)) cacheWriteTokens += usage.cacheWrite;
      else cacheWritesComplete = false;
      if (typeof usage?.output === "number" && Number.isFinite(usage.output)) outputTokens += usage.output;
      else outputsComplete = false;
      if (typeof usage?.totalTokens === "number" && Number.isFinite(usage.totalTokens)) totalTokens += usage.totalTokens;
      else totalsComplete = false;
    }
    const inputsComplete = uncachedInputsComplete && cachedInputsComplete && cacheWritesComplete;
    const inputTokens = inputsComplete ? uncachedInputTokens + cachedInputTokens + cacheWriteTokens : null;
    if (!totalsComplete && inputTokens !== null && outputsComplete) totalTokens = inputTokens + outputTokens;

    return {
      mode: "live",
      requested: record.model_config,
      returned: actualModelId
        ? { provider_id: record.model_config.provider_id, model_id: actualModelId }
        : null,
      usage: assistantMessages.length > 0
        ? {
            input_tokens: inputTokens,
            uncached_input_tokens: uncachedInputsComplete ? uncachedInputTokens : null,
            cached_input_tokens: cachedInputsComplete ? cachedInputTokens : null,
            cache_write_tokens: cacheWritesComplete ? cacheWriteTokens : null,
            output_tokens: outputsComplete ? outputTokens : null,
            total_tokens: totalsComplete || (inputsComplete && outputsComplete) ? totalTokens : null,
          }
        : null,
      tools,
      cost_usd: null,
    };
  }

  async #sessionFor(agentId: string): Promise<AgentSession> {
    const pending = this.#sessions.get(agentId);
    if (pending) return pending;
    const creating = this.#openSession(agentId);
    this.#sessions.set(agentId, creating);
    try {
      return await creating;
    } catch (error) {
      if (this.#sessions.get(agentId) === creating) this.#sessions.delete(agentId);
      throw error;
    }
  }

  async #openSession(agentId: string): Promise<AgentSession> {
    const filename = `agent-${createHash("sha256").update(agentId).digest("hex").slice(0, 24)}.sqlite`;
    const harness = await Harness.open(
      await openNodeSqliteStorage(join(this.config.runtimeDir, filename)),
      {
        models: this.#models,
        registry: this.#registry,
        settings: { retry: { enabled: false, maxRetries: 0 } },
      },
      BACKGROUND_CONTEXT,
    );
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: {
        model: this.#demoModelRef,
        thinkingLevel: "off",
        extensions: [this.#platformExtension],
        instructions: "You are an Ordivant project agent. Use scoped platform tools for task context and collaboration. Submit factual findings; never approve your own work.",
      },
    });
    return { harness, conversation };
  }

  #response(record: RunRecord): RunResponse {
    return {
      request_id: record.request_id,
      conversation_id: record.conversation_id,
      submission_id: record.submission_id,
      status: record.status,
      receipt: record.receipt,
    };
  }
}
