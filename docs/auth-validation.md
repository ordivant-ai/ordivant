# 原生帳號驗收 {#native-account-acceptance}

請使用隔離的本機 Compose 專案。此 fixture 僅接受 `http://127.0.0.1:8092`；請勿將該連接埠或專案用於真實使用者資料。它會建立合成帳號與業務資源、變更合成帳號的密碼／權限，並且只會重新啟動或暫停帶有指定標籤的 QA 服務。

```powershell
$env:ORDIVANT_WEB_PORT = '8092'
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa -Seed
$env:UV_CACHE_DIR = Join-Path (Get-Location) '.cache/uv'
uv run --project backend --no-sync python scripts/auth_acceptance.py --containers
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa -Action down
Remove-Item Env:ORDIVANT_WEB_PORT
```

若要驗收開發模式，請指定 `-Development`、設定 `ORDIVANT_DEV_WEB_PORT=8092`，並透過對應的 `ORDIVANT_*_PORT` 變數，為 Work／Knowledge／Code／Identity 選擇未使用的主機 API 連接埠。變更模式前，請先停止 production QA 專案。驗收命令本身不變。主環境 `5173` 與 `8088` 各自使用獨立資料庫與憑證。

HTTP 檢查涵蓋初始設定完成後的封鎖、Cookie 旗標、私有 introspection、共用人類身分與各產品本地 principal、並行綁定、明確的成員範圍、禁止擴張範圍、無效 Bearer 的優先處理、Origin／CSRF 驗證、一次性邀請／復原、密碼與工作階段撤銷、停用帳號、節流、重新啟動後的持久性、Identity 中斷時採取 fail-closed，以及該中斷期間仍可獨立使用 Agent Bearer。報告只包含檢查結果與業務資源 ID，不含密碼、工作階段識別值、CSRF 值、邀請碼或復原碼。

Identity 單元測試使用暫存資料庫與合成憑證：

```powershell
Push-Location products/identity/backend
uv run --no-sync python -m pytest tests -q
Pop-Location
```

瀏覽器驗收會在同一隔離專案中，以既有合成帳號正常登入。請用滑鼠實際操作選單，不可只確認 ARIA 展開狀態或鍵盤導覽：包括產品專案／Space 選擇器、Work 狀態篩選器、Modal 中的任務優先級，以及顯示於 Drawer／Modal 上方的權限範圍選擇器。在 390×844 視窗中，請確認彈出選單邊界、文件寬度、可見的帳號控制項與登出功能。密碼建立／變更／復原測試透過 HTTP fixture 執行；使用者自行輸入真實憑證。

產品／帳號契約見 [auth-contracts.md](auth-contracts.md)，操作說明見 [human-login.md](human-login.md)，已完成的驗收證據見 [validation.md](validation.md)。
