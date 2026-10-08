# Execution Feature Acceptance

Date: 2026-10-08 (Asia/Taipei). The Run console, Agent templates and workflows, and MCP tools and sandboxes have been delivered locally. Acceptance includes an authorized live model turn, containers, restarts, concurrency, and mouse-driven browser operation.

Scope and authorization: [execution contracts](execution-contracts.md). Usage: [user guide](execution-usage.md). Acceptance used an isolated `ordivant-execution-qa` PostgreSQL environment at `127.0.0.1:8092` and a previously authorized synthetic QA account.

## Evidence collected

| Check | Result | Coverage |
|---|---|---|
| Work backend | 41 tests passed; compileall passed | Run authorization, leases, stop/retry, terminal-sync reply-loss replay, actual submission and fast-review completion checks, valid-lease redelivery, immutable versions, schedule lock ordering, tool-credential redaction, and scope |
| Existing product regressions | Identity 28, Knowledge 10, and Code 20 tests passed | Existing enterprise sign-in, product authorization, and service behavior |
| Runtime / Pi SDK | 25 tests passed; build passed | Real Pi tool events and receipts, lease renewal/progress races, platform writes with a new token, pause, reply-loss retry with the same body/sequence, submission evidence checks and valid-lease recovery, delayed/failed workspace cleanup, and terminal Run recovery after restart |
| Sandbox service | 3 tests passed | Argument/path restrictions, service authorization, and command errors; actual Docker checks are listed separately |
| REST / MCP / Pi regressions | Passed; the official SDK discovered 29 tools | Real collaboration, claim races, scope, dependencies, review, idempotency, and a real Pi DEMO outbox turn |
| Full execution containers | 53 checks passed | Queued stop/retry, new execution and history, real tool events, automatic dispatch of a two-step DAG and independent review, actual minute intervals, no overlap/cancellation, Runtime authorization in a new project, and sandbox plus Work/Runtime restarts |
| Authorized live-model turn | 20 checks passed | Real MCP wait/add with `Test Provider / gpt-6.1-sol`, tool-boundary pause/resume retaining the same execution, actual Python exit 0 and intentional exit 7, independent PM review, and receipt/execution persistence after restart |
| Record and cleanup checks | 16 checks passed | Offline inspection of the Pi MCP result with sum=42; encrypted provider/MCP credentials, revoked dispatch credentials, no known credentials in Pi/RunStore/idempotency/recent logs, and no remaining QA jobs |
| Final terminal-cleanup regression | 9 checks passed | Real Docker job without a paid model call: create a workspace, complete a DEMO tool turn, wait for actual cleanup before syncing sandbox stopped/unavailable, then obtain independent PM review; no job remains |
| PostgreSQL concurrency | 8 checks passed | Six concurrent version publications produced v2–v7; six manual starts produced one success; eight ticks created one scheduled workflow instance |
| Real MCP/API configuration | 26 checks passed | Official MCP `tools/list`, bearer authentication, host allowlists, write-only keys, Agent creation/editing, template versions, workflow dependencies, and idempotency |
| Real Docker executor | 67 checks passed | Python/Node/Git, file and command tools, exit 0/7, non-root, read-only root, `network none`, resource/workspace/output limits, path/symlink/FIFO handling, timeout, and cleanup |
| Executor crash recovery | 2 checks passed | After SIGKILL and restart of the QA executor, both actual orphan jobs were removed |
| Browser operation | 45 form/automation checks, 10 Run-console checks, and 10 Live-inspector checks passed | Desktop 1440×1000 and mobile 390×844; mouse dropdowns and virtual-list scrolling, template and tool/sandbox bindings, Agent edits, workflow start, retry after losing the response to an already submitted server request returning the same instance/Run, stop/retry, live usage/MCP tools/sandbox stdout/exit 0/7, and mobile detail view |
| Frontend | TypeScript and Suite/Work/Knowledge/Code builds passed | All four independently buildable product modes; existing bundle-size warnings remain |
| Two local environments preserved and healthy | 40 checks passed | Account counts, setup markers, SSO/model/encrypted-provider configuration summaries, and project counts on ports 5173/8088 matched before and after updates; product entry points/APIs returned 200 and Identity, products, Web, Runtime, and sandbox were healthy |
| Isolated QA teardown | 8 checks passed | Owned containers, network, and jobs were removed, named volumes were retained, and Work/Identity in both main environments still returned 200 |

DEMO and synthetic-service checks remain labeled as such; only the live-model row includes actual provider requests. The final live receipt reported `gpt-6.1-sol` as both the requested and returned model, with 40,000 input tokens (16,128 cached), 744 output tokens, and 40,744 total tokens. It recorded one each of MCP wait/add, platform progress, and sandbox write, plus two executions. The provider's actual routing and invoice have not been verified; `cost_usd=null`, so the UI displays an unknown cost.

## Reproducible evidence

Acceptance programs are `scripts/execution_acceptance.py`, `execution_postgres_probe.py`, `sandbox_probe.py`, `execution_browser.py` / `execution_ui.cjs`, `execution_run_browser.py` / `execution_run_ui.cjs`, `execution_live_acceptance.py` / `execution_live_ui.cjs`, `execution_record_checks.py`, `execution_cleanup_acceptance.py`, and `execution_local_readiness.py`. See the usage guide for full startup and test commands.

Reports are stored locally under `.data/validation/`: `execution-e8f561d8/report.json` (53), `execution-55faa750/live-report.json` (20) / `record-checks.json` (16), `execution-cleanup.json` (9), `execution-postgres.json`, `sandbox-integration.json`, `sandbox-crash-recovery.json`, `execution-browser/report.json`, `execution-run-browser/report.json`, `execution-live-browser/report.json`, and browser PNGs. Main-environment preservation/health results are in `execution-local-before.json` / `execution-local-after.json` (40). REST/MCP/Pi regressions are in `20261008-021346-6e1664/report.json`. Reports contain only results and synthetic resource IDs; they do not contain account passwords, provider/MCP keys, Agent credentials, or sandbox capabilities. Earlier failed reports remain for diagnosis; use the final successful reports listed here as the source of truth.

Terminal sync waits for the executor's cleanup promise to settle before reading the latest RunStore state. A failed cleanup DELETE reports sandbox `failed` with a fixed cleanup-unconfirmed event. A terminal workspace whose capability was lost after restart reports `lost`; the model is not rerun and deletion is not claimed. Delayed and failed cleanup checks also confirm that task/delivery heartbeats continue to renew while cleanup is pending.

Historical live acceptance reused a test connection with operator authorization. The public release no longer includes a helper that reads or decrypts credentials from a development database. To reproduce the acceptance, explicitly configure an isolated `*-qa` Compose project, HTTPS endpoint, model, and your own key file; see the [usage guide](execution-usage.md). The public source does not include that connection configuration, its key, or raw QA data.

The two existing main environments were updated without running Seed; the user still creates the first administrator. Development retained its existing encrypted model connection, and local production mode remained without a configured provider. Their PostgreSQL, Gitea, application, Runtime, and sandbox services were healthy. The isolated `ordivant-execution-qa` containers and network were removed with the helper's `down` action; its volumes and acceptance reports were retained. Teardown evidence is in `execution-teardown.json` (8). No external deployment, push, or release was performed.
