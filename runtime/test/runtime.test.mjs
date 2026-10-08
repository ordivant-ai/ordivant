import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { loadConfig } from "../dist/config.js";
import { OutboxDispatcher } from "../dist/dispatcher.js";
import { RuntimeEngine } from "../dist/engine.js";

const execFileAsync = promisify(execFile);

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

function config(dataDir, extra = {}) {
  return loadConfig({
    NODE_ENV: "test",
    ORDIVANT_RUNTIME_MODE: "demo",
    ORDIVANT_RUNTIME_TOKEN: "test-runtime-token",
    ORDIVANT_DATA_DIR: dataDir,
    ORDIVANT_API_URL: "http://127.0.0.1:8000",
    ...extra,
  });
}

test("Pi Durable persists one request and returns the same submission after process restart", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-runtime-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [join(process.cwd(), "test/durable-restart-child.mjs"), "initial"], {
      env: testRuntimeEnv(dataDir),
      windowsHide: true,
    });
    const initial = JSON.parse(stdout.trim());
    assert.equal(initial.health.engine, "Pi Durable");
    assert.equal(initial.health.storage, "SQLite");
    assert.equal(initial.health.model_calls, "deterministic_demo");
    assert.equal(Object.keys(initial.health).some((key) => /token|key|credential/i.test(key)), false);
    assert.equal(initial.unauthorizedStatus, 401);
    assert.equal(initial.firstResponseStatus, 202);
    assert.equal(initial.duplicateResponseStatus, 202);
    assert.equal(initial.first.request_id, initial.duplicate.request_id);
    assert.equal(initial.first.conversation_id, initial.duplicate.conversation_id);
    assert.equal(initial.conflictStatus, 409);
    assert.equal(initial.completed.status, "done");
    assert.match(initial.completed.answer, /DEMO MODE deterministic receipt/);
    assert.ok(initial.completed.submission_id);

    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(join(dataDir, "runtime", `runs.sqlite${suffix}`), { force: true });
    }

    const { stdout: replayStdout } = await execFileAsync(process.execPath, [join(process.cwd(), "test/durable-restart-child.mjs"), "replay"], {
      env: testRuntimeEnv(dataDir),
      windowsHide: true,
    });
    const replay = JSON.parse(replayStdout.trim());
    assert.equal(replay.status, "done");
    assert.equal(replay.conversation_id, initial.completed.conversation_id);
    assert.equal(replay.submission_id, initial.completed.submission_id);
    assert.equal(replay.answer, initial.completed.answer);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function testRuntimeEnv(dataDir) {
  return {
    ...process.env,
    NODE_ENV: "test",
    ORDIVANT_RUNTIME_MODE: "demo",
    ORDIVANT_RUNTIME_TOKEN: "test-runtime-token",
    ORDIVANT_DATA_DIR: dataDir,
    ORDIVANT_API_URL: "http://127.0.0.1:8000",
  };
}

test("dispatcher uses runtime auth only for outbox calls and scoped agent auth for task mutations", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-dispatcher-"));
  let engine;
  let dispatcher;
  let platformServer;
  try {
    const seen = {
      claims: 0,
      handoffs: 0,
      deliveryRenews: 0,
      progressKeys: [],
      submissions: 0,
      submitKeys: [],
      renewKeys: [],
      acknowledgements: [],
      syncs: [],
      authErrors: [],
    };
    const event = {
      id: "outbox-dispatch-001",
      project_id: "project-001",
      task_id: "task-002",
      agent_id: "agent-002",
      type: "run_task",
      payload: {},
      delivery_token: "delivery-fence-test",
      attempts: 1,
    };
    let outboxClaimed = false;
    let delayedFirstProgress = false;
    platformServer = (await import("node:http")).createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const isRuntimeCall = path.startsWith("/api/runtime/");
      const wantedAuth = isRuntimeCall ? "Bearer test-runtime-token" : "Bearer scoped-agent-token";
      if (request.headers.authorization !== wantedAuth) seen.authErrors.push(path);

      const json = (status, value) => {
        const text = JSON.stringify(value);
        response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        response.end(text);
      };
      if (request.method === "GET" && path === "/api/runtime/runs/controls") {
        json(200, []);
      } else if (request.method === "POST" && path === "/api/runtime/workflows/tick") {
        json(200, { admitted_schedules: 0, advanced_instances: 0 });
      } else if (request.method === "POST" && path === `/api/runtime/runs/${event.id}/sync`) {
        assert.equal(body.worker_id, runtimeConfig.workerId);
        assert.equal(body.delivery_token, event.delivery_token);
        assert.ok(body.sequence > 0);
        seen.syncs.push(body);
        if (["done", "failed", "aborted"].includes(body.status)) {
          assert.equal(seen.submissions, 1, "result must be submitted before the terminal sync revokes its credentials");
          seen.acknowledgements.push(body.status === "done" ? "delivered" : body.status);
        }
        json(200, { id: event.id, status: body.status });
      } else if (request.method === "POST" && path === "/api/runtime/outbox/claim") {
        outboxClaimed = true;
        json(200, seen.acknowledgements.length === 0 ? [event] : []);
      } else if (request.method === "POST" && path === `/api/runtime/outbox/${event.id}/configuration`) {
        seen.handoffs++;
        assert.deepEqual(body, { worker_id: runtimeConfig.workerId, delivery_token: event.delivery_token });
        json(200, {
          agent: { id: event.agent_id, token: "scoped-agent-token" },
          model_config: null,
          provider: null,
        });
      } else if (request.method === "POST" && path === `/api/runtime/outbox/${event.id}/renew`) {
        seen.deliveryRenews++;
        assert.deepEqual(body, { worker_id: runtimeConfig.workerId, delivery_token: event.delivery_token });
        json(200, { id: event.id, status: "pending" });
      } else if (request.method === "POST" && path === `/api/tasks/${event.task_id}/claim`) {
        seen.claims++;
        json(200, {
          task: {
            id: event.task_id,
            project_id: event.project_id,
            title: "Runtime smoke task",
            description: "Provider-free dispatcher test.",
            goal: "Exercise the durable workflow.",
            inputs: "",
            scope: "runtime only",
            constraints: "demo",
            acceptance_criteria: ["Result is labelled demo"],
          },
          execution: { id: "execution-001", lease_expires_at: new Date(Date.now() + 300_000).toISOString() },
          lease_token: "fencing-token-test",
        });
      } else if (request.method === "POST" && path === `/api/tasks/${event.task_id}/progress`) {
        seen.progressKeys.push(request.headers["idempotency-key"]);
        if (body.progress === 5 && !delayedFirstProgress) {
          delayedFirstProgress = true;
          await new Promise((resolve) => setTimeout(resolve, 1_100));
        }
        json(200, { id: event.task_id, progress: body.progress });
      } else if (request.method === "POST" && path === `/api/tasks/${event.task_id}/renew`) {
        seen.renewKeys.push(request.headers["idempotency-key"]);
        json(200, { execution: { id: "execution-001" }, lease_token: "fencing-token-test" });
      } else if (request.method === "POST" && path === `/api/tasks/${event.task_id}/submit`) {
        seen.submissions++;
        seen.submitKeys.push(request.headers["idempotency-key"]);
        assert.match(body.summary, /DEMO MODE/);
        assert.match(body.artifacts[0].content, /No paid model was called/);
        json(200, { task: { id: event.task_id, status: "in_review" } });
      } else if (request.method === "POST" && path === `/api/runtime/outbox/${event.id}/ack`) {
        assert.fail("terminal sync already acknowledges the outbox; no second ack is allowed");
      } else {
        json(404, { detail: { message: "Not found" } });
      }
    });
    const apiUrl = await listen(platformServer);
    const runtimeConfig = config(dataDir, { ORDIVANT_API_URL: apiUrl });

    engine = new RuntimeEngine(runtimeConfig);
    dispatcher = new OutboxDispatcher(runtimeConfig, engine, { pollIntervalMs: 5, leaseSeconds: 3, outboxLeaseHeartbeatMs: 100 });
    const dispatchLoop = dispatcher.start();
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5_000;
      const poll = () => {
        if (seen.acknowledgements.length === 1) return resolve();
        if (Date.now() >= deadline) return reject(new Error("dispatcher did not acknowledge its outbox event"));
        setTimeout(poll, 10);
      };
      poll();
    });
    await dispatcher.stop();
    await dispatchLoop;

    assert.equal(outboxClaimed, true);
    assert.deepEqual(seen.authErrors, []);
    assert.equal(seen.handoffs, 1);
    assert.ok(seen.deliveryRenews >= 1);
    assert.equal(seen.claims, 1);
    assert.equal(seen.submissions, 1);
    assert.deepEqual(seen.acknowledgements, ["delivered"]);
    assert.ok(seen.syncs.some((sync) => sync.status === "done" && sync.receipt?.mode === "demo"));
    assert.ok(seen.renewKeys.length >= 1);
    assert.equal(new Set(seen.renewKeys).size, seen.renewKeys.length);
    assert.equal(new Set(seen.progressKeys).size, seen.progressKeys.length);
    assert.deepEqual(seen.submitKeys, [`outbox:${event.id}:submit-result`]);
  } finally {
    await dispatcher?.stop();
    if (platformServer) await close(platformServer);
    if (engine) await engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("configured Responses selection uses a local Responses server and records Pi tool and usage evidence", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-live-runtime-"));
  let engine;
  let dispatcher;
  let platformServer;
  let responsesServer;
  try {
    const eventId = "outbox-live-selection-001";
    const modelConfig = {
      provider_id: "provider-synthetic",
      model_id: "gpt-6.1-sol",
      reasoning_effort: "low",
      max_output_tokens: 321,
    };
    const event = {
      id: eventId,
      project_id: "project-001",
      task_id: "task-live-001",
      agent_id: "agent-live-001",
      type: "run_task",
      payload: { model_config: modelConfig },
      delivery_token: "delivery-token-live",
      attempts: 1,
    };
    const seen = {
      authorizationErrors: [],
      requests: [],
      contextReads: 0,
      submissions: [],
      acknowledgements: [],
      syncs: [],
    };
    responsesServer = (await import("node:http")).createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      seen.requests.push({ path: request.url, headers: request.headers, body });
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.headers.authorization, "Bearer synthetic-provider-key");
      assert.equal(body.model, modelConfig.model_id);
      assert.equal(body.store, false);
      assert.equal(body.max_output_tokens, modelConfig.max_output_tokens);
      assert.equal(body.reasoning.effort, modelConfig.reasoning_effort);
      assert.ok(Array.isArray(body.tools));

      const callTool = body.input.some((message) => message.type === "function_call_output");
      const model = callTool ? "gpt-6.1-sol-2026-10-07b" : "gpt-6.1-sol-2026-10-07a";
      const output = callTool
        ? [{
            type: "message",
            id: "message-final",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "MODEL_TOOL_OK=42", annotations: [] }],
          }]
        : [{
            type: "function_call",
            id: "fc-get-context",
            call_id: "call-get-context",
            name: "get_task_context",
            arguments: "{}",
          }];
      const events = [
        { type: "response.created", response: { id: callTool ? "resp-final" : "resp-tool" } },
        { type: "response.output_item.added", output_index: 0, item: output[0] },
      ];
      if (callTool) {
        events.push({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "MODEL_TOOL_OK=42" });
      } else {
        events.push(
          { type: "response.function_call_arguments.done", output_index: 0, arguments: "{}" },
        );
      }
      events.push(
        { type: "response.output_item.done", output_index: 0, item: output[0] },
        {
          type: "response.completed",
          response: {
            id: callTool ? "resp-final" : "resp-tool",
            model,
            status: "completed",
            output,
            usage: {
              input_tokens: callTool ? 11 : 7,
              output_tokens: callTool ? 5 : 2,
              total_tokens: callTool ? 16 : 9,
              input_tokens_details: {
                cached_tokens: callTool ? 4 : 2,
                cache_write_tokens: callTool ? 2 : 1,
              },
              output_tokens_details: { reasoning_tokens: 1 },
            },
          },
        },
      );
      response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
    const responsesUrl = await listen(responsesServer);

    let delivered = false;
    platformServer = (await import("node:http")).createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const runtimePath = path.startsWith("/api/runtime/");
      const expectedAuth = runtimePath ? "Bearer test-runtime-token" : "Bearer synthetic-agent-token";
      if (request.headers.authorization !== expectedAuth) seen.authorizationErrors.push(path);
      const json = (status, value) => {
        const text = JSON.stringify(value);
        response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        response.end(text);
      };
      if (request.method === "GET" && path === "/api/runtime/runs/controls") {
        json(200, []);
      } else if (request.method === "POST" && path === "/api/runtime/workflows/tick") {
        json(200, { admitted_schedules: 0, advanced_instances: 0 });
      } else if (request.method === "POST" && path === `/api/runtime/runs/${eventId}/sync`) {
        assert.equal(body.worker_id, runtimeConfig.workerId);
        assert.equal(body.delivery_token, event.delivery_token);
        seen.syncs.push(body);
        if (["done", "failed", "aborted"].includes(body.status)) {
          assert.equal(seen.submissions.length, 1, "live result must be submitted before terminal sync");
          seen.acknowledgements.push(body.status === "done" ? "delivered" : body.status);
          delivered = true;
        }
        json(200, { id: eventId, status: body.status });
      } else if (request.method === "POST" && path === "/api/runtime/outbox/claim") {
        json(200, delivered ? [] : [event]);
      } else if (request.method === "POST" && path === `/api/runtime/outbox/${eventId}/configuration`) {
        assert.deepEqual(body, { worker_id: runtimeConfig.workerId, delivery_token: event.delivery_token });
        json(200, {
          agent: { id: event.agent_id, token: "synthetic-agent-token" },
          model_config: modelConfig,
          provider: {
            id: modelConfig.provider_id,
            name: "Local fake Responses provider",
            base_url: `${responsesUrl}/v1`,
            api_key: "synthetic-provider-key",
            models: [{
              id: modelConfig.model_id,
              name: "Synthetic GPT-6.1 Sol",
              context_window: 1_050_000,
              max_output_tokens: 128_000,
              reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
            }],
          },
        });
      } else if (request.method === "POST" && path === `/api/runtime/outbox/${eventId}/renew`) {
        assert.deepEqual(body, { worker_id: runtimeConfig.workerId, delivery_token: event.delivery_token });
        json(200, { id: eventId, status: "pending" });
      } else if (request.method === "POST" && path === `/api/tasks/${event.task_id}/claim`) {
        json(200, {
          task: {
            id: event.task_id,
            project_id: event.project_id,
            title: "Local Responses tool task",
            description: "Use task context before returning the synthetic result.",
            goal: "Exercise a real Pi tool turn.",
            inputs: "",
            scope: "local test",
            constraints: "No external network calls.",
            acceptance_criteria: ["Include a run receipt"],
          },
          execution: { id: "execution-live-001", lease_expires_at: new Date(Date.now() + 300_000).toISOString() },
          lease_token: "task-lease-fence",
        });
      } else if (request.method === "GET" && path === `/api/tasks/${event.task_id}/context`) {
        seen.contextReads++;
        json(200, { task: { id: event.task_id }, events: [] });
      } else if (request.method === "POST" && path === `/api/tasks/${event.task_id}/progress`) {
        json(200, { id: event.task_id, progress: body.progress });
      } else if (request.method === "POST" && path === `/api/tasks/${event.task_id}/renew`) {
        json(200, { execution: { id: "execution-live-001" }, lease_token: "task-lease-fence" });
      } else if (request.method === "POST" && path === `/api/tasks/${event.task_id}/submit`) {
        seen.submissions.push(body);
        json(200, { task: { id: event.task_id, status: "in_review" } });
      } else if (request.method === "POST" && path === `/api/runtime/outbox/${eventId}/ack`) {
        assert.fail("terminal sync already acknowledges the outbox; no second ack is allowed");
      } else {
        json(404, { detail: { message: "Not found" } });
      }
    });
    const platformUrl = await listen(platformServer);
    const runtimeConfig = config(dataDir, { ORDIVANT_API_URL: platformUrl });
    engine = new RuntimeEngine(runtimeConfig);
    dispatcher = new OutboxDispatcher(runtimeConfig, engine, { pollIntervalMs: 5, leaseSeconds: 3, outboxLeaseHeartbeatMs: 100 });
    const dispatchLoop = dispatcher.start();
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 15_000;
      const poll = () => {
        if (seen.acknowledgements.length === 1) return resolve();
        if (Date.now() >= deadline) return reject(new Error("live dispatcher did not acknowledge its outbox event"));
        setTimeout(poll, 10);
      };
      poll();
    });
    await dispatcher.stop();
    await dispatchLoop;

    assert.deepEqual(seen.authorizationErrors, []);
    assert.equal(seen.contextReads, 1);
    assert.equal(seen.requests.length, 2);
    assert.ok(seen.requests[1].body.input.some((message) =>
      message.type === "function_call_output" && message.call_id === "call-get-context" && message.output.includes('"task"')));
    assert.equal(seen.submissions.length, 1);
    assert.equal(seen.submissions[0].summary, "MODEL_TOOL_OK=42");
    const receipt = JSON.parse(seen.submissions[0].artifacts[1].content);
    assert.deepEqual(receipt, {
      mode: "live",
      requested: modelConfig,
      returned: { provider_id: "provider-synthetic", model_id: "gpt-6.1-sol-2026-10-07b" },
      usage: {
        input_tokens: 18,
        uncached_input_tokens: 9,
        cached_input_tokens: 6,
        cache_write_tokens: 3,
        output_tokens: 7,
        total_tokens: 25,
      },
      tools: [{ name: "get_task_context", calls: 1 }],
      cost_usd: null,
    });
    assert.equal(
      receipt.usage.uncached_input_tokens + receipt.usage.cached_input_tokens + receipt.usage.cache_write_tokens,
      receipt.usage.input_tokens,
    );
    assert.deepEqual(seen.acknowledgements, ["delivered"]);
    assert.ok(seen.syncs.some((sync) => sync.status === "done" && sync.receipt?.returned?.model_id === "gpt-6.1-sol-2026-10-07b"));
    assert.equal(seen.submissions[0].artifacts[1].kind, "test_report");
    assert.equal(seen.requests.every(({ body }) => body.store === false), true);
  } finally {
    await dispatcher?.stop();
    if (platformServer) await close(platformServer);
    if (responsesServer) await close(responsesServer);
    if (engine) await engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("configured Responses requests reject redirects without forwarding provider credentials", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-redirect-runtime-"));
  let engine;
  let responsesServer;
  let redirectTarget;
  try {
    let originRequests = 0;
    const targetRequests = [];
    redirectTarget = (await import("node:http")).createServer((request, response) => {
      targetRequests.push({ url: request.url, authorization: request.headers.authorization });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "must-not-be-reached", output: [] }));
    });
    const targetUrl = await listen(redirectTarget);
    responsesServer = (await import("node:http")).createServer((request, response) => {
      originRequests++;
      assert.equal(request.headers.authorization, "Bearer synthetic-redirect-provider-key");
      response.writeHead(302, { location: `${targetUrl}/capture` });
      response.end();
    });
    const responsesUrl = await listen(responsesServer);
    const runtimeConfig = config(dataDir);
    engine = new RuntimeEngine(runtimeConfig);
    const modelConfig = {
      provider_id: "provider-redirect-test",
      model_id: "gpt-6.1-sol",
      reasoning_effort: "low",
      max_output_tokens: 321,
    };
    const response = await engine.enqueue({
      request_id: "request-redirect-test",
      task_id: "task-redirect-test",
      agent_id: "agent-redirect-test",
      prompt: "Exercise redirect rejection against a local test server.",
      model_config: modelConfig,
    }, undefined, {
      id: modelConfig.provider_id,
      name: "Redirect test provider",
      base_url: `${responsesUrl}/v1`,
      api_key: "synthetic-redirect-provider-key",
      models: [{
        id: modelConfig.model_id,
        name: "Synthetic GPT-6.1 Sol",
        context_window: 1_050_000,
        max_output_tokens: 128_000,
        reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
      }],
    });
    const completed = await engine.waitFor(response.request_id);

    assert.equal(completed?.status, "failed");
    assert.equal(originRequests, 1);
    assert.deepEqual(targetRequests, []);
  } finally {
    if (responsesServer) await close(responsesServer);
    if (redirectTarget) await close(redirectTarget);
    if (engine) await engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("live pending runs wait for a fresh dispatcher handoff after restart", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ordivant-live-restart-runtime-"));
  let firstEngine;
  let restartedEngine;
  let responsesServer;
  try {
    const runtimeConfig = config(dataDir);
    firstEngine = new RuntimeEngine(runtimeConfig);
    firstEngine.store.reserve({
      request_id: "request-live-restart-test",
      task_id: "task-live-restart-test",
      agent_id: "agent-live-restart-test",
      prompt: "Resume this configured run only after a new dispatcher handoff.",
      model_config: {
        provider_id: "provider-restart-test",
        model_id: "gpt-6.1-sol",
        reasoning_effort: "low",
        max_output_tokens: 321,
      },
      mode: "live",
    }, "conversation-before-restart");
    await firstEngine.close();
    firstEngine = undefined;

    restartedEngine = new RuntimeEngine(runtimeConfig);
    await restartedEngine.resumePending();
    const record = restartedEngine.store.get("request-live-restart-test");
    assert.equal(record?.mode, "live");
    assert.equal(record?.status, "queued");
    assert.equal(record?.receipt, null);
    assert.equal(record?.error, null);

    let responseRequests = 0;
    responsesServer = (await import("node:http")).createServer(async (request, response) => {
      responseRequests++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      assert.equal(request.url, "/v1/responses");
      assert.equal(body.model, "gpt-6.1-sol");
      assert.equal(body.store, false);
      const output = {
        type: "message",
        id: "message-after-restart",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "RECOVERED_LIVE_RUN", annotations: [] }],
      };
      const events = [
        { type: "response.created", response: { id: "resp-after-restart" } },
        { type: "response.output_item.added", output_index: 0, item: output },
        { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "RECOVERED_LIVE_RUN" },
        { type: "response.output_item.done", output_index: 0, item: output },
        {
          type: "response.completed",
          response: {
            id: "resp-after-restart",
            model: "gpt-6.1-sol-returned",
            status: "completed",
            output: [output],
            usage: {
              input_tokens: 9,
              output_tokens: 3,
              total_tokens: 12,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ];
      response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
    const responsesUrl = await listen(responsesServer);
    const modelConfig = record.model_config;
    const resumed = await restartedEngine.enqueue({
      request_id: record.request_id,
      task_id: record.task_id,
      agent_id: record.agent_id,
      prompt: record.prompt,
      model_config: modelConfig,
    }, undefined, {
      id: modelConfig.provider_id,
      name: "Restart test provider",
      base_url: `${responsesUrl}/v1`,
      api_key: "synthetic-restart-provider-key",
      models: [{
        id: modelConfig.model_id,
        name: "Synthetic GPT-6.1 Sol",
        context_window: 1_050_000,
        max_output_tokens: 128_000,
        reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
      }],
    });
    assert.equal(resumed.request_id, record.request_id);
    const completed = await restartedEngine.waitFor(record.request_id);
    assert.equal(completed?.status, "done");
    assert.equal(completed?.answer, "RECOVERED_LIVE_RUN");
    assert.equal(completed?.receipt?.returned?.model_id, "gpt-6.1-sol-returned");
    assert.equal(responseRequests, 1);
  } finally {
    if (firstEngine) await firstEngine.close();
    if (responsesServer) await close(responsesServer);
    if (restartedEngine) await restartedEngine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
