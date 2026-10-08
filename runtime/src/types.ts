export type RuntimeMode = "demo" | "live";
export type RunStatus = "queued" | "running" | "paused" | "done" | "failed" | "aborted";
export type RunControlAction = "pause" | "resume" | "stop" | "retry";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ExecutionLimits {
  max_turns: number;
  timeout_seconds: number;
}

export interface ExecutionConfig {
  instructions: string;
  tool_connection_ids: string[];
  sandbox_profile_id: string | null;
  limits: ExecutionLimits;
}

export interface ToolConnectionSnapshot {
  id: string;
  name: string;
  endpoint: string;
  allowed_tools: string[];
}

export interface ToolConnectionCredential extends ToolConnectionSnapshot {
  auth_token: string | null;
}

export interface SandboxLimits {
  timeout_seconds: number;
  memory_mb: number;
  cpu_count: number;
  pids_limit: number;
  output_bytes: number;
  workspace_mb: number;
}

export interface SandboxProfile {
  id: string;
  project_id: string;
  name: string;
  limits: SandboxLimits;
}

export interface SandboxSummary {
  run_id: string;
  status: "ready" | "stopped" | "failed" | "lost";
  workspace_available: boolean;
}

export interface RuntimeEvent {
  sequence: number;
  kind: string;
  created_at: string;
  data: Record<string, unknown>;
}

export interface ModelSelection {
  provider_id: string;
  model_id: string;
  reasoning_effort: ReasoningEffort;
  max_output_tokens: number;
}

export interface ProviderModelDefinition {
  id: string;
  name: string;
  context_window: number;
  max_output_tokens: number;
  reasoning_efforts: ReasoningEffort[];
}

export interface ConfiguredProvider {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  models: ProviderModelDefinition[];
}

export interface RunReceipt {
  mode: RuntimeMode;
  requested: ModelSelection | null;
  returned: { provider_id: string; model_id: string } | null;
  usage: {
    input_tokens: number | null;
    uncached_input_tokens: number | null;
    cached_input_tokens: number | null;
    cache_write_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  } | null;
  tools: Array<{ name: string; calls: number }>;
  cost_usd: null;
}

export interface RunInput {
  request_id: string;
  task_id: string;
  agent_id: string;
  prompt: string;
  model?: string;
  model_config?: ModelSelection | null;
  execution_id?: string | null;
  retry_of?: string | null;
  execution_config?: ExecutionConfig;
  tool_connections?: ToolConnectionSnapshot[];
  sandbox_profile?: SandboxProfile | null;
}

export interface RunRecord extends RunInput {
  project_id: string | null;
  mode: RuntimeMode;
  conversation_id: string;
  submission_id: string | null;
  status: RunStatus;
  execution_id: string | null;
  desired_action: RunControlAction | null;
  control_revision: number;
  retry_of: string | null;
  answer: string | null;
  error: string | null;
  receipt: RunReceipt | null;
  sandbox: SandboxSummary | null;
  started_at: string | null;
  finished_at: string | null;
  event_sequence: number;
  synced_sequence: number;
  sync_revision: number;
  turn_count: number;
  payload_hash: string;
  created_at: string;
  updated_at: string;
}

export interface RunResponse {
  request_id: string;
  conversation_id: string;
  submission_id: string | null;
  status: RunStatus;
  receipt: RunReceipt | null;
}

export interface AgentCredential {
  id: string;
  token: string;
}

export interface RuntimeConfig {
  readonly mode: RuntimeMode;
  readonly dataDir: string;
  readonly runtimeDir: string;
  readonly bootstrapPath: string;
  readonly apiUrl: string;
  readonly runtimeToken: string | undefined;
  readonly modelProvider: "ordivant-demo" | "runtime-selection";
  readonly modelId: string;
  readonly port: number;
  readonly host: string;
  readonly workerId: string;
  readonly sandboxUrl: string | undefined;
  readonly sandboxToken: string | undefined;
  readonly toolAllowedHosts: readonly string[];
  readonly toolHttpHosts: readonly string[];
  readonly toolPrivateHosts: readonly string[];
}

export interface LeaseContext {
  execution_id: string;
  lease_token: string;
  lease_seconds: number;
}

export interface RunExecutionContext {
  project_id: string | null;
  lease?: LeaseContext;
  agent_credential?: AgentCredential;
  desired_action?: RunControlAction | null;
  control_revision?: number;
  execution_config?: ExecutionConfig;
  tool_connections?: ToolConnectionCredential[];
  sandbox_profile?: SandboxProfile | null;
  sandbox_capability?: string;
  sandbox_summary?: SandboxSummary | null;
  lease_lost?: boolean;
  turn_limit_exceeded?: boolean;
  recordSandboxEvidence?: (evidence: Record<string, unknown>) => void;
  wakeControlGate?: () => void;
  deadline_at?: string;
  beforeToolOperation?: () => Promise<void>;
  withLeaseOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
  assertLease?: () => Promise<void>;
  abortRun?: () => Promise<void>;
}

export interface OutboxEvent {
  id: string;
  project_id: string;
  task_id: string;
  agent_id: string;
  type: "run_task";
  payload: Record<string, unknown>;
  delivery_token: string;
  attempts: number;
}

export interface OutboxConfiguration {
  agent: AgentCredential;
  model_config: ModelSelection | null;
  provider: ConfiguredProvider | null;
  execution_config: ExecutionConfig;
  tool_connections: ToolConnectionCredential[];
  sandbox_profile: SandboxProfile | null;
  control_revision: number;
  desired_action: RunControlAction | null;
  retry_of: string | null;
}

export interface PlatformTask {
  id: string;
  project_id: string;
  title: string;
  description: string;
  goal: string;
  inputs: string;
  scope: string;
  constraints: string;
  acceptance_criteria: string[];
}

export interface ClaimResponse {
  task: PlatformTask;
  execution: { id: string; lease_expires_at: string };
  lease_token: string;
}
