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

const EVENT_ID = "run-done-proof";
const PROJECT_ID = "project-done-proof";
const TASK_ID = "task-done-proof";
const AGENT_ID = "agent-done-proof";
const EXECUTION_ID = "execution-done-proof";
const MODEL_CONFIG = {
  provider_id: "provider-done-proof",
  model_id: "model-done-proof",
  reasoning_effort: "low",
  max_output_tokens: 64,
};
const EXECUTION_CONFIG = {
  instructions: "",
  tool_connection_ids: [],
  sandbox_profile_id: null,
  limits: { max_turns: 2, timeout_seconds: 30 },
};
const RUNTIME_TOKEN = "runtime-secret-done-proof";
const AGENT_TOKEN = "agent-secret-done-proof";

function makeEvent(deliveryToken) {
  return {
    id: EVENT_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    agent_id: AGENT_ID,
    type: "run_task",
    payload: { model_config: MODEL_CONFIG },
    delivery_token: deliveryToken,
    attempts: 2,
  };
}

function runtimeConfig(dataDir, apiUrl, workerId) {
  return loadConfig({
    NODE_ENV: "test",
    ORDIVANT_RUNTIME_MODE: "demo",
    ORDIVANT_RUNTIME_TOKEN: RUNTIME_TOKEN,
    ORDIVANT_RUNTIME_WORKER_ID: workerId,
    ORDIVANT_DATA_DIR: dataDir,
    ORDIVANT_API_URL: apiUrl,
  });
}

function handoff(event) {
  return {
    agent: { id: event.agent_id, token: AGENT_TOKEN },
    model_config: MODEL_CONFIG,
    provider: {
      id: MODEL_CONFIG.provider_id,
      name: "Done proof provider",
      base_url: "https://provider.example.test/v1",
      api_key: "provider-secret-done-proof",
      models: [{
        id: MODEL_CONFIG.model_id,
        name: "Done proof model",
        context_window: 4096,
        max_output_tokens: 128,
        reasoning_efforts: ["low"],
      }],
    },
    execution_config: EXECUTION_CONFIG,
    tool_connections: [],
    sandbox_profile: null,
  };
}

function executionReceipt() {
  return {
    mode: "live",
    requested: MODEL_CONFIG,
    returned: { provider_id: MODEL_CONFIG.provider_id, model_id: MODEL_CONFIG.model_id },
    usage: {
      input_tokens: 10,
      uncached_input_tokens: 10,
      cached_input_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 5,
      total_tokens: 15,
    },
    tools: [],
    cost_usd: null,
  };
}

function expectedSubmission(answer, receipt) {
  return {
    execution_id: EXECUTION_ID,
    summary: answer,
    artifacts: [{
      kind: "summary",
      title: "Pi Durable live model result",
      content: answer,
    }, {
      kind: "test_report",
      title: "Live model usage and tool receipt",
      content: JSON.stringify(receipt, null, 2),
    }],
  };
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function startFixture(handler) {
  const server = createServer((request, response) => {
    void readRequest(request).then((body) => handler(request, response, body)).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { detail: { message: "fixture handler failed" } });
      else response.destroy();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      if (!server.listening) return;
      server.close();
      await once(server, "close");
    },
  };
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for done Run mismatch handling");
}

async function verifyMismatch(mismatch) {
  const dataDir = mkdtempSync(join(tmpdir(), `ordivant-done-${mismatch}-`));
  const workerId = `runtime-done-${mismatch}`;
  const event = makeEvent(`delivery-${workerId}`);
  const answer = "Persisted answer requiring exact task evidence.";
  const receipt = executionReceipt();
  const expected = expectedSubmission(answer, receipt);
  const seen = { outboxClaims: 0, contexts: 0, taskClaims: 0, submissions: 0, syncs: [] };
  let fixture;
  let engine;
  let dispatcher;

  try {
    fixture = await startFixture(async (request, response, body) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const runtimeRequest = url.pathname.startsWith("/api/runtime/");
      const token = runtimeRequest ? RUNTIME_TOKEN : AGENT_TOKEN;
      if (request.headers.authorization !== `Bearer ${token}`) {
        sendJson(response, 401, { detail: { message: "wrong scoped credential" } });
        return;
      }

      if (url.pathname === "/api/runtime/outbox/claim") {
        seen.outboxClaims += 1;
        sendJson(response, 200, seen.outboxClaims === 1 ? [event] : []);
      } else if (url.pathname === `/api/runtime/outbox/${EVENT_ID}/configuration`) {
        assert.equal(body.delivery_token, event.delivery_token);
        sendJson(response, 200, handoff(event));
      } else if (url.pathname === `/api/runtime/outbox/${EVENT_ID}/renew`) {
        sendJson(response, 200, { id: EVENT_ID, status: "claimed" });
      } else if (url.pathname === "/api/runtime/runs/controls") {
        sendJson(response, 200, []);
      } else if (url.pathname === "/api/runtime/workflows/tick") {
        sendJson(response, 200, { admitted: 0 });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/context`) {
        seen.contexts += 1;
        const artifacts = expected.artifacts.map((artifact, index) => ({
          id: `artifact-${index}`,
          task_id: TASK_ID,
          execution_id: EXECUTION_ID,
          ...artifact,
        }));
        const executions = [{
          id: mismatch === "execution" ? "execution-from-another-run" : EXECUTION_ID,
          task_id: TASK_ID,
          agent_id: AGENT_ID,
          status: "submitted",
          summary: expected.summary,
        }];
        if (mismatch === "artifact") artifacts[1].content = "Receipt from a different execution.";
        sendJson(response, 200, {
          task: { id: TASK_ID, status: "in_review" },
          executions,
          artifacts,
          messages: [],
          events: [],
          dependencies: [],
        });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/claim`) {
        seen.taskClaims += 1;
        sendJson(response, 409, { detail: { code: "conflict", message: "Task is already in review" } });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/submit`) {
        seen.submissions += 1;
        sendJson(response, 500, { detail: { message: "mismatched evidence must not submit" } });
      } else if (url.pathname === `/api/runtime/runs/${EVENT_ID}/sync`) {
        seen.syncs.push(body);
        sendJson(response, 200, { id: EVENT_ID, status: body.status });
      } else {
        sendJson(response, 404, { detail: { message: "not found" } });
      }
    });

    const config = runtimeConfig(dataDir, fixture.url, workerId);
    engine = new RuntimeEngine(config);
    engine.store.reserve({
      request_id: event.id,
      task_id: event.task_id,
      agent_id: event.agent_id,
      project_id: event.project_id,
      prompt: "The persisted result must be confirmed against task evidence.",
      model_config: MODEL_CONFIG,
      execution_id: EXECUTION_ID,
      execution_config: EXECUTION_CONFIG,
      tool_connections: [],
      sandbox_profile: null,
      mode: "live",
    }, "persisted-done-conversation");
    engine.store.setStatus(event.id, "done", { answer, receipt });
    dispatcher = new OutboxDispatcher(config, engine, {
      pollIntervalMs: 5,
      leaseSeconds: 30,
      outboxLeaseHeartbeatMs: 60_000,
      workflowTickIntervalMs: 5,
      controlPollIntervalMs: 5,
      syncIntervalMs: 5,
    });
    const loop = dispatcher.start();

    try {
      await waitFor(() => seen.syncs.length > 0);
    } finally {
      await dispatcher.stop();
      await loop;
    }

    assert.equal(seen.contexts, 1);
    assert.equal(seen.taskClaims, 1);
    assert.equal(seen.submissions, 0);
    assert.deepEqual(seen.syncs.map((item) => item.status), ["failed"]);
    assert.equal(engine.store.get(EVENT_ID)?.status, "failed");
  } finally {
    await dispatcher?.stop().catch(() => undefined);
    await engine?.close().catch(() => undefined);
    await fixture?.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test("done recovery rejects a submitted execution with a different execution id", async () => {
  await verifyMismatch("execution");
});

test("done recovery rejects artifacts that do not match the persisted receipt", async () => {
  await verifyMismatch("artifact");
});
