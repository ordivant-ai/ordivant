import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../dist/config.js";
import { OutboxDispatcher } from "../dist/dispatcher.js";
import { RuntimeEngine } from "../dist/engine.js";

const EVENT_ID = "run-lease-serialized";
const PROJECT_ID = "project-lease-serialized";
const TASK_ID = "task-lease-serialized";
const AGENT_ID = "agent-lease-serialized";
const EXECUTION_ID = "execution-lease-serialized";
const WORKER_ID = "runtime-lease-serialized";
const RUNTIME_TOKEN = "runtime-secret-lease-serialized";
const AGENT_TOKEN = "agent-secret-lease-serialized";
const PROVIDER_TOKEN = "provider-secret-lease-serialized";
const MODEL_CONFIG = {
  provider_id: "provider-lease-serialized",
  model_id: "synthetic-lease-model",
  reasoning_effort: "low",
  max_output_tokens: 128,
};
const EXECUTION_CONFIG = {
  instructions: "",
  tool_connection_ids: [],
  sandbox_profile_id: null,
  limits: { max_turns: 2, timeout_seconds: 30 },
};

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

function runtimeConfig(dataDir, apiUrl, workerId = WORKER_ID) {
  return loadConfig({
    NODE_ENV: "test",
    ORDIVANT_RUNTIME_MODE: "live",
    ORDIVANT_RUNTIME_TOKEN: RUNTIME_TOKEN,
    ORDIVANT_RUNTIME_WORKER_ID: workerId,
    ORDIVANT_DATA_DIR: dataDir,
    ORDIVANT_API_URL: apiUrl,
  });
}

function waitFor(predicate, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() >= deadline) return reject(new Error("dispatcher did not finish the serialized lease run"));
      setTimeout(poll, 10);
    };
    poll();
  });
}

test("dispatcher serializes renew and progress against the current execution lease", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-lease-serialization-"));
  const event = {
    id: EVENT_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    agent_id: AGENT_ID,
    type: "run_task",
    payload: { model_config: MODEL_CONFIG },
    delivery_token: "delivery-token-lease-serialized",
    attempts: 1,
  };
  const seen = {
    renewals: [],
    progress: [],
    submissions: [],
    terminalSyncs: [],
    staleLeaseBodies: [],
    modelRequests: 0,
    enqueueResumedDuringRenewal: false,
    progress5DuringRenewal: false,
  };
  let currentLeaseToken = "claim-token-lease-serialized";
  let renewCount = 0;
  let secondRenewalPending = false;
  let outboxClaimed = false;
  let platformServer;
  let responsesServer;
  let engine;
  let dispatcher;

  try {
    responsesServer = createServer(async (request, response) => {
      await readRequest(request);
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.headers.authorization, `Bearer ${PROVIDER_TOKEN}`);
      seen.modelRequests += 1;
      const output = {
        type: "message",
        id: "lease-final-message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "LEASE_SERIALIZATION_OK", annotations: [] }],
      };
      const events = [
        { type: "response.created", response: { id: "lease-response" } },
        { type: "response.output_item.added", output_index: 0, item: output },
        { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "LEASE_SERIALIZATION_OK" },
        { type: "response.output_item.done", output_index: 0, item: output },
        {
          type: "response.completed",
          response: {
            id: "lease-response",
            model: MODEL_CONFIG.model_id,
            status: "completed",
            output: [output],
            usage: {
              input_tokens: 12,
              output_tokens: 4,
              total_tokens: 16,
              input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
              output_tokens_details: {},
            },
          },
        },
      ];
      response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      for (const item of events) response.write(`event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`);
      response.end();
    });
    const responsesUrl = await listen(responsesServer);

    platformServer = createServer(async (request, response) => {
      const body = await readRequest(request);
      const url = new URL(request.url, "http://127.0.0.1");
      const path = url.pathname;
      const runtimeRequest = path.startsWith("/api/runtime/");
      const expectedAuth = runtimeRequest ? `Bearer ${RUNTIME_TOKEN}` : `Bearer ${AGENT_TOKEN}`;
      if (request.headers.authorization !== expectedAuth) {
        sendJson(response, 401, { detail: { message: "wrong scoped credential" } });
        return;
      }

      if (path === "/api/runtime/outbox/claim") {
        sendJson(response, 200, outboxClaimed ? [] : (outboxClaimed = true, [event]));
      } else if (path === `/api/runtime/outbox/${EVENT_ID}/configuration`) {
        sendJson(response, 200, {
          agent: { id: AGENT_ID, token: AGENT_TOKEN },
          model_config: MODEL_CONFIG,
          provider: {
            id: MODEL_CONFIG.provider_id,
            name: "Local lease serialization fixture",
            base_url: `${responsesUrl}/v1`,
            api_key: PROVIDER_TOKEN,
            models: [{
              id: MODEL_CONFIG.model_id,
              name: "Synthetic lease model",
              context_window: 4096,
              max_output_tokens: 1024,
              reasoning_efforts: ["low"],
            }],
          },
          execution_config: EXECUTION_CONFIG,
          tool_connections: [],
          sandbox_profile: null,
        });
      } else if (path === `/api/runtime/outbox/${EVENT_ID}/renew`) {
        sendJson(response, 200, { id: EVENT_ID, status: "claimed" });
      } else if (path === "/api/runtime/runs/controls") {
        sendJson(response, 200, []);
      } else if (path === "/api/runtime/workflows/tick") {
        sendJson(response, 200, { admitted: 0 });
      } else if (path === `/api/tasks/${TASK_ID}/claim`) {
        sendJson(response, 200, {
          task: {
            id: TASK_ID,
            project_id: PROJECT_ID,
            title: "Lease operation serialization",
            description: "Reproduce the execution startup renewal racing dispatcher progress.",
            goal: "Every task mutation must use the current fenced lease token.",
            inputs: "",
            scope: "local runtime test",
            constraints: "No external provider calls.",
            acceptance_criteria: ["Renewal, progress, and submit use the latest lease token."],
          },
          execution: { id: EXECUTION_ID, lease_expires_at: new Date(Date.now() + 300_000).toISOString() },
          lease_token: currentLeaseToken,
        });
      } else if (path === `/api/tasks/${TASK_ID}/renew`) {
        if (body.lease_token !== currentLeaseToken) {
          seen.staleLeaseBodies.push({ path, token: body.lease_token, current: currentLeaseToken });
          sendJson(response, 409, { detail: { code: "lease_lost", message: "execution lease token is stale" } });
          return;
        }
        const previousToken = currentLeaseToken;
        currentLeaseToken = `rotated-lease-${++renewCount}`;
        seen.renewals.push({ used: body.lease_token, returned: currentLeaseToken, previous: previousToken });
        if (renewCount === 2) {
          secondRenewalPending = true;
          await new Promise((resolve) => setTimeout(resolve, 160));
          secondRenewalPending = false;
        }
        sendJson(response, 200, { execution: { id: EXECUTION_ID }, lease_token: currentLeaseToken });
      } else if (path === `/api/tasks/${TASK_ID}/progress`) {
        if (body.progress === 5 && secondRenewalPending) seen.progress5DuringRenewal = true;
        if (body.lease_token !== currentLeaseToken) {
          seen.staleLeaseBodies.push({ path, token: body.lease_token, current: currentLeaseToken, progress: body.progress });
          sendJson(response, 409, { detail: { code: "lease_lost", message: "execution lease token is stale" } });
          return;
        }
        seen.progress.push({ progress: body.progress, token: body.lease_token });
        sendJson(response, 200, { id: TASK_ID, progress: body.progress });
      } else if (path === `/api/tasks/${TASK_ID}/submit`) {
        if (body.lease_token !== currentLeaseToken) {
          seen.staleLeaseBodies.push({ path, token: body.lease_token, current: currentLeaseToken });
          sendJson(response, 409, { detail: { code: "lease_lost", message: "execution lease token is stale" } });
          return;
        }
        seen.submissions.push(body);
        sendJson(response, 200, { task: { id: TASK_ID, status: "in_review" } });
      } else if (path === `/api/runtime/runs/${EVENT_ID}/sync`) {
        if (["done", "failed", "aborted"].includes(body.status)) seen.terminalSyncs.push(body);
        sendJson(response, 200, { id: EVENT_ID, status: body.status });
      } else {
        sendJson(response, 404, { detail: { message: "not found" } });
      }
    });
    const apiUrl = await listen(platformServer);
    const config = runtimeConfig(dataDir, apiUrl);
    engine = new RuntimeEngine(config);
    const actualEnqueue = engine.enqueue.bind(engine);
    engine.enqueue = async (...args) => {
      const result = await actualEnqueue(...args);
      await waitFor(() => seen.renewals.length >= 2);
      seen.enqueueResumedDuringRenewal = secondRenewalPending;
      return result;
    };
    dispatcher = new OutboxDispatcher(config, engine, {
      pollIntervalMs: 5,
      leaseSeconds: 30,
      outboxLeaseHeartbeatMs: 60_000,
      workflowTickIntervalMs: 10,
      controlPollIntervalMs: 5,
      syncIntervalMs: 10,
    });
    const dispatchLoop = dispatcher.start();
    await waitFor(() => seen.terminalSyncs.length > 0);
    await dispatcher.stop();
    await dispatchLoop;

    assert.deepEqual(seen.staleLeaseBodies, []);
    assert.equal(seen.enqueueResumedDuringRenewal, true, "the dispatcher must face an in-flight engine lease renewal");
    assert.equal(seen.progress5DuringRenewal, false, "progress HTTP request must wait for the current renewal to finish");
    assert.equal(renewCount >= 2, true, "the real engine startup gate must renew the lease after dispatcher admission");
    assert.ok(seen.progress.some((item) => item.progress === 5));
    assert.ok(seen.progress.some((item) => item.progress === 90));
    assert.equal(seen.modelRequests, 1);
    assert.equal(seen.submissions.length, 1);
    assert.equal(seen.submissions[0].lease_token, currentLeaseToken);
    assert.equal(seen.terminalSyncs.at(-1).status, "done");
  } finally {
    await dispatcher?.stop().catch(() => undefined);
    if (platformServer) await close(platformServer);
    if (responsesServer) await close(responsesServer);
    if (engine) await engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
