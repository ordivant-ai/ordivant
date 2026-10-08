import { randomUUID } from "node:crypto";
import { PlatformClient, PlatformError } from "./platform-client.js";
import { RuntimeEngine } from "./engine.js";
import type {
  ClaimResponse,
  ConfiguredProvider,
  ExecutionConfig,
  ModelSelection,
  OutboxConfiguration,
  OutboxEvent,
  RunExecutionContext,
  RunRecord,
  RunStatus,
  RuntimeEvent,
  RuntimeConfig,
  SandboxProfile,
  ToolConnectionCredential,
} from "./types.js";
import { assertToolEndpointAllowed } from "./tool-policy.js";

interface DispatcherOptions {
  readonly pollIntervalMs?: number;
  readonly leaseSeconds?: number;
  readonly outboxLimit?: number;
  readonly outboxLeaseHeartbeatMs?: number;
  readonly workflowTickIntervalMs?: number;
  readonly controlPollIntervalMs?: number;
  readonly syncIntervalMs?: number;
}

interface LeaseHeartbeat {
  stop(): Promise<void>;
  assertHealthy(): void;
}

interface RuntimeRunControl {
  id: string;
  desired_action: "pause" | "resume" | "stop";
  control_revision: number;
}

interface ActiveDispatch {
  event: OutboxEvent;
  desired_action: RuntimeRunControl["desired_action"] | null;
  control_revision: number;
  context?: RunExecutionContext;
  wake?: () => void;
}

interface SyncDraft {
  sequence: number;
  body: Record<string, unknown>;
  event_sequence: number;
}

interface ExecutionLeaseHandoff {
  task_id: string;
  execution_id: string;
  agent_id: string;
  lease_token: string;
  expires_at: string;
}

interface DispatcherHandoff extends OutboxConfiguration {
  execution_lease?: ExecutionLeaseHandoff;
}

interface TaskSubmissionBody {
  execution_id?: string;
  lease_token?: string;
  summary: string;
  artifacts: Array<{ kind: string; title: string; content: string }>;
}

function taskPrompt(task: ClaimResponse["task"], payload: Record<string, unknown>): string {
  const extra = typeof payload.prompt === "string" ? payload.prompt : undefined;
  const criteria = Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria : [];
  return [
    `Task: ${task.title}`,
    `Goal: ${task.goal}`,
    task.description ? `Description: ${task.description}` : undefined,
    task.inputs ? `Inputs: ${task.inputs}` : undefined,
    task.scope ? `Scope: ${task.scope}` : undefined,
    task.constraints ? `Constraints: ${task.constraints}` : undefined,
    criteria.length > 0 ? `Acceptance criteria:\n${criteria.map((item) => `- ${item}`).join("\n")}` : undefined,
    extra ? `Dispatch instructions:\n${extra}` : undefined,
    "Use scoped Ordivant tools for authorized task context and collaboration. Do not claim work or verification you did not perform.",
  ].filter(Boolean).join("\n\n");
}

function validateEvent(value: unknown): OutboxEvent {
  if (!value || typeof value !== "object") throw new Error("Invalid outbox event");
  const event = value as Record<string, unknown>;
  for (const field of ["id", "project_id", "task_id", "agent_id", "delivery_token"] as const) {
    if (typeof event[field] !== "string" || !event[field]) throw new Error("Invalid outbox event");
  }
  if (event.type !== "run_task") throw new Error("Unsupported outbox event type");
  return {
    id: event.id as string,
    project_id: event.project_id as string,
    task_id: event.task_id as string,
    agent_id: event.agent_id as string,
    type: "run_task",
    payload: event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {},
    delivery_token: event.delivery_token as string,
    attempts: typeof event.attempts === "number" ? event.attempts : 0,
  };
}

function parseSelection(value: unknown): ModelSelection | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Outbox model selection is invalid");
  const selection = value as Record<string, unknown>;
  const efforts = ["low", "medium", "high", "xhigh", "max"];
  if (typeof selection.provider_id !== "string" || !selection.provider_id ||
      typeof selection.model_id !== "string" || !selection.model_id ||
      typeof selection.reasoning_effort !== "string" || !efforts.includes(selection.reasoning_effort) ||
      typeof selection.max_output_tokens !== "number" || !Number.isInteger(selection.max_output_tokens)) {
    throw new Error("Outbox model selection is invalid");
  }
  return {
    provider_id: selection.provider_id,
    model_id: selection.model_id,
    reasoning_effort: selection.reasoning_effort as ModelSelection["reasoning_effort"],
    max_output_tokens: selection.max_output_tokens,
  };
}

function parseExecutionConfig(value: unknown): ExecutionConfig {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const limits = raw.limits && typeof raw.limits === "object" && !Array.isArray(raw.limits)
    ? raw.limits as Record<string, unknown>
    : {};
  const instructions = raw.instructions ?? "";
  const connectionIds = raw.tool_connection_ids ?? [];
  const sandboxId = raw.sandbox_profile_id ?? null;
  const maxTurns = limits.max_turns ?? 20;
  const timeout = limits.timeout_seconds ?? 600;
  if (typeof instructions !== "string" || instructions.length > 16_000 ||
      !Array.isArray(connectionIds) || connectionIds.length > 20 ||
      !connectionIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200) ||
      (sandboxId !== null && (typeof sandboxId !== "string" || sandboxId.length > 200)) ||
      typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100 ||
      typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 30 || timeout > 3600) {
    throw new Error("Execution configuration is invalid");
  }
  return {
    instructions,
    tool_connection_ids: [...new Set(connectionIds as string[])],
    sandbox_profile_id: sandboxId as string | null,
    limits: { max_turns: maxTurns, timeout_seconds: timeout },
  };
}

function parseToolConnections(value: unknown): ToolConnectionCredential[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("Tool connection handoff is invalid");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Tool connection handoff is invalid");
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name ||
        typeof raw.endpoint !== "string" || !raw.endpoint ||
        !Array.isArray(raw.allowed_tools) || raw.allowed_tools.length > 100 ||
        !raw.allowed_tools.every((name) => typeof name === "string" && name.length > 0 && name.length <= 200) ||
        (raw.auth_token !== null && typeof raw.auth_token !== "string")) {
      throw new Error("Tool connection handoff is invalid");
    }
    return {
      id: raw.id,
      name: raw.name,
      endpoint: raw.endpoint,
      allowed_tools: [...new Set(raw.allowed_tools as string[])],
      auth_token: raw.auth_token as string | null,
    };
  });
}

function parseSandboxProfile(value: unknown): SandboxProfile | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sandbox profile handoff is invalid");
  const raw = value as Record<string, unknown>;
  const limits = raw.limits && typeof raw.limits === "object" && !Array.isArray(raw.limits)
    ? raw.limits as Record<string, unknown>
    : {};
  const validInteger = (key: string, min: number, max: number) => Number.isInteger(limits[key]) && Number(limits[key]) >= min && Number(limits[key]) <= max;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.project_id !== "string" || !raw.project_id ||
      typeof raw.name !== "string" || !raw.name || !validInteger("timeout_seconds", 1, 120) ||
      !validInteger("memory_mb", 64, 1024) || typeof limits.cpu_count !== "number" || limits.cpu_count < 0.25 || limits.cpu_count > 2 ||
      !validInteger("pids_limit", 16, 128) || !validInteger("output_bytes", 1024, 65536) ||
      !validInteger("workspace_mb", 1, 128)) {
    throw new Error("Sandbox profile handoff is invalid");
  }
  return { id: raw.id, project_id: raw.project_id, name: raw.name, limits: limits as unknown as SandboxProfile["limits"] };
}

function validateConfiguration(value: unknown, event: OutboxEvent): DispatcherHandoff {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Outbox configuration is invalid");
  const body = value as Record<string, unknown>;
  if (!body.agent || typeof body.agent !== "object" || Array.isArray(body.agent)) throw new Error("Agent handoff is invalid");
  const agent = body.agent as Record<string, unknown>;
  if (agent.id !== event.agent_id || typeof agent.token !== "string" || !agent.token) {
    throw new Error("Agent handoff does not match the assigned agent");
  }
  const modelConfig = parseSelection(body.model_config);
  const executionConfig = parseExecutionConfig(body.execution_config);
  const toolConnections = parseToolConnections(body.tool_connections);
  const sandboxProfile = parseSandboxProfile(body.sandbox_profile);
  const connectionIds = [...toolConnections.map((connection) => connection.id)].sort();
  if (connectionIds.length !== executionConfig.tool_connection_ids.length ||
      connectionIds.some((id, index) => id !== [...executionConfig.tool_connection_ids].sort()[index])) {
    throw new Error("Tool connection handoff does not match the execution configuration");
  }
  if (Boolean(executionConfig.sandbox_profile_id) !== Boolean(sandboxProfile) ||
      (sandboxProfile && sandboxProfile.project_id !== event.project_id)) {
    throw new Error("Sandbox profile handoff does not match the assigned project");
  }
  if (Object.hasOwn(event.payload, "model_config")) {
    const admitted = parseSelection(event.payload.model_config);
    if (!sameSelection(admitted, modelConfig)) throw new Error("Outbox model selection does not match its admitted snapshot");
  }

  let provider: ConfiguredProvider | null = null;
  if (body.provider !== null) {
    if (!body.provider || typeof body.provider !== "object" || Array.isArray(body.provider)) {
      throw new Error("Configured provider handoff is invalid");
    }
    const raw = body.provider as Record<string, unknown>;
    let baseUrl: URL;
    try {
      baseUrl = new URL(String(raw.base_url ?? ""));
    } catch {
      throw new Error("Configured provider endpoint is invalid");
    }
    if ((baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
        typeof raw.id !== "string" || !raw.id ||
        typeof raw.name !== "string" || !raw.name ||
        typeof raw.api_key !== "string" || !raw.api_key ||
        !Array.isArray(raw.models)) {
      throw new Error("Configured provider handoff is invalid");
    }
    provider = {
      id: raw.id,
      name: raw.name,
      base_url: baseUrl.toString().replace(/\/$/, ""),
      api_key: raw.api_key,
      models: raw.models as ConfiguredProvider["models"],
    };
  }
  if (Boolean(modelConfig) !== Boolean(provider)) throw new Error("Model selection and provider credential must be configured together");
  let executionLease: ExecutionLeaseHandoff | undefined;
  if (body.execution_lease !== undefined && body.execution_lease !== null) {
    if (!body.execution_lease || typeof body.execution_lease !== "object" || Array.isArray(body.execution_lease)) {
      throw new Error("Execution lease handoff is invalid");
    }
    const rawLease = body.execution_lease as Record<string, unknown>;
    const expiresAt = typeof rawLease.expires_at === "string" ? Date.parse(rawLease.expires_at) : NaN;
    if (rawLease.task_id !== event.task_id || rawLease.agent_id !== event.agent_id ||
        typeof rawLease.execution_id !== "string" || !rawLease.execution_id ||
        typeof rawLease.lease_token !== "string" || !rawLease.lease_token ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error("Execution lease handoff is invalid or expired");
    }
    executionLease = {
      task_id: rawLease.task_id,
      execution_id: rawLease.execution_id,
      agent_id: rawLease.agent_id,
      lease_token: rawLease.lease_token,
      expires_at: rawLease.expires_at as string,
    };
  }
  return {
    agent: { id: agent.id as string, token: agent.token },
    model_config: modelConfig,
    provider,
    execution_config: executionConfig,
    tool_connections: toolConnections,
    sandbox_profile: sandboxProfile,
    control_revision: 0,
    desired_action: null,
    retry_of: null,
    ...(executionLease ? { execution_lease: executionLease } : {}),
  };
}

function sameSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === null || right === null
    ? left === right
    : left.provider_id === right.provider_id &&
      left.model_id === right.model_id &&
      left.reasoning_effort === right.reasoning_effort &&
      left.max_output_tokens === right.max_output_tokens;
}

function createLeaseOperationQueue(): NonNullable<RunExecutionContext["withLeaseOperation"]> {
  let tail = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const current = tail.then(operation);
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
}

export class OutboxDispatcher {
  readonly #client: PlatformClient;
  readonly #bootId = randomUUID();
  readonly #inflight = new Map<string, Promise<void>>();
  readonly #active = new Map<string, ActiveDispatch>();
  readonly #directSyncs = new Map<string, SyncDraft>();
  #stopped = false;
  #loop: Promise<void> | undefined;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly engine: RuntimeEngine,
    options: DispatcherOptions = {},
  ) {
    this.#client = new PlatformClient(config);
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.leaseSeconds = options.leaseSeconds ?? 300;
    this.outboxLimit = options.outboxLimit ?? 5;
    this.outboxLeaseHeartbeatMs = options.outboxLeaseHeartbeatMs ?? 20_000;
    this.workflowTickIntervalMs = options.workflowTickIntervalMs ?? 3_000;
    this.controlPollIntervalMs = options.controlPollIntervalMs ?? 1_000;
    this.syncIntervalMs = options.syncIntervalMs ?? 3_000;
  }

  readonly pollIntervalMs: number;
  readonly leaseSeconds: number;
  readonly outboxLimit: number;
  readonly outboxLeaseHeartbeatMs: number;
  readonly workflowTickIntervalMs: number;
  readonly controlPollIntervalMs: number;
  readonly syncIntervalMs: number;

  start(): Promise<void> {
    if (this.#loop) return this.#loop;
    this.#stopped = false;
    this.#loop = Promise.all([this.#pollOutbox(), this.#pollControls(), this.#tickWorkflows()]).then(() => undefined);
    return this.#loop;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    for (const active of this.#active.values()) active.wake?.();
    await this.#loop;
    await Promise.allSettled([...this.#inflight.values()]);
  }

  async #pollOutbox(): Promise<void> {
    while (!this.#stopped) {
      try {
        const result = await this.#client.runtimePost<unknown>("/api/runtime/outbox/claim", {
          worker_id: this.config.workerId,
          limit: this.outboxLimit,
        });
        if (!Array.isArray(result)) throw new Error("Runtime outbox claim returned an invalid response");
        for (const raw of result) {
          let event: OutboxEvent;
          try {
            event = validateEvent(raw);
          } catch {
            continue;
          }
          if (this.#inflight.has(event.id)) continue;
          const active: ActiveDispatch = { event, desired_action: null, control_revision: 0 };
          this.#active.set(event.id, active);
          const processing = this.#process(event);
          this.#inflight.set(event.id, processing);
          const cleanup = () => {
            if (this.#inflight.get(event.id) === processing) this.#inflight.delete(event.id);
            if (this.#active.get(event.id) === active) this.#active.delete(event.id);
          };
          void processing.then(cleanup, cleanup);
        }
      } catch (error) {
        const status = error instanceof PlatformError ? ` (${error.status})` : "";
        console.error(`[runtime] outbox poll failed${status}`);
      }
      await this.#delay(this.pollIntervalMs);
    }
  }

  async #pollControls(): Promise<void> {
    while (!this.#stopped) {
      try {
        const controls = await this.#client.runtimeGet<unknown>(
          `/api/runtime/runs/controls?worker_id=${encodeURIComponent(this.config.workerId)}`,
        );
        if (!Array.isArray(controls)) throw new Error("Runtime controls returned an invalid response");
        for (const raw of controls) {
          const control = this.#parseControl(raw);
          const active = control ? this.#active.get(control.id) : undefined;
          if (control && active) await this.#applyControl(active, control);
        }
      } catch (error) {
        const status = error instanceof PlatformError ? ` (${error.status})` : "";
        console.error(`[runtime] control poll failed${status}`);
      }
      await this.#delay(this.controlPollIntervalMs);
    }
  }

  async #tickWorkflows(): Promise<void> {
    while (!this.#stopped) {
      try {
        await this.#client.runtimePost<unknown>("/api/runtime/workflows/tick", {});
      } catch (error) {
        const status = error instanceof PlatformError ? ` (${error.status})` : "";
        console.error(`[runtime] workflow tick failed${status}`);
      }
      await this.#delay(this.workflowTickIntervalMs);
    }
  }

  #parseControl(value: unknown): RuntimeRunControl | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id ||
        !["pause", "resume", "stop"].includes(String(raw.desired_action)) ||
        typeof raw.control_revision !== "number" || !Number.isInteger(raw.control_revision) || raw.control_revision < 1) return undefined;
    return {
      id: raw.id,
      desired_action: raw.desired_action as RuntimeRunControl["desired_action"],
      control_revision: raw.control_revision,
    };
  }

  async #applyControl(active: ActiveDispatch, control: RuntimeRunControl): Promise<void> {
    if (control.control_revision <= active.control_revision) return;
    active.desired_action = control.desired_action;
    active.control_revision = control.control_revision;
    if (active.context) {
      active.context.desired_action = control.desired_action;
      active.context.control_revision = control.control_revision;
      if (this.engine.store.get(active.event.id)) {
        await this.engine.applyControl(active.event.id, control.desired_action, control.control_revision);
      }
    }
    active.wake?.();
  }

  async #process(event: OutboxEvent): Promise<void> {
    let context: RunExecutionContext | undefined;
    let deliveryHeartbeat: LeaseHeartbeat | undefined;
    let taskHeartbeat: LeaseHeartbeat | undefined;
    let submissionConfirmed = false;
    const active = this.#active.get(event.id) ?? { event, desired_action: null, control_revision: 0 };
    const priorRun = this.engine.store.get(event.id);
    try {
      deliveryHeartbeat = this.#startDeliveryHeartbeat(event);
      const handoffValue = await this.#client.runtimePost<unknown>(
        `/api/runtime/outbox/${encodeURIComponent(event.id)}/configuration`,
        { worker_id: this.config.workerId, delivery_token: event.delivery_token },
      );
      const handoff = validateConfiguration(handoffValue, event);
      deliveryHeartbeat.assertHealthy();
      context = {
        project_id: event.project_id,
        withLeaseOperation: createLeaseOperationQueue(),
        ...(handoff.execution_lease ? { lease: {
          execution_id: handoff.execution_lease.execution_id,
          lease_token: handoff.execution_lease.lease_token,
          lease_seconds: this.leaseSeconds,
        } } : {}),
        agent_credential: handoff.agent,
        desired_action: active.desired_action ?? handoff.desired_action,
        control_revision: Math.max(active.control_revision, handoff.control_revision),
        execution_config: priorRun ? priorRun.execution_config : handoff.execution_config,
        tool_connections: priorRun
          ? handoff.tool_connections.filter((item) => (priorRun.tool_connections ?? []).some((saved) => saved.id === item.id))
          : handoff.tool_connections,
        sandbox_profile: priorRun ? priorRun.sandbox_profile : handoff.sandbox_profile,
      };
      active.context = context;

      await this.#refreshControls(active);
      const hasRecoveredLease = Boolean(context.lease);
      if (active.desired_action === "stop" && !hasRecoveredLease) {
        await this.#stopBeforeAdmission(event, context, "Run stopped before task admission.");
        return;
      }
      if (active.desired_action === "pause" && !hasRecoveredLease) {
        await this.#waitWhilePaused(active, deliveryHeartbeat);
        if (this.#stopped) return;
        if ((active.desired_action as RuntimeRunControl["desired_action"] | null) === "stop") {
          await this.#stopBeforeAdmission(event, context, "Run stopped before task admission.");
          return;
        }
      }

      const activePriorRun = priorRun && ["queued", "running", "paused"].includes(priorRun.status);
      if (activePriorRun && priorRun.status !== "queued" && !handoff.execution_lease) {
        throw new Error("The persisted Run execution lease was not present in the fresh fenced handoff.");
      }
      if (priorRun?.execution_id && context.lease && priorRun.execution_id !== context.lease.execution_id) {
        throw new Error("The persisted Run execution lease could not be recovered safely.");
      }

      const recoveryIsTerminal = priorRun && ["done", "failed", "aborted"].includes(priorRun.status);
      if (recoveryIsTerminal && priorRun.status !== "done") {
        const settledRun = await this.#settleTerminalRun(event.id, priorRun);
        await this.#syncTerminalUntilConfirmed(event, context, settledRun);
        return;
      }
      if (priorRun?.status === "done" && priorRun.answer && priorRun.receipt) {
        const expected = this.#submissionBody(priorRun, priorRun.execution_id ?? context.lease?.execution_id);
        if (expected.execution_id) submissionConfirmed = await this.#hasMatchingSubmission(event, handoff.agent, expected);
      }
      let claim: ClaimResponse | undefined;
      if ((!context.lease && !submissionConfirmed) || !priorRun) {
        claim = await this.#client.agentPost<ClaimResponse>(event.agent_id,
          `/api/tasks/${encodeURIComponent(event.task_id)}/claim`,
          { lease_seconds: this.leaseSeconds },
          `outbox:${event.id}:claim`,
          handoff.agent,
        );
        if (!claim?.task?.id || !claim.execution?.id || !claim.lease_token) {
          throw new Error("Task claim returned an invalid lease");
        }
        if (priorRun?.execution_id && priorRun.execution_id !== claim.execution.id) {
          throw new Error("The persisted Run execution lease could not be recovered safely.");
        }
        if (context.lease && context.lease.execution_id !== claim.execution.id) {
          throw new Error("The fresh execution lease does not match the task claim.");
        }
        context.lease ??= {
          execution_id: claim.execution.id,
          lease_token: claim.lease_token,
          lease_seconds: this.leaseSeconds,
        };
      }
      if (!priorRun && !claim) throw new Error("Task metadata could not be recovered for the new Run.");
      let renewalSequence = Date.now();
      const renewLease = async () => {
        try {
          await this.#withLeaseOperation(context!, async () => {
            deliveryHeartbeat?.assertHealthy();
            await this.#renew(event, context!, ++renewalSequence);
          });
        } catch (error) {
          if (error instanceof PlatformError && [401, 403, 404, 409].includes(error.status)) context!.lease_lost = true;
          throw error;
        }
      };
      context.assertLease = renewLease;
      if (!recoveryIsTerminal) {
        taskHeartbeat = this.#startHeartbeat(event, context, renewLease);
        await renewLease();
      }

      const input = {
        request_id: event.id,
        task_id: event.task_id,
        agent_id: event.agent_id,
        prompt: priorRun?.prompt ?? taskPrompt(claim!.task, event.payload),
        model_config: priorRun ? priorRun.model_config : handoff.model_config,
        execution_id: priorRun?.execution_id ?? claim?.execution.id ?? context.lease?.execution_id,
        retry_of: priorRun ? priorRun.retry_of : handoff.retry_of,
        execution_config: priorRun ? priorRun.execution_config : handoff.execution_config,
        tool_connections: priorRun
          ? priorRun.tool_connections
          : handoff.tool_connections.map(({ id, name, endpoint, allowed_tools }) => ({ id, name, endpoint, allowed_tools })),
        sandbox_profile: priorRun ? priorRun.sandbox_profile : handoff.sandbox_profile,
      };
      let runRecord = this.engine.store.get(event.id);
      if (!runRecord || ["queued", "running", "paused"].includes(runRecord.status)) {
        await this.engine.enqueue(input, context, handoff.provider ?? undefined);
        runRecord = this.engine.store.get(event.id);
      }
      if (!runRecord) throw new Error("Pi Durable did not persist the admitted run");
      if (active.desired_action && active.control_revision > runRecord.control_revision) {
        await this.engine.applyControl(event.id, active.desired_action, active.control_revision);
      }
      if (!recoveryIsTerminal) {
        await this.#progress(event, context, 5, "Pi Durable accepted the dispatch and began the run.", 0);
        if (!["done", "failed", "aborted"].includes(runRecord.status)) {
          try {
            await this.#syncRun(event, context, runRecord);
          } catch (syncError) {
            if (syncError instanceof PlatformError && [401, 403, 404, 409].includes(syncError.status)) {
              context.lease_lost = true;
              await this.engine.abort(event.id);
              throw syncError;
            }
            const status = syncError instanceof PlatformError ? ` (${syncError.status})` : "";
            console.error(`[runtime] initial Run sync deferred${status}`);
          }
        }
      }
      const finalRun = recoveryIsTerminal
        ? await this.#settleTerminalRun(event.id, runRecord)
        : await this.#waitForRun(event, context, deliveryHeartbeat, taskHeartbeat!);
      if (finalRun.status === "done") {
        if (!finalRun.answer || !finalRun.receipt) throw new Error("Pi Durable completion has no answer or execution receipt");
        taskHeartbeat?.assertHealthy();
        deliveryHeartbeat.assertHealthy();
        if (!submissionConfirmed) {
          if (!recoveryIsTerminal) await this.#progress(event, context, 90, "Pi Durable produced a result with execution evidence.", 1);
          await taskHeartbeat?.stop();
          taskHeartbeat = undefined;
          await this.#withLeaseOperation(context, async () => undefined);
          const submitBody = this.#submissionBody(
            finalRun,
            finalRun.execution_id ?? context.lease?.execution_id,
            context.lease?.lease_token,
          );
          if (!submitBody.execution_id || !submitBody.lease_token) throw new Error("Task execution lease is unavailable");
          if (!await this.#submitResult(event, handoff.agent, submitBody)) return;
          submissionConfirmed = true;
        }
        await this.#syncTerminalUntilConfirmed(event, context, finalRun);
      } else {
        if (context.lease) await this.#release(event, context);
        await this.#syncTerminalUntilConfirmed(event, context, this.engine.store.get(event.id) ?? finalRun);
      }
    } catch (error) {
      if (error instanceof PlatformError && error.status >= 500) {
        console.error(`[runtime] dispatch deferred for retry (${error.status})`);
        return;
      }
      if (error instanceof PlatformError && [401, 403, 404, 409].includes(error.status) && context?.lease_lost) {
        console.error(`[runtime] execution lease was rejected (${error.status})`);
        return;
      }
      const message = error instanceof PlatformError && error.status >= 400 && error.status < 500
        ? `Platform rejected the dispatch (${error.status})`
        : error instanceof Error && error.message.toLowerCase().includes("lease")
          ? "Persisted Run could not recover a valid execution lease; unsafe replay was prevented."
          : "Pi Durable dispatch failed";
      try {
        if (context?.lease) await this.#release(event, context);
        const current = this.engine.store.get(event.id);
        if (current && (current.status === "done" && !submissionConfirmed || !["done", "failed", "aborted"].includes(current.status))) {
          this.engine.store.setStatus(event.id, "failed", { error: message });
        }
        const latest = this.engine.store.get(event.id);
        if (latest && context) await this.#syncTerminalUntilConfirmed(event, context, latest);
        else await this.#syncWithoutRun(event, "failed", message);
      } catch (ackError) {
        const status = ackError instanceof PlatformError ? ` (${ackError.status})` : "";
        console.error(`[runtime] terminal Run sync deferred${status}`);
      }
    } finally {
      if (taskHeartbeat) await taskHeartbeat.stop();
      if (deliveryHeartbeat) await deliveryHeartbeat.stop();
      active.context = undefined;
    }
  }

  async #refreshControls(active: ActiveDispatch): Promise<void> {
    const controls = await this.#client.runtimeGet<unknown>(
      `/api/runtime/runs/controls?worker_id=${encodeURIComponent(this.config.workerId)}`,
    );
    if (!Array.isArray(controls)) throw new Error("Runtime controls returned an invalid response");
    for (const raw of controls) {
      const control = this.#parseControl(raw);
      if (control?.id === active.event.id) await this.#applyControl(active, control);
    }
  }

  async #waitWhilePaused(active: ActiveDispatch, deliveryHeartbeat: LeaseHeartbeat): Promise<void> {
    while (!this.#stopped && active.desired_action === "pause") {
      deliveryHeartbeat.assertHealthy();
      await this.#waitForControlWake(active, Math.min(this.controlPollIntervalMs, 1_000));
    }
  }

  async #waitForRun(
    event: OutboxEvent,
    context: RunExecutionContext,
    deliveryHeartbeat: LeaseHeartbeat,
    taskHeartbeat: LeaseHeartbeat,
  ): Promise<RunRecord> {
    let lastSync = 0;
    while (true) {
      deliveryHeartbeat.assertHealthy();
      taskHeartbeat.assertHealthy();
      const record = this.engine.store.get(event.id);
      if (!record) throw new Error("Pi Durable run record disappeared");
      if (["done", "failed", "aborted"].includes(record.status)) {
        return this.#settleTerminalRun(event.id, record);
      }
      if (Date.now() - lastSync >= this.syncIntervalMs) {
        try {
          await this.#syncRun(event, context, record);
        } catch (error) {
          if (error instanceof PlatformError && [401, 403, 404, 409].includes(error.status)) {
            context.lease_lost = true;
            await this.engine.abort(event.id);
            throw error;
          }
          const status = error instanceof PlatformError ? ` (${error.status})` : "";
          console.error(`[runtime] Run sync deferred${status}`);
        }
        lastSync = Date.now();
      }
      await this.#delay(Math.min(250, this.syncIntervalMs));
    }
  }

  async #syncRun(event: OutboxEvent, context: RunExecutionContext, record: RunRecord, terminal = false): Promise<boolean> {
    const pending = this.engine.store.unsyncedEvents(event.id);
    const eventSequence = pending.at(-1)?.sequence ?? record.event_sequence;
    const events: Array<{ kind: string; data: Record<string, unknown> }> = pending.map((item: RuntimeEvent) => ({
      kind: item.kind,
      data: item.data,
    }));
    if (terminal) {
      for (const result of this.engine.store.sandboxEvidence(event.id)) events.push({ kind: "sandbox", data: result });
    }
    const body: Record<string, unknown> = {
      worker_id: this.config.workerId,
      status: record.status as RunStatus,
      ...(record.execution_id ?? context.lease?.execution_id ? { execution_id: record.execution_id ?? context.lease?.execution_id } : {}),
      mode: record.mode,
      events,
      ...(record.receipt ? { receipt: record.receipt } : {}),
      ...(record.answer !== null ? { answer: record.answer } : {}),
      ...(record.error !== null ? { error: record.error } : {}),
      ...(record.sandbox ? { sandbox: record.sandbox } : context.sandbox_summary ? { sandbox: context.sandbox_summary } : {}),
    };
    const prepared = this.engine.store.prepareSync(event.id, body, eventSequence);
    await this.#client.runtimePost<unknown>(`/api/runtime/runs/${encodeURIComponent(event.id)}/sync`, {
      ...prepared.body,
      sequence: prepared.sequence,
      delivery_token: event.delivery_token,
    });
    this.engine.store.completeSync(event.id, prepared.sequence, prepared.event_sequence);
    return prepared.body.status === record.status && ["done", "failed", "aborted"].includes(record.status);
  }

  async #syncTerminalUntilConfirmed(
    event: OutboxEvent,
    context: RunExecutionContext,
    record: RunRecord,
  ): Promise<void> {
    const settledRecord = await this.#settleTerminalRun(event.id, record);
    while (!this.#stopped) {
      try {
        if (await this.#syncRun(event, context, settledRecord, true)) return;
      } catch (error) {
        if (error instanceof PlatformError && [401, 403, 404, 409].includes(error.status)) throw error;
        const status = error instanceof PlatformError ? ` (${error.status})` : "";
        console.error(`[runtime] terminal Run sync retry${status}`);
        await this.#delay(Math.min(this.syncIntervalMs, 1_000));
      }
    }
  }

  async #settleTerminalRun(requestId: string, fallback: RunRecord): Promise<RunRecord> {
    const settled = await this.engine.waitFor(requestId);
    let record = this.engine.store.get(requestId) ?? settled ?? fallback;
    if (record.sandbox?.status === "ready" && record.sandbox.workspace_available) {
      this.engine.store.setSandbox(requestId, {
        run_id: requestId,
        status: "lost",
        workspace_available: false,
      });
      const alreadyReported = this.engine.store.events(requestId).some((event) =>
        event.kind === "error" && event.data.kind === "sandbox_cleanup_unconfirmed",
      );
      if (!alreadyReported) {
        this.engine.store.appendEvent(requestId, "error", {
          kind: "sandbox_cleanup_unconfirmed",
          message: "沙箱清理尚未確認，請由操作者檢查執行器。",
        });
      }
      record = this.engine.store.get(requestId) ?? record;
    }
    return record;
  }

  async #stopBeforeAdmission(event: OutboxEvent, context: RunExecutionContext, message: string): Promise<void> {
    const current = this.engine.store.get(event.id);
    if (current) {
      if (!["done", "failed", "aborted"].includes(current.status)) {
        this.engine.store.setStatus(event.id, "aborted", { error: message });
      }
      const latest = this.engine.store.get(event.id);
      if (latest) await this.#syncTerminalUntilConfirmed(event, context, latest);
      return;
    }
    await this.#syncWithoutRun(event, "aborted", message);
  }

  async #syncWithoutRun(event: OutboxEvent, status: "failed" | "aborted", error: string): Promise<void> {
    let prepared = this.#directSyncs.get(event.id);
    if (!prepared) {
      const body = {
        worker_id: this.config.workerId,
        status,
        error,
        events: [{ kind: status === "aborted" ? "control" : "error", data: { message: error } }],
      };
      prepared = { sequence: 1, body, event_sequence: 0 };
      this.#directSyncs.set(event.id, prepared);
    }
    while (!this.#stopped) {
      try {
        await this.#client.runtimePost<unknown>(`/api/runtime/runs/${encodeURIComponent(event.id)}/sync`, {
          ...prepared.body,
          sequence: prepared.sequence,
          delivery_token: event.delivery_token,
        });
        this.#directSyncs.delete(event.id);
        return;
      } catch (syncError) {
        if (syncError instanceof PlatformError && [401, 403, 404, 409].includes(syncError.status)) throw syncError;
        const retryStatus = syncError instanceof PlatformError ? ` (${syncError.status})` : "";
        console.error(`[runtime] terminal Run sync retry${retryStatus}`);
        await this.#delay(Math.min(this.syncIntervalMs, 1_000));
      }
    }
  }

  async #waitForControlWake(active: ActiveDispatch, milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (active.wake === wake) active.wake = undefined;
        resolve();
      }, milliseconds);
      const wake = () => {
        clearTimeout(timer);
        if (active.wake === wake) active.wake = undefined;
        resolve();
      };
      active.wake = wake;
    });
  }

  async #delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  #withLeaseOperation<T>(context: RunExecutionContext, operation: () => Promise<T>): Promise<T> {
    return context.withLeaseOperation ? context.withLeaseOperation(operation) : operation();
  }

  #submissionBody(record: RunRecord, executionId: string | null | undefined, leaseToken?: string): TaskSubmissionBody {
    if (!record.answer || !record.receipt) throw new Error("Pi Durable completion has no answer or execution receipt");
    const live = record.receipt.mode === "live";
    return {
      ...(executionId ? { execution_id: executionId } : {}),
      ...(leaseToken ? { lease_token: leaseToken } : {}),
      summary: live
        ? record.answer
        : "DEMO MODE: deterministic provider receipt. This does not claim the assigned task was completed.",
      artifacts: [{
        kind: "summary",
        title: live ? "Pi Durable live model result" : "DEMO MODE deterministic provider receipt",
        content: record.answer,
      }, {
        kind: "test_report",
        title: live ? "Live model usage and tool receipt" : "DEMO MODE execution receipt",
        content: JSON.stringify(record.receipt, null, 2),
      }],
    };
  }

  async #hasMatchingSubmission(event: OutboxEvent, credential: { id: string; token: string }, expected: TaskSubmissionBody): Promise<boolean> {
    const value = await this.#client.agentGet<unknown>(
      event.agent_id,
      `/api/tasks/${encodeURIComponent(event.task_id)}/context`,
      credential,
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const context = value as Record<string, unknown>;
    const task = context.task && typeof context.task === "object" && !Array.isArray(context.task)
      ? context.task as Record<string, unknown>
      : {};
    if (task.id !== event.task_id || !Array.isArray(context.executions) || !Array.isArray(context.artifacts)) return false;
    const executionExists = context.executions.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const execution = item as Record<string, unknown>;
      return execution.id === expected.execution_id && execution.task_id === event.task_id &&
        execution.agent_id === event.agent_id && ["submitted", "accepted", "rejected"].includes(String(execution.status)) &&
        execution.summary === expected.summary;
    });
    if (!executionExists) return false;
    const artifacts = context.artifacts as unknown[];
    return expected.artifacts.every((expectedArtifact) => artifacts.some((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const artifact = item as Record<string, unknown>;
      return artifact.execution_id === expected.execution_id && artifact.task_id === event.task_id &&
        artifact.kind === expectedArtifact.kind && artifact.title === expectedArtifact.title &&
        artifact.content === expectedArtifact.content;
    }));
  }

  async #submitResult(event: OutboxEvent, credential: { id: string; token: string }, body: TaskSubmissionBody): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.#stopped) return false;
      try {
        await this.#client.agentPost<unknown>(event.agent_id,
          `/api/tasks/${encodeURIComponent(event.task_id)}/submit`,
          body,
          `outbox:${event.id}:submit-result`,
          credential,
        );
        return true;
      } catch (error) {
        if (!(error instanceof PlatformError) || error.status < 500 || attempt === 3) throw error;
        console.error(`[runtime] task submission retry (${error.status})`);
        await this.#delay(250 * (2 ** attempt));
      }
    }
    return false;
  }

  #startDeliveryHeartbeat(event: OutboxEvent): LeaseHeartbeat {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let inFlight = Promise.resolve();
    let leaseFailure: PlatformError | undefined;
    const tick = async () => {
      if (stopped) return;
      inFlight = (async () => {
        try {
          await this.#client.runtimePost<unknown>(
            `/api/runtime/outbox/${encodeURIComponent(event.id)}/renew`,
            { worker_id: this.config.workerId, delivery_token: event.delivery_token },
          );
          leaseFailure = undefined;
        } catch (error) {
          if (error instanceof PlatformError && [401, 403, 404, 409].includes(error.status)) leaseFailure = error;
        }
      })();
      await inFlight;
      if (!stopped) timer = setTimeout(() => void tick(), this.outboxLeaseHeartbeatMs);
    };
    timer = setTimeout(() => void tick(), this.outboxLeaseHeartbeatMs);
    return {
      stop: async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        await inFlight;
      },
      assertHealthy: () => {
        if (leaseFailure) throw leaseFailure;
      },
    };
  }

  #startHeartbeat(event: OutboxEvent, context: RunExecutionContext, renewLease: () => Promise<void>): LeaseHeartbeat {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let inFlight = Promise.resolve();
    let leaseFailure: PlatformError | undefined;
    const intervalMs = Math.max(1_000, Math.floor(this.leaseSeconds * 1000 / 3));

    const tick = async () => {
      if (stopped) return;
      inFlight = (async () => {
        try {
          await renewLease();
          leaseFailure = undefined;
        } catch (error) {
          if (error instanceof PlatformError && [401, 403, 404, 409].includes(error.status)) leaseFailure = error;
        }
      })();
      await inFlight;
      if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
    };

    timer = setTimeout(() => void tick(), intervalMs);
    return {
      stop: async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        await inFlight;
      },
      assertHealthy: () => {
        if (leaseFailure) throw leaseFailure;
      },
    };
  }

  async #progress(event: OutboxEvent, context: RunExecutionContext, progress: number, summary: string, sequence: number): Promise<void> {
    await this.#withLeaseOperation(context, async () => {
      const lease = context.lease;
      if (!lease || !context.agent_credential) throw new Error("Task execution lease is unavailable");
      await this.#client.agentPost<unknown>(event.agent_id,
        `/api/tasks/${encodeURIComponent(event.task_id)}/progress`,
        {
          execution_id: lease.execution_id,
          lease_token: lease.lease_token,
          progress,
          summary,
        },
        `outbox:${event.id}:boot:${this.#bootId}:progress:${sequence}`,
        context.agent_credential,
      );
    });
  }

  async #renew(event: OutboxEvent, context: RunExecutionContext, sequence: number): Promise<void> {
    const lease = context.lease;
    if (!lease || !context.agent_credential) throw new Error("Task execution lease is unavailable");
    const result = await this.#client.agentPost<{
      execution?: { id?: string };
      lease_token?: string;
    }>(event.agent_id,
      `/api/tasks/${encodeURIComponent(event.task_id)}/renew`,
      {
        execution_id: lease.execution_id,
        lease_token: lease.lease_token,
        lease_seconds: this.leaseSeconds,
      },
      `outbox:${event.id}:boot:${this.#bootId}:renew:${sequence}`,
      context.agent_credential,
    );
    if (result.execution?.id) lease.execution_id = result.execution.id;
    if (result.lease_token) lease.lease_token = result.lease_token;
  }

  async #release(event: OutboxEvent, context: RunExecutionContext): Promise<void> {
    try {
      await this.#withLeaseOperation(context, async () => {
        const lease = context.lease;
        if (!lease || !context.agent_credential) return;
        await this.#client.agentPost<unknown>(event.agent_id,
          `/api/tasks/${encodeURIComponent(event.task_id)}/release`,
          {
            execution_id: lease.execution_id,
            lease_token: lease.lease_token,
            handoff: "Runtime execution ended without a result; the task is ready for another attempt.",
          },
          `outbox:${event.id}:boot:${this.#bootId}:release`,
          context.agent_credential,
        );
      });
    } catch {
      // Leave the lease to expire if the release callback cannot be confirmed.
    }
  }

}
