import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../dist/config.js";
import { OutboxDispatcher } from "../dist/dispatcher.js";
import { RuntimeEngine } from "../dist/engine.js";

const EVENT_ID = "run-recovery-shared";
const PROJECT_ID = "project-recovery";
const TASK_ID = "task-recovery";
const AGENT_ID = "agent-recovery";
const EXECUTION_ID = "execution-recovery";
const SELECTION = {
  provider_id: "provider-recovery",
  model_id: "model-recovery",
  reasoning_effort: "low",
  max_output_tokens: 64,
};
const EXECUTION_CONFIG = {
  instructions: "",
  tool_connection_ids: [],
  sandbox_profile_id: null,
  limits: { max_turns: 2, timeout_seconds: 30 },
};
const SAFE_CONNECTION = {
  id: "connection-recovery",
  name: "Recovery fixture",
  endpoint: "https://mcp.example.test/mcp",
  allowed_tools: ["fixture_echo"],
};

function provider(apiKey) {
  return {
    id: SELECTION.provider_id,
    name: "Recovery provider",
    base_url: "https://provider.example.test/v1",
    api_key: apiKey,
    models: [{
      id: SELECTION.model_id,
      name: "Recovery model",
      context_window: 4096,
      max_output_tokens: 128,
      reasoning_efforts: ["low"],
    }],
  };
}

function makeEvent(deliveryToken) {
  return {
    id: EVENT_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    agent_id: AGENT_ID,
    type: "run_task",
    payload: { model_config: SELECTION },
    delivery_token: deliveryToken,
    attempts: 2,
  };
}

function handoff(event, leaseToken, { providerKey = "provider-secret-fixture", mcpToken = null } = {}) {
  const connections = mcpToken ? [{ ...SAFE_CONNECTION, auth_token: mcpToken }] : [];
  const executionConfig = {
    ...EXECUTION_CONFIG,
    tool_connection_ids: connections.map((item) => item.id),
  };
  return {
    agent: { id: event.agent_id, token: "agent-secret-fixture" },
    model_config: SELECTION,
    provider: provider(providerKey),
    execution_config: executionConfig,
    tool_connections: connections,
    sandbox_profile: null,
    execution_lease: leaseToken ? {
      task_id: event.task_id,
      execution_id: EXECUTION_ID,
      agent_id: event.agent_id,
      lease_token: leaseToken,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    } : null,
  };
}

function runtimeConfig(dataDir, apiUrl, workerId) {
  return loadConfig({
    NODE_ENV: "test",
    ORDIVANT_RUNTIME_MODE: "demo",
    ORDIVANT_RUNTIME_TOKEN: "runtime-secret-fixture",
    ORDIVANT_RUNTIME_WORKER_ID: workerId,
    ORDIVANT_DATA_DIR: dataDir,
    ORDIVANT_API_URL: apiUrl,
  });
}

function seedPausedRun(engine, event, workerId) {
  engine.store.reserve({
    request_id: event.id,
    task_id: event.task_id,
    agent_id: event.agent_id,
    project_id: event.project_id,
    prompt: "Continue the existing Pi request after lease recovery.",
    model_config: SELECTION,
    execution_id: EXECUTION_ID,
    execution_config: EXECUTION_CONFIG,
    tool_connections: [],
    sandbox_profile: null,
    mode: "live",
  }, `persisted-conversation-${workerId}`);
  engine.store.setSubmission(event.id, "existing-pi-submission");
  engine.store.setStatus(event.id, "paused");
  engine.store.setControl(event.id, "pause", 1);
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

async function waitFor(predicate, timeoutMs = 5_000, debug = () => undefined) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for dispatcher recovery state: ${JSON.stringify(debug())}`);
}

function assertNoCredentialBytes(directory, secrets) {
  const visit = (path) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else {
        const bytes = readFileSync(child);
        for (const secret of secrets) assert.equal(bytes.includes(Buffer.from(secret)), false, `${name} persisted a credential`);
      }
    }
  };
  visit(directory);
}

function startFixture(handler) {
  const server = createServer((request, response) => {
    void readRequest(request).then((body) => handler(request, response, body)).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { detail: { message: "fixture handler failed" } });
      else response.destroy();
    });
  });
  return { server, listen: () => listen(server), close: () => close(server) };
}

function executionReceipt() {
  return {
    mode: "live",
    requested: SELECTION,
    returned: { provider_id: SELECTION.provider_id, model_id: SELECTION.model_id },
    usage: { input_tokens: 10, uncached_input_tokens: 10, cached_input_tokens: 0, cache_write_tokens: 0, output_tokens: 5, total_tokens: 15 },
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

test("active Run recovery uses the fresh fenced lease and boot-scoped renew keys", async () => {
  const dataDirs = [mkdtempSync(join(tmpdir(), "ordivant-recovery-a-")), mkdtempSync(join(tmpdir(), "ordivant-recovery-b-"))];
  const workerIds = ["runtime-restart-a", "runtime-restart-b"];
  const deliveryTokens = workerIds.map((workerId) => `delivery-${workerId}`);
  const events = workerIds.map((_, index) => makeEvent(deliveryTokens[index]));
  const engines = [];
  const dispatchers = [];
  const originalDateNow = Date.now;
  const fixedTime = originalDateNow();
  const seen = { claims: new Set(), handoffTokens: new Map(), renews: [], syncs: [], taskClaims: 0, submissions: 0 };
  let fixture;

  try {
    fixture = startFixture(async (request, response, body) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const path = url.pathname;
      if (path.startsWith("/api/runtime/") && request.headers.authorization !== "Bearer runtime-secret-fixture") {
        sendJson(response, 401, { detail: { message: "runtime authorization required" } });
        return;
      }
      if (path === "/api/runtime/outbox/claim") {
        const workerId = body.worker_id;
        if (seen.claims.has(workerId)) sendJson(response, 200, []);
        else {
          seen.claims.add(workerId);
          const index = workerIds.indexOf(workerId);
          sendJson(response, 200, index >= 0 ? [events[index]] : []);
        }
      } else if (path === `/api/runtime/outbox/${EVENT_ID}/configuration`) {
        const index = workerIds.indexOf(body.worker_id);
        const event = index >= 0 ? events[index] : undefined;
        assert.ok(event);
        assert.equal(body.delivery_token, event.delivery_token);
        const token = `lease-secret-${body.worker_id}`;
        seen.handoffTokens.set(body.worker_id, token);
        sendJson(response, 200, handoff(event, token));
      } else if (path === `/api/runtime/outbox/${EVENT_ID}/renew`) {
        sendJson(response, 200, { id: EVENT_ID, status: "claimed" });
      } else if (path === "/api/runtime/runs/controls") {
        const workerId = url.searchParams.get("worker_id");
        const pausedSync = seen.syncs.some((item) => item.worker_id === workerId && item.status === "paused");
        sendJson(response, 200, [{ id: EVENT_ID, desired_action: pausedSync ? "stop" : "pause", control_revision: pausedSync ? 2 : 1 }]);
      } else if (path === "/api/runtime/workflows/tick") {
        sendJson(response, 200, { admitted: 0 });
      } else if (path === `/api/tasks/${TASK_ID}/renew`) {
        const workerId = [...seen.handoffTokens.entries()].find(([, token]) => token === body.lease_token)?.[0];
        assert.ok(workerId, "renewal must use the freshly handed-off lease token");
        seen.renews.push({ worker_id: workerId, idempotency_key: request.headers["idempotency-key"], body });
        sendJson(response, 200, { execution: { id: EXECUTION_ID }, lease_token: body.lease_token });
      } else if (path === `/api/tasks/${TASK_ID}/progress`) {
        sendJson(response, 200, { id: TASK_ID, progress: body.progress });
      } else if (path === `/api/tasks/${TASK_ID}/release`) {
        sendJson(response, 200, { execution: { id: EXECUTION_ID, status: "released" } });
      } else if (path === `/api/tasks/${TASK_ID}/claim`) {
        seen.taskClaims += 1;
        sendJson(response, 500, { detail: { message: "recovery must not claim a second execution" } });
      } else if (path === `/api/tasks/${TASK_ID}/submit`) {
        seen.submissions += 1;
        sendJson(response, 500, { detail: { message: "paused recovery must not submit" } });
      } else if (path === `/api/runtime/runs/${EVENT_ID}/sync`) {
        seen.syncs.push(body);
        sendJson(response, 200, { id: EVENT_ID, status: body.status });
      } else {
        sendJson(response, 404, { detail: { message: "not found" } });
      }
    });
    const apiUrl = await fixture.listen();
    Date.now = () => fixedTime;

    for (let index = 0; index < dataDirs.length; index++) {
      const config = runtimeConfig(dataDirs[index], apiUrl, workerIds[index]);
      const engine = new RuntimeEngine(config);
      seedPausedRun(engine, events[index], workerIds[index]);
      engines.push(engine);
      dispatchers.push(new OutboxDispatcher(config, engine, {
        pollIntervalMs: 5,
        leaseSeconds: 30,
        outboxLeaseHeartbeatMs: 60_000,
        workflowTickIntervalMs: 5,
        controlPollIntervalMs: 5,
        syncIntervalMs: 5,
      }));
    }

    const loops = dispatchers.map((dispatcher) => dispatcher.start());
    await waitFor(
      () => seen.syncs.filter((item) => item.status === "aborted").length === 2,
      5_000,
      () => ({ renews: seen.renews.map((item) => ({ worker_id: item.worker_id, idempotency_key: item.idempotency_key })), syncs: seen.syncs.map((item) => ({ worker_id: item.worker_id, status: item.status })), taskClaims: seen.taskClaims, submissions: seen.submissions }),
    );
    await Promise.all(dispatchers.map((dispatcher) => dispatcher.stop()));
    await Promise.all(loops);

    assert.ok(seen.renews.length >= 2);
    const firstKeyByWorker = workerIds.map((workerId) => seen.renews.find((item) => item.worker_id === workerId)?.idempotency_key);
    assert.ok(firstKeyByWorker.every(Boolean));
    assert.equal(new Set(firstKeyByWorker).size, workerIds.length);
    assert.equal(new Set(seen.renews.map((item) => item.idempotency_key)).size, seen.renews.length);
    assert.equal(seen.taskClaims, 0);
    assert.equal(seen.submissions, 0);
    assert.deepEqual(new Set(seen.renews.map((item) => item.body.execution_id)), new Set([EXECUTION_ID]));
    for (let index = 0; index < engines.length; index++) {
      const record = engines[index].store.get(EVENT_ID);
      assert.equal(record.status, "aborted");
      assert.equal(record.submission_id, "existing-pi-submission");
      await engines[index].close();
    }
    assertNoCredentialBytes(dataDirs[0], ["lease-secret-runtime-restart-a", "provider-secret-fixture", "agent-secret-fixture", "runtime-secret-fixture"]);
    assertNoCredentialBytes(dataDirs[1], ["lease-secret-runtime-restart-b", "provider-secret-fixture", "agent-secret-fixture", "runtime-secret-fixture"]);
  } finally {
    Date.now = originalDateNow;
    await Promise.all(dispatchers.map((dispatcher) => dispatcher.stop().catch(() => undefined)));
    await Promise.all(engines.map((engine) => engine.close().catch(() => undefined)));
    if (fixture) await fixture.close();
    for (const dataDir of dataDirs) rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("done Run with matching submitted artifacts only terminal-syncs and persists no credentials", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-done-recovery-"));
  const workerId = "runtime-done-recovery";
  const event = makeEvent(`delivery-${workerId}`);
  const answer = "A verified result persisted before runtime restart.";
  const receipt = executionReceipt();
  const expected = expectedSubmission(answer, receipt);
  const providerToken = "provider-secret-terminal-fixture";
  const mcpToken = "mcp-secret-terminal-fixture";
  const engineHolder = { engine: undefined };
  const seen = { outboxClaim: 0, taskClaim: 0, submit: 0, context: 0, sync: undefined };
  let fixture;
  let dispatcher;

  try {
    fixture = startFixture(async (request, response, body) => {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const isRuntime = path.startsWith("/api/runtime/");
      const wantedToken = isRuntime ? "runtime-secret-fixture" : "agent-secret-fixture";
      if (request.headers.authorization !== `Bearer ${wantedToken}`) {
        sendJson(response, 401, { detail: { message: "wrong scoped credential" } });
        return;
      }
      if (path === "/api/runtime/outbox/claim") {
        sendJson(response, 200, seen.outboxClaim === 0 ? (seen.outboxClaim += 1, [event]) : []);
      } else if (path === `/api/runtime/outbox/${EVENT_ID}/configuration`) {
        assert.equal(body.delivery_token, event.delivery_token);
        sendJson(response, 200, handoff(event, null, { providerKey: providerToken, mcpToken }));
      } else if (path === `/api/runtime/outbox/${EVENT_ID}/renew`) {
        sendJson(response, 200, { id: EVENT_ID, status: "claimed" });
      } else if (path === "/api/runtime/runs/controls") {
        sendJson(response, 200, []);
      } else if (path === "/api/runtime/workflows/tick") {
        sendJson(response, 200, { admitted: 0 });
      } else if (path === `/api/tasks/${TASK_ID}/context`) {
        seen.context += 1;
        sendJson(response, 200, {
          task: { id: TASK_ID, status: "in_review" },
          executions: [{ id: EXECUTION_ID, task_id: TASK_ID, agent_id: AGENT_ID, status: "submitted", summary: expected.summary }],
          artifacts: expected.artifacts.map((artifact, index) => ({ id: `artifact-${index}`, task_id: TASK_ID, execution_id: EXECUTION_ID, ...artifact })),
          messages: [],
          events: [],
          dependencies: [],
        });
      } else if (path === `/api/tasks/${TASK_ID}/claim`) {
        seen.taskClaim += 1;
        sendJson(response, 500, { detail: { message: "verified done recovery must not claim" } });
      } else if (path === `/api/tasks/${TASK_ID}/submit`) {
        seen.submit += 1;
        sendJson(response, 500, { detail: { message: "verified done recovery must not submit again" } });
      } else if (path === `/api/runtime/runs/${EVENT_ID}/sync`) {
        seen.sync = body;
        assert.equal(body.status, "done");
        assert.equal(body.execution_id, EXECUTION_ID);
        sendJson(response, 200, { id: EVENT_ID, status: "done" });
      } else {
        sendJson(response, 404, { detail: { message: "not found" } });
      }
    });
    const apiUrl = await fixture.listen();
    const config = runtimeConfig(dataDir, apiUrl, workerId);
    const engine = new RuntimeEngine(config);
    engineHolder.engine = engine;
    const executionConfig = { ...EXECUTION_CONFIG, tool_connection_ids: [SAFE_CONNECTION.id] };
    engine.store.reserve({
      request_id: event.id,
      task_id: event.task_id,
      agent_id: event.agent_id,
      project_id: event.project_id,
      prompt: "The result has already been submitted.",
      model_config: SELECTION,
      execution_id: EXECUTION_ID,
      execution_config: executionConfig,
      tool_connections: [SAFE_CONNECTION],
      sandbox_profile: null,
      mode: "live",
    }, "persisted-done-conversation");
    engine.store.setSubmission(event.id, "persisted-submission-id");
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

    await waitFor(() => seen.sync, 5_000, () => ({ context: seen.context, claim: seen.taskClaim, submit: seen.submit }));
    await dispatcher.stop();
    await loop;
    const finalRecord = engine.store.get(EVENT_ID);
    await engine.close();
    engineHolder.engine = undefined;

    assert.equal(seen.context, 1);
    assert.equal(seen.taskClaim, 0);
    assert.equal(seen.submit, 0);
    assert.equal(seen.sync.status, "done");
    assert.equal(finalRecord.status, "done");
    assert.equal(finalRecord.submission_id, "persisted-submission-id");
    assertNoCredentialBytes(dataDir, [providerToken, mcpToken, "agent-secret-fixture", "runtime-secret-fixture", event.delivery_token]);
  } finally {
    await dispatcher?.stop().catch(() => undefined);
    await engineHolder.engine?.close().catch(() => undefined);
    if (fixture) await fixture.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
