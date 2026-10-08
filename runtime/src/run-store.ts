import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  ExecutionConfig,
  ModelSelection,
  RunControlAction,
  RunInput,
  RunReceipt,
  RunRecord,
  RunStatus,
  RuntimeEvent,
  RuntimeMode,
  SandboxProfile,
  SandboxSummary,
  ToolConnectionSnapshot,
} from "./types.js";

export interface StoredRunInput extends RunInput {
  project_id?: string;
  mode?: RuntimeMode;
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function hashInput(input: StoredRunInput): string {
  const stable: Record<string, unknown> = {
    request_id: input.request_id,
    task_id: input.task_id,
    agent_id: input.agent_id,
    prompt: input.prompt,
    model: input.model ?? null,
    project_id: input.project_id ?? null,
    execution_id: input.execution_id ?? null,
    retry_of: input.retry_of ?? null,
    execution_config: input.execution_config ?? null,
    tool_connections: input.tool_connections ?? [],
    sandbox_profile: input.sandbox_profile ?? null,
  };
  if (input.model_config) stable.model_config = input.model_config;
  if (input.mode === "live") stable.mode = input.mode;
  const serialized = JSON.stringify(stable);
  return createHash("sha256").update(serialized).digest("hex");
}

function mapRow(row: Record<string, unknown> | undefined): RunRecord | undefined {
  if (!row) return undefined;
  return {
    request_id: String(row.request_id),
    task_id: String(row.task_id),
    agent_id: String(row.agent_id),
    prompt: String(row.prompt),
    model: row.model === null ? undefined : String(row.model),
    model_config: parseJson<ModelSelection>(row.model_config_json),
    project_id: row.project_id === null ? null : String(row.project_id),
    mode: row.mode === "live" ? "live" : "demo",
    conversation_id: String(row.conversation_id),
    submission_id: row.submission_id === null ? null : String(row.submission_id),
    status: String(row.status) as RunStatus,
    execution_id: row.execution_id === null ? null : String(row.execution_id),
    desired_action: row.desired_action === null ? null : String(row.desired_action) as RunControlAction,
    control_revision: Number(row.control_revision ?? 0),
    retry_of: row.retry_of === null ? null : String(row.retry_of),
    answer: row.answer === null ? null : String(row.answer),
    error: row.error === null ? null : String(row.error),
    receipt: parseJson<RunReceipt>(row.receipt_json),
    execution_config: parseJson<ExecutionConfig>(row.execution_config_json) ?? undefined,
    tool_connections: parseJson<ToolConnectionSnapshot[]>(row.tool_connections_json) ?? [],
    sandbox_profile: parseJson<SandboxProfile | null>(row.sandbox_profile_json),
    sandbox: parseJson<SandboxSummary>(row.sandbox_json),
    started_at: row.started_at === null ? null : String(row.started_at),
    finished_at: row.finished_at === null ? null : String(row.finished_at),
    event_sequence: Number(row.event_sequence ?? 0),
    synced_sequence: Number(row.synced_sequence ?? 0),
    sync_revision: Number(row.sync_revision ?? 0),
    turn_count: Number(row.turn_count ?? 0),
    payload_hash: String(row.payload_hash),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

const PRIVATE_EVENT_KEY = /(token|secret|password|credential|authorization|api.?key|cookie|header|prompt|content|arguments?|stdout|stderr|output|result)/i;

function safeEventValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return undefined;
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
      .slice(0, 500);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeEventValue(item, depth + 1)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    if (PRIVATE_EVENT_KEY.test(key)) continue;
    const safe = safeEventValue(item, depth + 1);
    if (safe !== undefined) output[key.slice(0, 64)] = safe;
  }
  return output;
}

function safeEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of ["operation", "path", "exit_code", "timed_out", "truncated", "duration_seconds", "bytes_written"]) {
    const safe = safeEventValue(value[key]);
    if (safe !== undefined) output[key] = safe;
  }
  for (const key of ["stdout", "stderr"]) {
    if (typeof value[key] === "string") {
      output[key] = value[key]
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
        .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
        .slice(0, 8000);
    }
  }
  return output;
}

function mapEvent(row: Record<string, unknown> | undefined): RuntimeEvent | undefined {
  if (!row) return undefined;
  return {
    sequence: Number(row.sequence),
    kind: String(row.kind),
    created_at: String(row.created_at),
    data: parseJson<Record<string, unknown>>(row.data_json) ?? {},
  };
}

export class RunStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        request_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT,
        model_config_json TEXT,
        mode TEXT NOT NULL DEFAULT 'demo',
        project_id TEXT,
        conversation_id TEXT NOT NULL,
        submission_id TEXT,
        status TEXT NOT NULL,
        answer TEXT,
        error TEXT,
        receipt_json TEXT,
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        execution_id TEXT,
        retry_of TEXT,
        execution_config_json TEXT,
        tool_connections_json TEXT,
        sandbox_profile_json TEXT,
        desired_action TEXT,
        control_revision INTEGER NOT NULL DEFAULT 0,
        sandbox_json TEXT,
        started_at TEXT,
        finished_at TEXT,
        event_sequence INTEGER NOT NULL DEFAULT 0,
        synced_sequence INTEGER NOT NULL DEFAULT 0,
        sync_revision INTEGER NOT NULL DEFAULT 0,
        turn_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS runs_agent_queue ON runs(agent_id, created_at, request_id);
      CREATE TABLE IF NOT EXISTS run_events (
        request_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (request_id, sequence),
        FOREIGN KEY (request_id) REFERENCES runs(request_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sandbox_evidence (
        request_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (request_id, sequence),
        FOREIGN KEY (request_id) REFERENCES runs(request_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS runtime_sync_pending (
        request_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        event_sequence INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES runs(request_id) ON DELETE CASCADE
      );
    `);
    const columns = new Set((this.#database.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((row) => row.name));
    const migrations: Array<[string, string]> = [
      ["model_config_json", "TEXT"], ["mode", "TEXT NOT NULL DEFAULT 'demo'"], ["receipt_json", "TEXT"],
      ["execution_id", "TEXT"], ["retry_of", "TEXT"], ["execution_config_json", "TEXT"],
      ["tool_connections_json", "TEXT"], ["sandbox_profile_json", "TEXT"], ["desired_action", "TEXT"],
      ["control_revision", "INTEGER NOT NULL DEFAULT 0"], ["sandbox_json", "TEXT"], ["started_at", "TEXT"],
      ["finished_at", "TEXT"], ["event_sequence", "INTEGER NOT NULL DEFAULT 0"], ["synced_sequence", "INTEGER NOT NULL DEFAULT 0"],
      ["sync_revision", "INTEGER NOT NULL DEFAULT 0"],
      ["turn_count", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [name, definition] of migrations) {
      if (!columns.has(name)) this.#database.exec(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`);
    }
  }

  reserve(input: StoredRunInput, conversationId: string): { record: RunRecord; created: boolean } {
    const payloadHash = hashInput(input);
    const existing = mapRow(this.#database.prepare("SELECT * FROM runs WHERE request_id = ?").get(input.request_id));
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw new Error("request_id was already used with a different run body");
      }
      return { record: existing, created: false };
    }

    const now = new Date().toISOString();
    this.#database.prepare(`
      INSERT INTO runs (
        request_id, task_id, agent_id, prompt, model, model_config_json, mode, project_id, conversation_id,
        submission_id, status, answer, error, receipt_json, payload_hash, created_at, updated_at,
        execution_id, retry_of, execution_config_json, tool_connections_json, sandbox_profile_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'queued', NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.request_id,
      input.task_id,
      input.agent_id,
      input.prompt,
      input.model ?? null,
      input.model_config ? JSON.stringify(input.model_config) : null,
      input.mode ?? "demo",
      input.project_id ?? null,
      conversationId,
      payloadHash,
      now,
      now,
      input.execution_id ?? null,
      input.retry_of ?? null,
      input.execution_config ? JSON.stringify(input.execution_config) : null,
      input.tool_connections ? JSON.stringify(input.tool_connections) : null,
      input.sandbox_profile ? JSON.stringify(input.sandbox_profile) : null,
    );
    this.appendEvent(input.request_id, "status", { status: "queued" });
    const record = this.get(input.request_id);
    if (!record) throw new Error("Could not read the newly created run record");
    return { record, created: true };
  }

  get(requestId: string): RunRecord | undefined {
    return mapRow(this.#database.prepare("SELECT * FROM runs WHERE request_id = ?").get(requestId));
  }

  pending(): RunRecord[] {
    return (this.#database.prepare("SELECT * FROM runs WHERE status IN ('queued', 'running', 'paused') ORDER BY created_at, request_id").all() as Record<string, unknown>[])
      .map((row) => mapRow(row)!)
      .filter(Boolean);
  }

  setSubmission(requestId: string, submissionId: string): void {
    const previous = this.get(requestId);
    const now = new Date().toISOString();
    this.#update(requestId, "submission_id = ?, status = 'running', error = NULL, started_at = COALESCE(started_at, ?), finished_at = NULL", [submissionId, now]);
    if (previous?.status !== "running") this.appendEvent(requestId, "status", { status: "running" });
  }

  setStatus(requestId: string, status: RunStatus, fields: {
    answer?: string | null;
    error?: string | null;
    receipt?: RunReceipt | null;
  } = {}): void {
    const now = new Date().toISOString();
    const assignments = ["status = ?"];
    const values: SQLInputValue[] = [status];
    if (Object.hasOwn(fields, "answer")) { assignments.push("answer = ?"); values.push(fields.answer ?? null); }
    if (Object.hasOwn(fields, "error")) { assignments.push("error = ?"); values.push(fields.error ?? null); }
    if (Object.hasOwn(fields, "receipt")) { assignments.push("receipt_json = ?"); values.push(fields.receipt ? JSON.stringify(fields.receipt) : null); }
    if (["done", "failed", "aborted"].includes(status)) { assignments.push("finished_at = ?"); values.push(now); }
    if (status === "running" || status === "paused") assignments.push("finished_at = NULL");
    this.#update(requestId, assignments.join(", "), values);
    this.appendEvent(requestId, "status", { status });
  }

  setExecutionId(requestId: string, executionId: string | null): void {
    this.#update(requestId, "execution_id = ?", [executionId]);
  }

  setSandbox(requestId: string, sandbox: SandboxSummary | null): void {
    const serialized = sandbox ? JSON.stringify(sandbox) : null;
    this.#update(requestId, "sandbox_json = ?", [serialized]);
    this.appendEvent(requestId, "sandbox", (sandbox ?? { status: "stopped" }) as unknown as Record<string, unknown>);
  }

  applyControl(requestId: string, action: RunControlAction | null, revision: number): boolean {
    const current = this.get(requestId);
    if (!current || !Number.isInteger(revision) || revision <= current.control_revision) return false;
    this.#update(requestId, "desired_action = ?, control_revision = ?", [action, revision]);
    this.appendEvent(requestId, "control", { action, control_revision: revision });
    return true;
  }

  setControl(requestId: string, action: RunControlAction | null, revision: number): boolean {
    return this.applyControl(requestId, action, revision);
  }

  appendEvent(requestId: string, kind: string, data: Record<string, unknown> = {}): RuntimeEvent {
    const eventKind = /^[a-z][a-z0-9_]{0,39}$/.test(kind) ? kind : "update";
    const safe = safeEventValue(data) as Record<string, unknown>;
    const encoded = JSON.stringify(safe);
    const serialized = Buffer.byteLength(encoded) <= 4096 ? encoded : JSON.stringify({ truncated: true });
    const createdAt = new Date().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database.prepare("SELECT event_sequence FROM runs WHERE request_id = ?").get(requestId) as { event_sequence?: number } | undefined;
      if (!row) throw new Error("Run record disappeared during event append");
      const sequence = Number(row.event_sequence ?? 0) + 1;
      this.#database.prepare("INSERT INTO run_events(request_id, sequence, kind, created_at, data_json) VALUES (?, ?, ?, ?, ?)")
        .run(requestId, sequence, eventKind, createdAt, serialized);
      this.#database.prepare("UPDATE runs SET event_sequence = ?, updated_at = ? WHERE request_id = ?").run(sequence, createdAt, requestId);
      this.#database.prepare("DELETE FROM run_events WHERE request_id = ? AND sequence <= ?").run(requestId, sequence - 1000);
      this.#database.exec("COMMIT");
      return { sequence, kind: eventKind, created_at: createdAt, data: safe };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  events(requestId: string, afterSequence = 0, limit = 1000): RuntimeEvent[] {
    return (this.#database.prepare("SELECT * FROM run_events WHERE request_id = ? AND sequence > ? ORDER BY sequence LIMIT ?")
      .all(requestId, Math.max(0, afterSequence), Math.max(1, Math.min(1000, limit))) as Record<string, unknown>[])
      .map((row) => mapEvent(row)!);
  }

  unsyncedEvents(requestId: string, limit = 1000): RuntimeEvent[] {
    const current = this.get(requestId);
    return current ? this.events(requestId, current.synced_sequence, limit) : [];
  }

  markSynced(requestId: string, eventSequence: number): void {
    this.#database.prepare("UPDATE runs SET synced_sequence = MAX(synced_sequence, ?), updated_at = ? WHERE request_id = ?")
      .run(eventSequence, new Date().toISOString(), requestId);
  }

  prepareSync(requestId: string, body: Record<string, unknown>, eventSequence: number): { sequence: number; body: Record<string, unknown>; event_sequence: number } {
    const pending = this.#database.prepare("SELECT sequence, event_sequence, body_json FROM runtime_sync_pending WHERE request_id = ?")
      .get(requestId) as { sequence: number; event_sequence: number; body_json: string } | undefined;
    if (pending) return { sequence: Number(pending.sequence), body: JSON.parse(pending.body_json) as Record<string, unknown>, event_sequence: Number(pending.event_sequence) };
    const current = this.get(requestId);
    if (!current) throw new Error("Run record disappeared during sync preparation");
    const sequence = current.sync_revision + 1;
    const encoded = JSON.stringify(body);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare("UPDATE runs SET sync_revision = ?, updated_at = ? WHERE request_id = ?")
        .run(sequence, new Date().toISOString(), requestId);
      this.#database.prepare("INSERT INTO runtime_sync_pending(request_id, sequence, event_sequence, body_json) VALUES (?, ?, ?, ?)")
        .run(requestId, sequence, eventSequence, encoded);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return { sequence, body, event_sequence: eventSequence };
  }

  completeSync(requestId: string, sequence: number, eventSequence: number): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare("DELETE FROM runtime_sync_pending WHERE request_id = ? AND sequence = ?").run(requestId, sequence);
      this.#database.prepare("UPDATE runs SET synced_sequence = MAX(synced_sequence, ?), updated_at = ? WHERE request_id = ?")
        .run(eventSequence, new Date().toISOString(), requestId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  nextSyncRevision(requestId: string): number {
    const result = this.#database.prepare("UPDATE runs SET sync_revision = sync_revision + 1, updated_at = ? WHERE request_id = ? RETURNING sync_revision")
      .get(new Date().toISOString(), requestId) as { sync_revision: number } | undefined;
    if (!result) throw new Error("Run record disappeared during sync revision allocation");
    return Number(result.sync_revision);
  }

  incrementTurnCount(requestId: string): number {
    const result = this.#database.prepare("UPDATE runs SET turn_count = turn_count + 1, updated_at = ? WHERE request_id = ? RETURNING turn_count")
      .get(new Date().toISOString(), requestId) as { turn_count: number } | undefined;
    if (!result) throw new Error("Run record disappeared during turn accounting");
    return Number(result.turn_count);
  }

  saveSandboxEvidence(requestId: string, evidence: Record<string, unknown>): void {
    const rows = this.#database.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM sandbox_evidence WHERE request_id = ?")
      .get(requestId) as { sequence: number };
    const sequence = Number(rows.sequence) + 1;
    const safe = safeEvidence(evidence);
    const encoded = JSON.stringify(safe);
    this.#database.prepare("INSERT INTO sandbox_evidence(request_id, sequence, created_at, data_json) VALUES (?, ?, ?, ?)")
      .run(requestId, sequence, new Date().toISOString(), Buffer.byteLength(encoded) <= 18000 ? encoded : JSON.stringify({ truncated: true }));
    this.#database.prepare("DELETE FROM sandbox_evidence WHERE request_id = ? AND sequence <= ?")
      .run(requestId, sequence - 100);
  }

  sandboxEvidence(requestId: string): Array<Record<string, unknown>> {
    return (this.#database.prepare("SELECT data_json FROM sandbox_evidence WHERE request_id = ? ORDER BY sequence")
      .all(requestId) as { data_json: string }[])
      .map((row) => parseJson<Record<string, unknown>>(row.data_json) ?? {});
  }

  close(): void {
    this.#database.close();
  }

  #update(requestId: string, assignments: string, values: SQLInputValue[]): void {
    const result = this.#database.prepare(`UPDATE runs SET ${assignments}, updated_at = ? WHERE request_id = ?`)
      .run(...values, new Date().toISOString(), requestId);
    if (result.changes !== 1) throw new Error("Run record disappeared during an update");
  }
}
