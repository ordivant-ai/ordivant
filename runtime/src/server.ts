import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OutboxDispatcher } from "./dispatcher.js";
import { loadConfig } from "./config.js";
import { RuntimeEngine, RunConflictError } from "./engine.js";
import { PlatformError } from "./platform-client.js";
import type { RuntimeConfig, RunRecord } from "./types.js";

const BODY_LIMIT = 256 * 1024;

function bearerMatches(request: IncomingMessage, expected: string | undefined): boolean {
  if (!expected) return true;
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new RangeError("Request body is too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new SyntaxError("Request body must be valid JSON");
  }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function publicRun(record: RunRecord) {
  return {
    request_id: record.request_id,
    conversation_id: record.conversation_id,
    submission_id: record.submission_id,
    status: record.status,
    mode: record.mode,
    model_config: record.model_config,
    answer: record.answer,
    error: record.error,
    receipt: record.receipt,
  };
}

export function createRuntimeServer(config: RuntimeConfig, engine: RuntimeEngine): Server {
  return createServer(async (request, response) => {
    let pathname = "/";
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = url.pathname;

      if (request.method === "GET" && pathname === "/health") {
        send(response, 200, {
          status: "ok",
          engine: "Pi Durable",
          storage: "SQLite",
          mode: config.mode,
          model_provider: config.modelProvider,
          model_id: config.modelId,
          model_calls: config.mode === "demo" ? "deterministic_demo" : "outbox_selection_required",
        });
        return;
      }

      if (!bearerMatches(request, config.runtimeToken)) {
        send(response, 401, { detail: { code: "unauthorized", message: "Runtime authentication required" } });
        return;
      }

      if (request.method === "POST" && pathname === "/runs") {
        const run = await engine.enqueue(await readJson(request));
        send(response, 202, run);
        return;
      }

      const runRoute = pathname.match(/^\/runs\/([^/]+)(?:\/(resume|abort))?$/);
      if (runRoute) {
        let requestId: string;
        try {
          requestId = decodeURIComponent(runRoute[1]);
        } catch {
          send(response, 400, { detail: { code: "invalid_id", message: "Run id is invalid" } });
          return;
        }
        const action = runRoute[2];
        if (request.method === "GET" && !action) {
          const run = engine.store.get(requestId);
          if (!run) send(response, 404, { detail: { code: "not_found", message: "Run not found" } });
          else send(response, 200, publicRun(run));
          return;
        }
        if (request.method === "POST" && action === "resume") {
          const run = await engine.resume(requestId);
          if (!run) send(response, 404, { detail: { code: "not_found", message: "Run not found" } });
          else send(response, 202, run);
          return;
        }
        if (request.method === "POST" && action === "abort") {
          const run = await engine.abort(requestId);
          if (!run) send(response, 404, { detail: { code: "not_found", message: "Run not found" } });
          else send(response, 200, publicRun(run));
          return;
        }
      }

      send(response, 404, { detail: { code: "not_found", message: "Runtime endpoint not found" } });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof RunConflictError) {
        send(response, 409, { detail: { code: "request_id_conflict", message: error.message } });
      } else if (error instanceof RangeError) {
        send(response, 413, { detail: { code: "body_too_large", message: "Request body is too large" } });
      } else if (error instanceof SyntaxError) {
        send(response, 400, { detail: { code: "invalid_json", message: error.message } });
      } else if (error instanceof PlatformError) {
        send(response, error.status, { detail: { code: "platform_error", message: error.message } });
      } else if (error instanceof Error && /required|valid string|model must|only supports|not available/i.test(error.message)) {
        send(response, 422, { detail: { code: "invalid_run", message: error.message } });
      } else {
        console.error(`[runtime] ${request.method ?? "?"} ${pathname} failed`);
        send(response, 500, { detail: { code: "runtime_error", message: "Runtime request failed" } });
      }
    }
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const engine = new RuntimeEngine(config);
  const server = createRuntimeServer(config, engine);
  const dispatcherEnabled = process.argv.includes("--dispatcher");
  let dispatcher: OutboxDispatcher | undefined;

  server.listen(config.port, config.host, () => {
    console.log(`[runtime] Pi Durable ${config.mode} mode listening on http://${config.host}:${config.port}`);
  });
  if (dispatcherEnabled) {
    dispatcher = new OutboxDispatcher(config, engine);
    void dispatcher.start();
  } else {
    void engine.resumePending();
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    await dispatcher?.stop();
    await engine.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) void main();
