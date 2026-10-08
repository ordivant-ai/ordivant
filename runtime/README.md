# Ordivant Runtime

Local Node 24 adapter for Pi Durable and the Ordivant runtime outbox. Each agent has a stable Pi Durable root conversation in its own SQLite file. The request index is also SQLite-backed; Pi Durable owns the transcripts and durable generation tasks.

## Setup

From `runtime/`:

```powershell
npm install --cache ..\.cache\npm\runtime --no-audit --no-fund
npm run build
npm test
```

The root local runner builds this package and launches `dist/server.js --dispatcher`. To start it directly:

```powershell
node dist/server.js
node dist/server.js --dispatcher
```

The service binds only to `127.0.0.1:8090`. One process must own each runtime data directory because Pi Durable SQLite storage does not coordinate multiple processes. The default data root is repository `.data/`; Pi and request databases are written under `.data/runtime/`. Set `ORDIVANT_DATA_DIR` to change the data root.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ORDIVANT_RUNTIME_MODE` | `demo` | Fallback for unconfigured requests: demo uses the deterministic provider; live requires a configured per-event selection. Configured Work dispatches always use their live connection. |
| `ORDIVANT_RUNTIME_TOKEN` | `.data/bootstrap.json` runtime token | Protects local run endpoints. Required when `NODE_ENV=production` or `ORDIVANT_MODE=production`. |
| `ORDIVANT_DATA_DIR` | repository `.data/` | Parent directory for `bootstrap.json` and `runtime/`. |
| `ORDIVANT_BOOTSTRAP_PATH` | `$ORDIVANT_DATA_DIR/bootstrap.json` | Optional explicit bootstrap path. |
| `ORDIVANT_API_URL` | `http://127.0.0.1:8000` | Python service URL used by the dispatcher and scoped tools. |
| `ORDIVANT_RUNTIME_PORT` | `8090` | Local HTTP port. |

Organization administrators configure Work provider connections and defaults in the `模型連線` page. Agent creation/editing can inherit or override provider/model/reasoning/output choices. The dispatcher receives encrypted-at-rest credentials through a fenced Python handoff, keeps them in memory and registers the selected model with Pi AI's Responses adapter. It does not depend on a model being present in Pi's bundled catalog. See [operator usage](../docs/model-usage.md) and [API contracts](../docs/model-contracts.md).

Every configured call forces the selected model, reasoning effort, output ceiling and `store:false`. Starting the service does not make a model call; dispatch admits it. A failed live model call must fail the run without a demo fallback. Unit tests use synthetic local providers; the separate live acceptance script uses the user-authorized endpoint and synthetic prompts only.

## HTTP API

`GET /health` reports Pi Durable, SQLite, mode, and model configuration. It does not expose tokens or API keys.

The following routes require `Authorization: Bearer <runtime token>` when a token is configured:

| Route | Behavior |
| --- | --- |
| `POST /runs` | Admits unconfigured `{request_id, task_id, agent_id, prompt, model?}` demo requests. Live credentials are admitted internally by the outbox dispatcher, never in this public body. |
| `GET /runs/{request_id}` | Reads persisted status, answer, a safe error summary and secret-free receipt. |
| `POST /runs/{request_id}/resume` | Reacquires the same Pi Durable submission by `request_id` and resumes pending work. |
| `POST /runs/{request_id}/abort` | Aborts the currently active request for its agent conversation. |

Reusing a request ID with the same input returns its existing run; changing the input for that ID returns `409`. Pi Durable receives that request ID as its own `requestId`, so the durable submission is not duplicated across retries or process restarts.

Live receipts contain the requested selection, model ID observed on the upstream completion event, inclusive input/output/total usage, uncached/cached/cache-write input breakdown and observed model tool calls. `cost_usd` is null because no verified rate or invoice is configured. Unknown usage remains null. A pending live run after process restart waits for the dispatcher's renewed authorized credential handoff; it cannot execute as demo. Automatic model-generation retries and redirects are disabled for configured provider requests.

## Outbox and authorization

Run `node dist/server.js --dispatcher` to poll `/api/runtime/outbox/claim`. The runtime token authorizes claim, fenced configuration handoff, delivery renewal and acknowledgement. The handoff issues a credential for exactly the assigned Agent, including newly created Agents. Each business claim, renewal, progress update, collaboration message, delegation and result submission uses that credential; the runtime never substitutes its broader runtime identity. The backend revokes the delivery credential on acknowledgement.

Claim, progress and submission callbacks use stable idempotency keys. Progress tool calls use the Pi task ID, so each distinct operation has a distinct key while replaying the same durable tool task reuses its key. The dispatcher renews both delivery ownership and the task execution lease during a run, submits evidence after the Pi submission settles, then acknowledges the outbox event. Failed runs release the lease when the callback is still authorized. Platform errors and model errors are not written to stdout with request bodies or credentials.

The installed `ordivant-platform` tools expose current task context, ready task discovery, leased progress reports, project-scoped messages, and child-task delegation. Tool code obtains identity and scope from the current conversation's assigned agent and active run; model arguments cannot choose an actor or provide a credential.

## Demo mode and limits

Demo mode uses the real `@earendil-works/pi-durable` Harness and its Node SQLite storage, with a deterministic Pi AI faux provider. Its answer is a persisted receipt containing the prompt length and SHA-256 digest. Outbox submissions are explicitly titled and summarized as `DEMO MODE`; they state that the task was not verified as complete. A review is still required to move business work to done.

The runtime process owns one SQLite file per agent. Back up `.data/runtime/` together with the backend database if local transcript recovery is required. Do not copy a live directory while its owner is writing. Provider authentication and durable state belong on the local host; they are not sent to the browser.
