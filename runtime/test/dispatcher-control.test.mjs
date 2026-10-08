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

function runtimeConfig(dataDir, apiUrl) {
  return loadConfig({
    NODE_ENV: "test",
    ORDIVANT_RUNTIME_MODE: "demo",
    ORDIVANT_RUNTIME_TOKEN: "dispatcher-test-runtime-token",
    ORDIVANT_DATA_DIR: dataDir,
    ORDIVANT_API_URL: apiUrl,
  });
}

function dispatchEvent(id) {
  return {
    id,
    project_id: "project-control-test",
    task_id: "task-control-test",
    agent_id: "agent-control-test",
    type: "run_task",
    payload: {},
    delivery_token: `delivery-${id}`,
    attempts: 1,
  };
}

function handoff(event) {
  return {
    agent: { id: event.agent_id, token: "dispatcher-test-agent-token" },
    model_config: null,
    provider: null,
    execution_config: {
      instructions: "",
      tool_connection_ids: [],
      sandbox_profile_id: null,
      limits: { max_turns: 2, timeout_seconds: 30 },
    },
    tool_connections: [],
    sandbox_profile: null,
  };
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

test("queued pause renews delivery without claiming, and stop terminal-syncs without ack", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-dispatch-control-"));
  const event = dispatchEvent("run-queued-pause-stop");
  let dispatcher;
  let engine;
  let server;
  let claimed = false;
  let action = "pause";
  let revision = 1;
  const seen = { controlPolls: 0, workflowTicks: 0, deliveryRenews: 0, taskClaims: 0, terminalSync: undefined, ackCalls: 0 };

  try {
    server = createServer(async (request, response) => {
      const body = await readRequest(request);
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      if (path.startsWith("/api/runtime/") && request.headers.authorization !== "Bearer dispatcher-test-runtime-token") {
        json(response, 401, { detail: { message: "runtime auth required" } });
        return;
      }
      if (path === "/api/runtime/outbox/claim") {
        json(response, 200, claimed ? [] : (claimed = true, [event]));
      } else if (path === `/api/runtime/outbox/${event.id}/configuration`) {
        json(response, 200, handoff(event));
      } else if (path === `/api/runtime/outbox/${event.id}/renew`) {
        seen.deliveryRenews++;
        json(response, 200, { id: event.id, status: "claimed" });
      } else if (path === "/api/runtime/runs/controls") {
        seen.controlPolls++;
        json(response, 200, [{ id: event.id, desired_action: action, control_revision: revision }]);
      } else if (path === "/api/runtime/workflows/tick") {
        seen.workflowTicks++;
        json(response, 200, { admitted: 0 });
      } else if (path === `/api/runtime/runs/${event.id}/sync`) {
        seen.terminalSync = body;
        json(response, 200, { id: event.id, status: body.status });
      } else if (path === `/api/tasks/${event.task_id}/claim`) {
        seen.taskClaims++;
        json(response, 500, { detail: { message: "queued pause must not claim" } });
      } else if (path === `/api/runtime/outbox/${event.id}/ack`) {
        seen.ackCalls++;
        json(response, 500, { detail: { message: "terminal sync owns outbox completion" } });
      } else {
        json(response, 404, { detail: { message: "not found" } });
      }
    });
    const apiUrl = await listen(server);
    const config = runtimeConfig(dataDir, apiUrl);
    engine = new RuntimeEngine(config);
    dispatcher = new OutboxDispatcher(config, engine, {
      pollIntervalMs: 5,
      leaseSeconds: 3,
      outboxLeaseHeartbeatMs: 10,
      workflowTickIntervalMs: 10,
      controlPollIntervalMs: 5,
      syncIntervalMs: 10,
    });
    const loop = dispatcher.start();

    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 2_000;
      const poll = () => {
        if (seen.deliveryRenews >= 2 && seen.controlPolls >= 2 && seen.workflowTicks >= 1) {
          action = "stop";
          revision = 2;
        }
        if (seen.terminalSync) return resolve();
        if (Date.now() > deadline) return reject(new Error("queued Run did not receive stop control"));
        setTimeout(poll, 5);
      };
      poll();
    });

    await dispatcher.stop();
    await loop;
    assert.equal(seen.taskClaims, 0);
    assert.ok(seen.deliveryRenews >= 2);
    assert.ok(seen.controlPolls >= 2);
    assert.ok(seen.workflowTicks >= 1);
    assert.equal(seen.terminalSync.status, "aborted");
    assert.equal(seen.terminalSync.sequence, 1);
    assert.equal(seen.ackCalls, 0);
  } finally {
    await dispatcher?.stop();
    if (server) await close(server);
    if (engine) await engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("terminal sync retries the identical sequence and payload after a lost reply", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-dispatch-sync-retry-"));
  const event = dispatchEvent("run-terminal-sync-retry");
  let dispatcher;
  let engine;
  let server;
  let claimed = false;
  let acceptedTerminalSync;
  const seen = { taskClaims: 0, submissions: 0, submitKeys: [], submitBodies: [], terminalSyncs: [], ackCalls: 0 };

  try {
    server = createServer(async (request, response) => {
      const body = await readRequest(request);
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const isRuntime = path.startsWith("/api/runtime/");
      const wantedAuth = isRuntime ? "Bearer dispatcher-test-runtime-token" : "Bearer dispatcher-test-agent-token";
      if (request.headers.authorization !== wantedAuth) {
        json(response, 401, { detail: { message: "wrong scoped auth" } });
        return;
      }
      if (path === "/api/runtime/outbox/claim") {
        json(response, 200, claimed ? [] : (claimed = true, [event]));
      } else if (path === `/api/runtime/outbox/${event.id}/configuration`) {
        json(response, 200, handoff(event));
      } else if (path === `/api/runtime/outbox/${event.id}/renew`) {
        json(response, 200, { id: event.id, status: "claimed" });
      } else if (path === "/api/runtime/runs/controls") {
        json(response, 200, []);
      } else if (path === "/api/runtime/workflows/tick") {
        json(response, 200, { admitted: 0 });
      } else if (path === `/api/tasks/${event.task_id}/claim`) {
        seen.taskClaims++;
        json(response, 200, {
          task: {
            id: event.task_id,
            project_id: event.project_id,
            title: "Dispatcher sync retry",
            description: "",
            goal: "Exercise the terminal sync retry path.",
            inputs: "",
            scope: "runtime test",
            constraints: "demo only",
            acceptance_criteria: ["Run sync retries with a stable sequence"],
          },
          execution: { id: "execution-sync-retry", lease_expires_at: new Date(Date.now() + 300_000).toISOString() },
          lease_token: "lease-sync-retry",
        });
      } else if (path === `/api/tasks/${event.task_id}/renew`) {
        json(response, 200, { execution: { id: "execution-sync-retry" }, lease_token: "lease-sync-retry" });
      } else if (path === `/api/tasks/${event.task_id}/progress`) {
        json(response, 200, { id: event.task_id, progress: body.progress });
      } else if (path === `/api/tasks/${event.task_id}/submit`) {
        seen.submissions++;
        seen.submitKeys.push(request.headers["idempotency-key"]);
        seen.submitBodies.push(body);
        assert.match(body.summary, /DEMO MODE/);
        if (seen.submissions === 1) {
          response.destroy();
          return;
        }
        assert.equal(request.headers["idempotency-key"], seen.submitKeys[0]);
        assert.deepEqual(body, seen.submitBodies[0]);
        json(response, 200, { task: { id: event.task_id, status: "in_review" } });
      } else if (path === `/api/runtime/runs/${event.id}/sync`) {
        const { delivery_token, ...stableBody } = body;
        assert.equal(delivery_token, event.delivery_token);
        if (body.status === "done") {
          seen.terminalSyncs.push({ body: stableBody, sequence: body.sequence });
          if (!acceptedTerminalSync) {
            acceptedTerminalSync = { body: stableBody, sequence: body.sequence };
            response.destroy();
            return;
          }
          assert.deepEqual(stableBody, acceptedTerminalSync.body);
          assert.equal(body.sequence, acceptedTerminalSync.sequence);
          json(response, 200, { id: event.id, status: "done" });
        } else {
          json(response, 200, { id: event.id, status: body.status });
        }
      } else if (path === `/api/runtime/outbox/${event.id}/ack`) {
        seen.ackCalls++;
        json(response, 500, { detail: { message: "terminal sync owns outbox completion" } });
      } else {
        json(response, 404, { detail: { message: "not found" } });
      }
    });
    const apiUrl = await listen(server);
    const config = runtimeConfig(dataDir, apiUrl);
    engine = new RuntimeEngine(config);
    dispatcher = new OutboxDispatcher(config, engine, {
      pollIntervalMs: 5,
      leaseSeconds: 3,
      outboxLeaseHeartbeatMs: 10,
      workflowTickIntervalMs: 10,
      controlPollIntervalMs: 5,
      syncIntervalMs: 10,
    });
    const loop = dispatcher.start();
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5_000;
      const poll = () => {
        if (seen.terminalSyncs.length >= 2) return resolve();
        if (Date.now() > deadline) return reject(new Error("terminal Run sync was not retried"));
        setTimeout(poll, 10);
      };
      poll();
    });
    await dispatcher.stop();
    await loop;
    assert.equal(seen.taskClaims, 1);
    assert.equal(seen.submissions, 2);
    assert.equal(seen.submitKeys[0], seen.submitKeys[1]);
    assert.deepEqual(seen.submitBodies[0], seen.submitBodies[1]);
    assert.equal(seen.terminalSyncs[0].sequence, seen.terminalSyncs[1].sequence);
    assert.deepEqual(seen.terminalSyncs[0].body, seen.terminalSyncs[1].body);
    assert.equal(seen.terminalSyncs.at(-1).body.status, "done");
    assert.equal(seen.ackCalls, 0);
  } finally {
    await dispatcher?.stop();
    if (server) await close(server);
    if (engine) await engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("a rejected task submission is released and never terminal-syncs done", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-dispatch-submit-reject-"));
  const event = dispatchEvent("run-submit-rejected");
  let dispatcher;
  let engine;
  let server;
  let claimed = false;
  const seen = { submissions: 0, releases: 0, terminalStatuses: [] };

  try {
    server = createServer(async (request, response) => {
      const body = await readRequest(request);
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const isRuntime = path.startsWith("/api/runtime/");
      const wantedAuth = isRuntime ? "Bearer dispatcher-test-runtime-token" : "Bearer dispatcher-test-agent-token";
      if (request.headers.authorization !== wantedAuth) {
        json(response, 401, { detail: { message: "wrong scoped auth" } });
        return;
      }
      if (path === "/api/runtime/outbox/claim") {
        json(response, 200, claimed ? [] : (claimed = true, [event]));
      } else if (path === `/api/runtime/outbox/${event.id}/configuration`) {
        json(response, 200, handoff(event));
      } else if (path === `/api/runtime/outbox/${event.id}/renew`) {
        json(response, 200, { id: event.id, status: "claimed" });
      } else if (path === "/api/runtime/runs/controls") {
        json(response, 200, []);
      } else if (path === "/api/runtime/workflows/tick") {
        json(response, 200, { admitted: 0 });
      } else if (path === `/api/tasks/${event.task_id}/context`) {
        json(response, 200, { task: { id: event.task_id }, executions: [], artifacts: [] });
      } else if (path === `/api/tasks/${event.task_id}/claim`) {
        json(response, 200, {
          task: {
            id: event.task_id,
            project_id: event.project_id,
            title: "Rejected result",
            description: "",
            goal: "Confirm that a rejected submission never reports done.",
            inputs: "",
            scope: "runtime test",
            constraints: "demo only",
            acceptance_criteria: [],
          },
          execution: { id: "execution-submit-rejected", lease_expires_at: new Date(Date.now() + 300_000).toISOString() },
          lease_token: "lease-submit-rejected",
        });
      } else if (path === `/api/tasks/${event.task_id}/renew`) {
        json(response, 200, { execution: { id: "execution-submit-rejected" }, lease_token: "lease-submit-rejected" });
      } else if (path === `/api/tasks/${event.task_id}/submit`) {
        seen.submissions++;
        json(response, 409, { detail: { message: "execution lease rejected" } });
      } else if (path === `/api/tasks/${event.task_id}/release`) {
        seen.releases++;
        assert.equal(body.execution_id, "execution-submit-rejected");
        json(response, 200, { id: event.task_id, status: "ready" });
      } else if (path === `/api/runtime/runs/${event.id}/sync`) {
        seen.terminalStatuses.push(body.status);
        json(response, 200, { id: event.id, status: body.status });
      } else {
        json(response, 404, { detail: { message: "not found" } });
      }
    });
    const apiUrl = await listen(server);
    const config = runtimeConfig(dataDir, apiUrl);
    engine = new RuntimeEngine(config);
    engine.store.reserve({
      request_id: event.id,
      task_id: event.task_id,
      agent_id: event.agent_id,
      project_id: event.project_id,
      prompt: "A previously completed model turn awaiting task submission.",
      model_config: null,
      execution_id: "execution-submit-rejected",
      execution_config: handoff(event).execution_config,
      tool_connections: [],
      sandbox_profile: null,
      mode: "demo",
    }, "persisted-done-conversation");
    engine.store.setStatus(event.id, "done", {
      answer: "DEMO MODE deterministic receipt",
      receipt: { mode: "demo", requested: null, returned: null, usage: null, tools: [], cost_usd: null },
    });
    dispatcher = new OutboxDispatcher(config, engine, {
      pollIntervalMs: 5,
      outboxLeaseHeartbeatMs: 10,
      workflowTickIntervalMs: 10,
      controlPollIntervalMs: 5,
      syncIntervalMs: 10,
    });
    const loop = dispatcher.start();
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 3_000;
      const poll = () => {
        if (seen.terminalStatuses.length) return resolve();
        if (Date.now() > deadline) return reject(new Error("rejected submission did not terminal-sync"));
        setTimeout(poll, 5);
      };
      poll();
    });
    await dispatcher.stop();
    await loop;
    assert.equal(seen.submissions, 1);
    assert.equal(seen.releases, 1);
    assert.deepEqual(seen.terminalStatuses, ["failed"]);
    assert.equal(engine.store.get(event.id).status, "failed");
  } finally {
    await dispatcher?.stop();
    if (server) await close(server);
    if (engine) await engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
