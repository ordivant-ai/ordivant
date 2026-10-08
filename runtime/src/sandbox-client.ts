import type { RuntimeConfig, SandboxLimits, SandboxProfile } from "./types.js";

const MAX_BODY_BYTES = 64 * 1024 * 1024;

export interface SandboxCreateResult {
  run_id: string;
  status: "ready";
  token: string;
}

export class SandboxClient {
  constructor(private readonly config: RuntimeConfig) {}

  async create(runId: string, profile: SandboxProfile): Promise<SandboxCreateResult> {
    const value = await this.#request<unknown>("POST", "/sandboxes", {
      run_id: runId,
      profile: { limits: profile.limits },
    }, this.config.sandboxToken, profile.limits.timeout_seconds + 10);
    if (!value || typeof value !== "object") throw new Error("Sandbox executor returned an invalid create response");
    const result = value as Record<string, unknown>;
    if (result.run_id !== runId || result.status !== "ready" || typeof result.token !== "string" || result.token.length < 32) {
      throw new Error("Sandbox executor returned an invalid create response");
    }
    return { run_id: runId, status: "ready", token: result.token };
  }

  execute(runId: string, capability: string, limits: SandboxLimits, command: string[], timeoutSeconds?: number) {
    const timeout = Math.min(timeoutSeconds ?? limits.timeout_seconds, limits.timeout_seconds);
    return this.#request<Record<string, unknown>>("POST", `/sandboxes/${encodeURIComponent(runId)}/execute`, {
      command,
      timeout_seconds: timeout,
    }, capability, timeout + 10);
  }

  writeFile(runId: string, capability: string, limits: SandboxLimits, path: string, content: string) {
    return this.#request<Record<string, unknown>>("POST", `/sandboxes/${encodeURIComponent(runId)}/files/write`, {
      path,
      content,
    }, capability, Math.min(10, limits.timeout_seconds) + 5);
  }

  readFile(runId: string, capability: string, limits: SandboxLimits, path: string) {
    return this.#request<Record<string, unknown>>("POST", `/sandboxes/${encodeURIComponent(runId)}/files/read`, {
      path,
    }, capability, Math.min(10, limits.timeout_seconds) + 5);
  }

  listFiles(runId: string, capability: string, limits: SandboxLimits, path: string) {
    return this.#request<Record<string, unknown>>("POST", `/sandboxes/${encodeURIComponent(runId)}/files/list`, {
      path,
    }, capability, Math.min(10, limits.timeout_seconds) + 5);
  }

  async stop(runId: string, capability: string): Promise<void> {
    await this.#request("DELETE", `/sandboxes/${encodeURIComponent(runId)}`, undefined, capability, 10);
  }

  async #request<T>(method: "POST" | "DELETE", path: string, body: unknown, token: string | undefined, timeoutSeconds: number): Promise<T> {
    if (!this.config.sandboxUrl || !token) throw new Error("Sandbox execution is not configured for this run");
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized && Buffer.byteLength(serialized) > MAX_BODY_BYTES) throw new Error("Sandbox request exceeds the configured size limit");
    let response: Response;
    try {
      response = await fetch(`${this.config.sandboxUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(serialized ? { "content-type": "application/json" } : {}) },
        body: serialized,
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
        redirect: "error",
      });
    } catch {
      throw new Error("Sandbox executor request failed or timed out");
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > 1_048_576) throw new Error("Sandbox executor response exceeded the size limit");
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      throw new Error("Sandbox executor returned invalid JSON");
    }
    if (!response.ok) {
      const detail = data && typeof data === "object" ? (data as Record<string, unknown>).detail : undefined;
      throw new Error(typeof detail === "string" ? detail.slice(0, 300) : `Sandbox executor rejected the request (${response.status})`);
    }
    return data as T;
  }
}
