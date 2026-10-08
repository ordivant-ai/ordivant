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

const EVENT_ID = "run-sandbox-cleanup";
const PROJECT_ID = "project-sandbox-cleanup";
const TASK_ID = "task-sandbox-cleanup";
const AGENT_ID = "agent-sandbox-cleanup";
const EXECUTION_ID = "execution-sandbox-cleanup";
const PROFILE_ID = "profile-sandbox-cleanup";
const RUNTIME_TOKEN = "runtime-secret-sandbox-cleanup";
const AGENT_TOKEN = "agent-secret-sandbox-cleanup";
const SANDBOX_SERVICE_TOKEN = "sandbox-service-token-cleanup";
const SANDBOX_CAPABILITY = "sandbox-capability-token-cleanup-at-least-32-characters";
const LEASE_TOKEN = "task-lease-token-cleanup";
const PROFILE = {
  id: PROFILE_ID,
  project_id: PROJECT_ID,
  name: "Cleanup fixture",
  limits: { timeout_seconds: 10, memory_mb: 64, cpu_count: 0.5, pids_limit: 16, output_bytes: 1024, workspace_mb: 1 },
};
const EXECUTION_CONFIG = {
  instructions: "",
  tool_connection_ids: [],
  sandbox_profile_id: PROFILE_ID,
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

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for sandbox cleanup state");
}

function makeEvent({ id = EVENT_ID, deliveryToken = "delivery-token-cleanup" } = {}) {
  return {
    id,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    agent_id: AGENT_ID,
    type: "run_task",
    payload: {},
    delivery_token: deliveryToken,
    attempts: 1,
  };
}

function config(dataDir, apiUrl, sandboxUrl, workerId) {
  return {
    ...loadConfig({
      NODE_ENV: "test",
      ORDIVANT_RUNTIME_MODE: "demo",
      ORDIVANT_RUNTIME_TOKEN: RUNTIME_TOKEN,
      ORDIVANT_RUNTIME_WORKER_ID: workerId,
      ORDIVANT_DATA_DIR: dataDir,
      ORDIVANT_API_URL: apiUrl,
    }),
    ...(sandboxUrl ? { sandboxUrl, sandboxToken: SANDBOX_SERVICE_TOKEN } : {}),
  };
}

function handoff(event) {
  return {
    agent: { id: event.agent_id, token: AGENT_TOKEN },
    model_config: null,
    provider: null,
    execution_config: EXECUTION_CONFIG,
    tool_connections: [],
    sandbox_profile: PROFILE,
  };
}

function demoReceipt() {
  return { mode: "demo", requested: null, returned: null, usage: null, tools: [], cost_usd: null };
}

function expectedDemoSubmission(answer) {
  const receipt = demoReceipt();
  return {
    execution_id: EXECUTION_ID,
    summary: "DEMO MODE: deterministic provider receipt. This does not claim the assigned task was completed.",
    artifacts: [{
      kind: "summary",
      title: "DEMO MODE deterministic provider receipt",
      content: answer,
    }, {
      kind: "test_report",
      title: "DEMO MODE execution receipt",
      content: JSON.stringify(receipt, null, 2),
    }],
  };
}

async function runDelayedCleanup(deleteFails) {
  const dataDir = mkdtempSync(join(tmpdir(), `ordivant-dispatch-cleanup-${deleteFails ? "failed" : "ok"}-`));
  const workerId = `runtime-cleanup-${deleteFails ? "failed" : "ok"}`;
  const event = makeEvent({ deliveryToken: `delivery-${workerId}` });
  let releaseDelete;
  const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
  let markDeleteStarted;
  const deleteStarted = new Promise((resolve) => { markDeleteStarted = resolve; });
  const seen = {
    outboxRenews: 0,
    leaseRenews: 0,
    claims: 0,
    submissions: [],
    syncs: [],
  };
  let leaseRenewsAtDeleteStart = 0;
  let outboxClaimed = false;
  let platformServer;
  let sandboxServer;
  let engine;
  let dispatcher;

  try {
    sandboxServer = createServer(async (request, response) => {
      await readRequest(request);
      if (request.headers.authorization !== `Bearer ${SANDBOX_SERVICE_TOKEN}` && request.method === "POST") {
        sendJson(response, 401, { detail: "sandbox service auth required" });
        return;
      }
      if (request.method === "POST" && request.url === "/sandboxes") {
        sendJson(response, 201, { run_id: EVENT_ID, status: "ready", token: SANDBOX_CAPABILITY });
      } else if (request.method === "DELETE" && request.url === `/sandboxes/${EVENT_ID}`) {
        assert.equal(request.headers.authorization, `Bearer ${SANDBOX_CAPABILITY}`);
        leaseRenewsAtDeleteStart = seen.leaseRenews;
        markDeleteStarted();
        await deleteGate;
        if (deleteFails) sendJson(response, 503, { detail: "private executor cleanup detail" });
        else {
          response.writeHead(204);
          response.end();
        }
      } else {
        sendJson(response, 404, { detail: "not found" });
      }
    });
    const sandboxUrl = await listen(sandboxServer);

    platformServer = createServer(async (request, response) => {
      const body = await readRequest(request);
      const url = new URL(request.url, "http://127.0.0.1");
      const runtimeRequest = url.pathname.startsWith("/api/runtime/");
      const expectedAuth = runtimeRequest ? `Bearer ${RUNTIME_TOKEN}` : `Bearer ${AGENT_TOKEN}`;
      if (request.headers.authorization !== expectedAuth) {
        sendJson(response, 401, { detail: { message: "wrong scoped credential" } });
        return;
      }
      if (url.pathname === "/api/runtime/outbox/claim") {
        sendJson(response, 200, outboxClaimed ? [] : (outboxClaimed = true, [event]));
      } else if (url.pathname === `/api/runtime/outbox/${EVENT_ID}/configuration`) {
        sendJson(response, 200, handoff(event));
      } else if (url.pathname === `/api/runtime/outbox/${EVENT_ID}/renew`) {
        seen.outboxRenews += 1;
        sendJson(response, 200, { id: EVENT_ID, status: "claimed" });
      } else if (url.pathname === "/api/runtime/runs/controls") {
        sendJson(response, 200, []);
      } else if (url.pathname === "/api/runtime/workflows/tick") {
        sendJson(response, 200, { admitted: 0 });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/claim`) {
        seen.claims += 1;
        sendJson(response, 200, {
          task: {
            id: TASK_ID,
            project_id: PROJECT_ID,
            title: "Sandbox cleanup terminal sync",
            description: "Wait for isolated workspace cleanup before syncing the final run.",
            goal: "Report the final sandbox status and safe cleanup evidence.",
            inputs: "",
            scope: "local runtime test",
            constraints: "No external provider calls.",
            acceptance_criteria: ["Terminal sync reflects completed cleanup."],
          },
          execution: { id: EXECUTION_ID, lease_expires_at: new Date(Date.now() + 300_000).toISOString() },
          lease_token: LEASE_TOKEN,
        });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/renew`) {
        assert.equal(body.execution_id, EXECUTION_ID);
        assert.equal(body.lease_token, LEASE_TOKEN);
        seen.leaseRenews += 1;
        sendJson(response, 200, { execution: { id: EXECUTION_ID }, lease_token: LEASE_TOKEN });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/progress`) {
        assert.equal(body.execution_id, EXECUTION_ID);
        assert.equal(body.lease_token, LEASE_TOKEN);
        sendJson(response, 200, { id: TASK_ID, progress: body.progress });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/submit`) {
        assert.equal(body.execution_id, EXECUTION_ID);
        assert.equal(body.lease_token, LEASE_TOKEN);
        seen.submissions.push(body);
        sendJson(response, 200, { task: { id: TASK_ID, status: "in_review" } });
      } else if (url.pathname === `/api/runtime/runs/${EVENT_ID}/sync`) {
        if (["done", "failed", "aborted"].includes(body.status)) seen.syncs.push(body);
        sendJson(response, 200, { id: EVENT_ID, status: body.status });
      } else {
        sendJson(response, 404, { detail: { message: "not found" } });
      }
    });
    const apiUrl = await listen(platformServer);
    const runtimeConfig = config(dataDir, apiUrl, sandboxUrl, workerId);
    engine = new RuntimeEngine(runtimeConfig);
    dispatcher = new OutboxDispatcher(runtimeConfig, engine, {
      pollIntervalMs: 5,
      leaseSeconds: 3,
      outboxLeaseHeartbeatMs: 40,
      workflowTickIntervalMs: 25,
      controlPollIntervalMs: 10,
      syncIntervalMs: 10,
    });
    const loop = dispatcher.start();

    await deleteStarted;
    await waitFor(() => engine.store.get(EVENT_ID)?.status === "done");
    assert.deepEqual(engine.store.get(EVENT_ID)?.sandbox, {
      run_id: EVENT_ID,
      status: "ready",
      workspace_available: true,
    });
    assert.equal(seen.syncs.length, 0, "terminal sync must wait for sandbox cleanup");

    await waitFor(() => seen.leaseRenews > leaseRenewsAtDeleteStart && seen.outboxRenews >= 2, 4_000);
    assert.equal(seen.syncs.length, 0, "lease heartbeats continue while cleanup is pending");
    releaseDelete();

    await waitFor(() => seen.syncs.length > 0);
    await dispatcher.stop();
    await loop;

    const terminal = seen.syncs.at(-1);
    assert.equal(terminal.status, "done");
    assert.deepEqual(terminal.sandbox, {
      run_id: EVENT_ID,
      status: deleteFails ? "failed" : "stopped",
      workspace_available: false,
    });
    assert.ok(seen.submissions.length === 1, "Pi result is submitted exactly once after cleanup finishes");
    assert.ok(seen.leaseRenews >= 2);
    assert.ok(seen.outboxRenews >= 2);

    const terminalEvents = terminal.events ?? [];
    if (deleteFails) {
      assert.ok(terminalEvents.some((item) => item.kind === "error" &&
        item.data.kind === "sandbox_cleanup_unconfirmed" &&
        item.data.message === "沙箱清理尚未確認，請由操作者檢查執行器。"),
      JSON.stringify({ terminalEvents, sandbox: terminal.sandbox, runEvents: engine.store.events(EVENT_ID) }));
      assert.equal(JSON.stringify(terminal).includes("private executor cleanup detail"), false);
    } else {
      assert.ok(terminalEvents.some((item) => item.kind === "sandbox" && item.data.status === "stopped"));
      assert.equal(terminalEvents.some((item) => item.data.kind === "sandbox_cleanup_unconfirmed"), false);
    }
  } finally {
    releaseDelete?.();
    await dispatcher?.stop().catch(() => undefined);
    if (platformServer) await close(platformServer);
    if (sandboxServer) await close(sandboxServer);
    await engine?.close().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test("terminal Run sync waits for delayed sandbox cleanup and records stopped status", async () => {
  await runDelayedCleanup(false);
});

test("terminal Run sync waits for failed cleanup and sends only safe failure evidence", async () => {
  await runDelayedCleanup(true);
});

test("terminal recovery marks an unowned persisted sandbox workspace lost without replay", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-dispatch-cleanup-recovery-"));
  const workerId = "runtime-cleanup-recovery";
  const event = makeEvent({ deliveryToken: `delivery-${workerId}` });
  const answer = "Persisted DEMO result after process restart.";
  const receipt = demoReceipt();
  const submission = expectedDemoSubmission(answer);
  const seen = { claims: 0, submissions: 0, contextReads: 0, syncs: [] };
  let outboxClaimed = false;
  let platformServer;
  let engine;
  let dispatcher;

  try {
    platformServer = createServer(async (request, response) => {
      const body = await readRequest(request);
      const url = new URL(request.url, "http://127.0.0.1");
      const runtimeRequest = url.pathname.startsWith("/api/runtime/");
      const expectedAuth = runtimeRequest ? `Bearer ${RUNTIME_TOKEN}` : `Bearer ${AGENT_TOKEN}`;
      if (request.headers.authorization !== expectedAuth) {
        sendJson(response, 401, { detail: { message: "wrong scoped credential" } });
        return;
      }
      if (url.pathname === "/api/runtime/outbox/claim") {
        sendJson(response, 200, outboxClaimed ? [] : (outboxClaimed = true, [event]));
      } else if (url.pathname === `/api/runtime/outbox/${EVENT_ID}/configuration`) {
        sendJson(response, 200, handoff(event));
      } else if (url.pathname === `/api/runtime/outbox/${EVENT_ID}/renew`) {
        sendJson(response, 200, { id: EVENT_ID, status: "claimed" });
      } else if (url.pathname === "/api/runtime/runs/controls") {
        sendJson(response, 200, []);
      } else if (url.pathname === "/api/runtime/workflows/tick") {
        sendJson(response, 200, { admitted: 0 });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/context`) {
        seen.contextReads += 1;
        sendJson(response, 200, {
          task: { id: TASK_ID, status: "in_review" },
          executions: [{
            id: EXECUTION_ID,
            task_id: TASK_ID,
            agent_id: AGENT_ID,
            status: "submitted",
            summary: submission.summary,
          }],
          artifacts: submission.artifacts.map((artifact, index) => ({
            id: `artifact-${index}`,
            task_id: TASK_ID,
            execution_id: EXECUTION_ID,
            ...artifact,
          })),
          messages: [],
          events: [],
          dependencies: [],
        });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/claim`) {
        seen.claims += 1;
        sendJson(response, 500, { detail: { message: "verified terminal recovery must not claim" } });
      } else if (url.pathname === `/api/tasks/${TASK_ID}/submit`) {
        seen.submissions += 1;
        sendJson(response, 500, { detail: { message: "verified terminal recovery must not submit again" } });
      } else if (url.pathname === `/api/runtime/runs/${EVENT_ID}/sync`) {
        if (["done", "failed", "aborted"].includes(body.status)) seen.syncs.push(body);
        sendJson(response, 200, { id: EVENT_ID, status: body.status });
      } else {
        sendJson(response, 404, { detail: { message: "not found" } });
      }
    });
    const apiUrl = await listen(platformServer);
    const runtimeConfig = config(dataDir, apiUrl, undefined, workerId);
    engine = new RuntimeEngine(runtimeConfig);
    engine.store.reserve({
      request_id: event.id,
      task_id: event.task_id,
      agent_id: event.agent_id,
      project_id: event.project_id,
      prompt: "The model result and submission already exist.",
      model_config: null,
      execution_id: EXECUTION_ID,
      execution_config: EXECUTION_CONFIG,
      tool_connections: [],
      sandbox_profile: PROFILE,
      mode: "demo",
    }, "persisted-done-conversation");
    engine.store.setSandbox(EVENT_ID, { run_id: EVENT_ID, status: "ready", workspace_available: true });
    engine.store.setSubmission(EVENT_ID, "persisted-submission-id");
    engine.store.setStatus(EVENT_ID, "done", { answer, receipt });
    dispatcher = new OutboxDispatcher(runtimeConfig, engine, {
      pollIntervalMs: 5,
      leaseSeconds: 30,
      outboxLeaseHeartbeatMs: 60_000,
      workflowTickIntervalMs: 20,
      controlPollIntervalMs: 10,
      syncIntervalMs: 10,
    });
    const loop = dispatcher.start();
    await waitFor(() => seen.syncs.length > 0);
    await dispatcher.stop();
    await loop;

    const terminal = seen.syncs.at(-1);
    assert.equal(seen.contextReads, 1);
    assert.equal(seen.claims, 0);
    assert.equal(seen.submissions, 0);
    assert.equal(terminal.status, "done");
    assert.deepEqual(terminal.sandbox, { run_id: EVENT_ID, status: "lost", workspace_available: false });
    assert.ok(terminal.events.some((item) => item.kind === "error" &&
      item.data.kind === "sandbox_cleanup_unconfirmed" &&
      item.data.message === "沙箱清理尚未確認，請由操作者檢查執行器。"));
    assert.equal(JSON.stringify(terminal).includes(SANDBOX_CAPABILITY), false);
    assert.equal(engine.store.get(EVENT_ID)?.status, "done");
    assert.deepEqual(engine.store.get(EVENT_ID)?.sandbox, { run_id: EVENT_ID, status: "lost", workspace_available: false });
  } finally {
    await dispatcher?.stop().catch(() => undefined);
    if (platformServer) await close(platformServer);
    await engine?.close().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
