# Live model and settings acceptance

Date: 2026-10-07, Asia/Taipei. Three luna-workers implemented model settings, Pi Runtime, and the frontend respectively. The PM owned shared contracts, trusted local import, container integration, and HTTP, mouse, and live-model acceptance.

## Scope actually completed

| Acceptance | Evidence | Result |
|---|---|---|
| Work settings and security unit tests | `backend/tests/test_model_settings.py`; all Work tests | 31 passed: encryption, cross-organization isolation, administrator restrictions, revisions, error redaction, null clearing, snapshots, and handoff scope/fencing/expiry/revocation |
| Runtime and Responses adapter | `runtime/test/runtime.test.mjs` | 5 passed: actual Pi Harness/local synthetic Responses server, tool turns, cached-usage breakdown, redirect rejection with one request only, and pending live-run wait for handoff after restart |
| Frontend | TypeScript; suite/work/knowledge/code builds | All passed |
| Live endpoint protocol test | `.data/validation/live-probe-388b5ccd/report.json` | `/models` found the requested model; two streaming `/responses` requests completed, the model issued a tool call, and used the tool result of 42 |
| Cookie administrator and scoped-manager settings | `.data/validation/model-settings-76ed3fd4/report.json` | All passed; used only a synthetic key in isolated QA and did not call a model |
| Real desktop/390px mouse interactions | `.data/validation/model-browser/report.json` and PNGs | Global save, blank key, new Agent override, edit inheritance, reload persistence, modal popup selection, and mobile save passed |
| Real Work → Pi → provider → tools → evidence → review | `.data/validation/live-work-08fdbdb1/report.json` | All passed: created Project/Agent, idempotent dispatch, model tool calls, one Execution, result/receipt, prevented self-review, independent review, and restart persistence |
| Encryption and Runtime record checks | `.data/validation/live-work-08fdbdb1/record-checks.json` | Provider key encrypted; temporary Agent delivery token revoked; Pi/request SQLite, idempotency responses, and recent API/Runtime logs contained neither the key nor delivery token |
| Local production-image Runtime regression | `.data/validation/model-production-runtime.json` | DEMO dispatch without a model connection, evidence, and independent review passed; no external provider request occurred |

The final live receipt reported:

```json
{
  "mode": "live",
  "requested_model": "gpt-6.1-sol",
  "returned_model": "gpt-6.1-sol",
  "input_tokens": 17157,
  "uncached_input_tokens": 6661,
  "cached_input_tokens": 10496,
  "cache_write_tokens": 0,
  "output_tokens": 97,
  "total_tokens": 17254,
  "tools": {"get_task_context": 1, "report_progress": 1},
  "cost_usd": null
}
```

The model returned `SYNTHETIC_RESULT=42`, read its task through a scoped platform tool, and reported progress. The result entered `in_review`. An authorized independent test reviewer checked the receipt and result, then accepted it, moving the task to `done`. The reviewer was test software, not another AI model. After Runtime restarted, the same submission and receipt remained.

An earlier acceptance in `.data/validation/live-work-2be61825/` predates the cache-statistics correction and reports only uncached input in its input field; use the final report instead. Earlier historical records were not rewritten or discarded.

## Reproduce

Routine code checks do not call external models:

```powershell
$env:UV_CACHE_DIR = Join-Path (Get-Location) '.cache/uv'
uv run --project backend --no-sync pytest backend/tests -q
Set-Location runtime
npm test
Set-Location ../frontend
npm run typecheck
npm run build:suite
npm run build:work
npm run build:knowledge
npm run build:code
```

The isolated settings API acceptance requires the prepared `ordivant-auth-qa` project, port 8092, and existing synthetic account. It operates only on that QA environment:

```powershell
$env:ORDIVANT_WEB_PORT = '8092'
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa
uv run --project backend --no-sync python scripts/model_settings_acceptance.py
```

For live acceptance against a public release, follow [Live acceptance configuration](execution-usage.md#isolated-acceptance) and explicitly provide `ORDIVANT_TEST_PROVIDER_BASE`, `ORDIVANT_TEST_PROVIDER_MODEL`, `ORDIVANT_TEST_PROVIDER_PROJECT` (an isolated `*-qa` Compose project), and `ORDIVANT_TEST_PROVIDER_KEY_FILE`. There is no default paid endpoint and no automatic lookup of the main environment's key. First configure a Responses-compatible model in your own isolated QA environment.

```powershell
uv run --project backend --no-sync python scripts/model_probe.py
uv run --project backend --no-sync python scripts/live_model_acceptance.py --restart
uv run --project backend --no-sync python scripts/live_model_record_checks.py PATH_TO_LIVE_REPORT
```

Operator import affects only an explicitly selected isolated QA environment whose ownership matches. It passes credentials through Docker exec stdin, not process arguments; the HTTP API still requires an Identity administrator. These summaries are historical evidence from before the public release; the raw `.data/validation/` reports and private connections are not included in a clone.

The existing Runtime acceptance in `scripts/integration.py` explicitly limits itself to an unconfigured DEMO Agent so that a live run is not mislabeled as demo. Use the separate live scripts when a model is configured.

## Acceptance limitations

Only synthetic arithmetic and task data were sent; no repository or user Project content was sent. The checks verified actual model requests to this endpoint, the model ID and usage reported upstream, and platform tools. They did not independently verify the provider's underlying model routing, capacity, or dollar invoice. Context/output ceilings are user-provided metadata. Hard spending limits, rates and invoice reconciliation, enterprise SSO, external CI, full backup restoration, and multi-user load remain separate acceptance gates.

The isolated QA containers and browser test page were stopped after acceptance; their volumes were retained. Updated images remained running in development on port 5173 and local production on 8088. The test Provider was configured only in development; production had no model connection. No remote deployment, push, or release was performed.
