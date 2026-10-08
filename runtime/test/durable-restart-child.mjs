import { once } from "node:events";
import { createRuntimeServer } from "../dist/server.js";
import { loadConfig } from "../dist/config.js";
import { RuntimeEngine } from "../dist/engine.js";

const phase = process.argv[2];
const input = {
  request_id: "outbox-event-001",
  task_id: "task-001",
  agent_id: "agent-001",
  prompt: "Produce a deterministic receipt for this task.",
};
const runtimeConfig = loadConfig(process.env);
const engine = new RuntimeEngine(runtimeConfig);
let server;

try {
  if (phase === "initial") {
    server = createRuntimeServer(runtimeConfig, engine);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    const headers = {
      authorization: "Bearer test-runtime-token",
      "content-type": "application/json",
    };
    const unauthorizedStatus = (await fetch(`${baseUrl}/runs/${input.request_id}`)).status;
    const [firstResponse, duplicateResponse] = await Promise.all([
      fetch(`${baseUrl}/runs`, { method: "POST", headers, body: JSON.stringify(input) }),
      fetch(`${baseUrl}/runs`, { method: "POST", headers, body: JSON.stringify(input) }),
    ]);
    const first = await firstResponse.json();
    const duplicate = await duplicateResponse.json();
    const conflictStatus = (await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, prompt: "different input" }),
    })).status;
    const completed = await engine.waitFor(input.request_id);
    process.stdout.write(JSON.stringify({
      health,
      unauthorizedStatus,
      firstResponseStatus: firstResponse.status,
      duplicateResponseStatus: duplicateResponse.status,
      first,
      duplicate,
      conflictStatus,
      completed,
    }) + "\n");
  } else if (phase === "replay") {
    const replayResponse = await engine.enqueue(input);
    await engine.waitFor(input.request_id);
    const record = engine.store.get(input.request_id);
    process.stdout.write(JSON.stringify({
      status: record?.status,
      conversation_id: replayResponse.conversation_id,
      submission_id: record?.submission_id,
      answer: record?.answer,
    }) + "\n");
  } else {
    throw new Error(`Unknown test phase: ${phase}`);
  }
} finally {
  if (server?.listening) {
    server.close();
    await once(server, "close");
  }
  await engine.close();
}
