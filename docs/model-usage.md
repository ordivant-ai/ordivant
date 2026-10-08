# 模型連線與 Agent 設定

模型設定屬於 Work；Knowledge、Code 不需要模型連線就能使用自己的 API／MCP。開發與部署環境各有獨立資料庫，設定不會跨環境同步。

## 管理員設定全域連線

1. 登入 Work，從側欄開啟「模型連線」。只有組織管理員可以管理連線。
2. 新增 Provider，填入名稱、識別碼、API base URL 和 API key。相容 Responses API 的網址以 `/v1` 結尾，程式會呼叫其 `/responses`。
3. 新增模型的 ID、顯示名稱、context／output 限制及支援的 reasoning efforts。這些限制是設定值；不代表平台驗證了上游的實際容量或費率。
4. 指定組織預設的 Provider、模型、推理強度和單次輸出上限，儲存設定。

金鑰只寫入 Work 伺服器的加密設定。重新開啟設定會顯示「已設定」，不回傳原始金鑰；留空再儲存會保留原有金鑰。只改模型或 reasoning effort 不需要換 key。改 API base URL 時必須明確提供該端點使用的 key。版本衝突會要求重新載入，避免覆蓋另一位管理員的變更。

## 建立或編輯 Agent

在「Agent 名錄」新增 Agent，將 Runtime 選成 `Pi Durable`。模型設定可以選：

| 模式 | 行為 |
|---|---|
| 繼承全域預設 | 新派工使用當時的組織預設，適合共同使用同一連線的 Agent |
| 個別設定 | 指定 Provider、模型、推理強度與輸出上限，仍使用該 Provider 保存的 key |

編輯 Agent 也提供相同設定。改回繼承會移除個別設定；Agent 名錄顯示實際生效的選擇。已經派出的工作保留派工時的模型選擇，設定變更影響下一次派工。

`External` Agent 由外部程式透過 REST／MCP 工作，平台不代替它呼叫模型；這種 Agent 的模型名稱只是外部執行者的描述。

## Provider 設定範例

填入你的模型供應商提供的 HTTPS base URL（例如 `https://api.example.com/v1`，此為佔位範例，不能直接呼叫），以及該供應商實際支援的 Model ID、reasoning effort 和 context/output 限制。平台沒有附贈模型服務或 API key。

模型容量上限與單次輸出上限是不同設定。可先用小輸出上限測試；Pi adapter 的最低輸出上限是 16。每次模型請求強制 `store:false`。API 相容性、模型回傳及費率仍以供應商服務為準。

開發與正式環境的連線需要各自設定；切換模型可沿用同一 Provider 已保存的 key。

## 執行與證據

建立任務、指定有專案權限的 Pi Agent 後派工。已設定連線的派工使用真實模型；未設定連線時使用清楚標示的 DEMO。模型或 API 失敗會留下失敗狀態，不能回退成示範成功。

Pi 模型可以呼叫平台工具讀取任務與回報進度；成果提交後進入「待驗收」，必須由獨立且有權限的審查者接受。模型的 token usage、上游回報 model ID、工具名稱和呼叫次數保存在執行 receipt。模型回報的身分無法單獨證明代理服務底層路由；美元費用保持未知，不能把 token usage 當成帳單。

服務健康檢查的 `mode` 是未設定工作的預設行為。即使顯示 `demo`，有連線的工作也可以有 `mode:live` receipt；以單次工作的 receipt 判斷實際執行方式。

備份模型設定時，需一起保存 Work 資料庫及 Work data volume 的 `model-settings.key`。只還原資料庫而遺失加密金鑰，無法解密原有 Provider key。

詳細 API 與 runtime 邊界見 [模型契約](model-contracts.md)。驗收報告位置與實際完成範圍見 [驗收紀錄](validation.md)。
