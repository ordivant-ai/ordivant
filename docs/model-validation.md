# 真實模型與設定驗收

日期：2026-10-07，Asia/Taipei。模型設定、Pi runtime 和前端分別由三位 luna-worker 實作，PM 負責共同契約、受信任的本機匯入、容器整合、HTTP／滑鼠／真實模型驗收。

## 實際完成範圍

| 驗收 | 證據 | 結果 |
|---|---|---|
| Work 設定與安全性單元測試 | `backend/tests/test_model_settings.py`；全 Work 測試 | 31 passed；加密、跨組織隔離、管理員限制、revision、錯誤遮蔽、null 清除、快照、handoff scope/fence/期限與撤銷 |
| Runtime 與 Responses adapter | `runtime/test/runtime.test.mjs` | 5 passed；實際 Pi Harness／本機合成 Responses server、工具回合、usage cache breakdown、redirect 拒絕且只請求一次、pending live 重啟等候 handoff |
| 前端 | TypeScript；suite/work/knowledge/code builds | 全部通過 |
| 真實端點協定測試 | `.data/validation/live-probe-388b5ccd/report.json` | `/models` 找到指定模型；兩個串流 `/responses` 完成事件、模型發起工具呼叫並使用 42 的工具結果 |
| Cookie 管理員與 scoped manager 設定 | `.data/validation/model-settings-76ed3fd4/report.json` | 全部通過；只使用隔離 QA 合成 key，未呼叫模型 |
| 桌面／390px 真實滑鼠操作 | `.data/validation/model-browser/report.json` 及 PNG | 全域保存、key 空白、Agent 新建 override、編輯繼承、reload 保留、Modal popup 命中與手機保存通過 |
| 真實 Work → Pi → provider → tools → evidence → review | `.data/validation/live-work-08fdbdb1/report.json` | 全部通過；新建專案／Agent、冪等派工、模型工具呼叫、單一 execution、成果／receipt、禁止執行者自審、獨立審查與重啟持久化 |
| 加密與 runtime 紀錄檢查 | `.data/validation/live-work-08fdbdb1/record-checks.json` | Provider key 加密；臨時 Agent delivery token 已撤銷；Pi／request SQLite、idempotency response 與近期 API/runtime logs 未包含 key 或 delivery token |
| 本機 production image runtime 回歸 | `.data/validation/model-production-runtime.json` | 無模型連線的 DEMO 派工、evidence、獨立審查通過；沒有外部 provider 請求 |

最後一份 live receipt 回報：

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

模型回報 `SYNTHETIC_RESULT=42`，由平台受限工具讀取自己的任務與回報進度，結果進入 `in_review`。獨立、已授權的測試 reviewer 驗證 receipt 和結果後接受，任務成為 `done`；它是測試程式，不宣稱是另一個 AI 模型審查。重啟 runtime 後仍是同一個 submission 和 receipt。

較早的 `.data/validation/live-work-2be61825/` 是修正 cache 統計前的驗收，其 input 欄位只有 uncached 部分；以最後報告為準。沒有改寫或丟棄先前歷史紀錄。

## 重現

一般程式檢查不會呼叫外部模型：

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

隔離設定 API 驗收需要已準備的 `ordivant-auth-qa`、8092 及原有合成帳號，只操作該 QA：

```powershell
$env:ORDIVANT_WEB_PORT = '8092'
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa
uv run --project backend --no-sync python scripts/model_settings_acceptance.py
```

公開版本的 Live 驗收需依[Live 驗收設定](execution-usage.md#隔離驗收)明確提供 `ORDIVANT_TEST_PROVIDER_BASE`、`ORDIVANT_TEST_PROVIDER_MODEL`、`ORDIVANT_TEST_PROVIDER_PROJECT`（隔離 `*-qa` Compose project）與 `ORDIVANT_TEST_PROVIDER_KEY_FILE`。沒有預設付費端點，不會自動讀取主環境金鑰；請先在自己的隔離 QA 設定相容 Responses 模型。

```powershell
uv run --project backend --no-sync python scripts/model_probe.py
uv run --project backend --no-sync python scripts/live_model_acceptance.py --restart
uv run --project backend --no-sync python scripts/live_model_record_checks.py PATH_TO_LIVE_REPORT
```

Operator 匯入只作用於明確指定且 ownership 相符的隔離 QA，透過 Docker exec stdin 傳遞 credential，不放入 process arguments；HTTP 仍要求 Identity admin。上述摘要是公開前的歷史證據，原始 `.data/validation/` 報告與私人連線不包含在 clone 中。

`scripts/integration.py` 的原有 runtime 驗收明確限制未設定的 DEMO Agent，避免把 live run 誤標為 demo；已設定模型時應使用獨立 live 腳本。

## 驗收限制

只傳送合成算術／任務資料，沒有傳送倉庫或使用者專案內容。驗證的是此端點的實際模型請求、上游回報的 model ID、usage 和平台工具；代理服務的底層模型路由、容量與美元帳單未獨立驗證。Context／output ceilings 是使用者提供的 metadata。硬性費用上限、費率與帳單比對、企業 SSO、外部 CI、完整備份還原、多人負載仍是各自獨立門檻。

隔離 QA 容器及瀏覽器測試頁在完成後關閉，volumes 保留；開發 5173 與本機 production 8088 的更新 images 保持運作。測試 Provider 只設定在開發環境，production 未配置模型連線。未進行遠端部署、推送或發布。
