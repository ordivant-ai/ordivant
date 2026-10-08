import type { AgentCredential, RuntimeConfig } from "./types.js";

export class PlatformError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PlatformError";
  }
}

export class PlatformClient {
  constructor(private readonly config: RuntimeConfig) {}

  async agentGet<T>(agentId: string, path: string, credential: AgentCredential): Promise<T> {
    return this.#request<T>({ method: "GET", path, token: this.#agentToken(agentId, credential) });
  }

  async agentPost<T>(
    agentId: string,
    path: string,
    body: unknown,
    idempotencyKey: string,
    credential: AgentCredential,
  ): Promise<T> {
    return this.#request<T>({
      method: "POST",
      path,
      token: this.#agentToken(agentId, credential),
      body,
      idempotencyKey,
    });
  }

  async runtimePost<T>(path: string, body: unknown): Promise<T> {
    if (!this.config.runtimeToken) throw new PlatformError(401, "Runtime credential is unavailable");
    return this.#request<T>({ method: "POST", path, token: this.config.runtimeToken, body });
  }

  async runtimeGet<T>(path: string): Promise<T> {
    if (!this.config.runtimeToken) throw new PlatformError(401, "Runtime credential is unavailable");
    return this.#request<T>({ method: "GET", path, token: this.config.runtimeToken });
  }

  #agentToken(agentId: string, credential: AgentCredential): string {
    if (credential.id !== agentId || !credential.token) {
      throw new PlatformError(401, "Scoped credential for the assigned agent is unavailable");
    }
    return credential.token;
  }

  async #request<T>(request: {
    method: "GET" | "POST";
    path: string;
    token: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${request.token}`,
      accept: "application/json",
    };
    if (request.body !== undefined) headers["content-type"] = "application/json";
    if (request.idempotencyKey) headers["idempotency-key"] = request.idempotencyKey;

    let response: Response;
    try {
      response = await fetch(`${this.config.apiUrl}${request.path}`, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new PlatformError(503, "Platform API is unavailable");
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      throw new PlatformError(502, "Platform API returned invalid JSON");
    }
    if (!response.ok) {
      const detail = data && typeof data === "object" ? (data as Record<string, unknown>).detail : undefined;
      const message = detail && typeof detail === "object" && typeof (detail as Record<string, unknown>).message === "string"
        ? String((detail as Record<string, unknown>).message)
        : `Platform API request failed (${response.status})`;
      throw new PlatformError(response.status, message);
    }
    return data as T;
  }
}
