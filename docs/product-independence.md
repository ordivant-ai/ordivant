# 獨立產品冒煙檢查 {#product-independence-smoke}

`scripts/product_smoke.py` 會確認 Knowledge 和 Code 都能各自初始化資料並作為獨立產品執行。指令碼每次啟動一項產品，使用隨機 loopback port、該產品自己的 `.venv` Python，以及全新的 `.data/validation/standalone-*` 資料目錄。它不會啟動 Work、Pi runtime 或其他產品的服務。

依序檢查兩項產品：

```powershell
products/code/backend/.venv/Scripts/python.exe scripts/product_smoke.py --product all
```

協調程式只使用 Python 標準函式庫。每項產品的官方 MCP Python SDK 都從該產品自己的環境執行。使用 `--product knowledge` 或 `--product code` 可單獨檢查其中一項產品。

Knowledge 檢查會以 seed 建立的 writer 身分新增文件，讀取不可變的 version 1，並確認文件本文，以及建立文件和讀取版本時回傳的 SHA-256 完全相符；接著搜尋該文件並檢查引用指向正確版本。此檢查也會列出 MCP 工具，並透過 SDK 呼叫 `get_document_context`。

Code 檢查會以 manager 身分讀取 seed 建立的 `code-demo` 專案，確認 health 回報 `gitea_configured: false`，並確認建立 repository 時回傳 `503 gitea_not_configured`。此檢查也會列出 MCP 工具，並透過 SDK 呼叫 `list_code_projects`。測試時，會從 Code 子程式環境中移除繼承的 `ORDIVANT_CODE_GITEA_*` 和 `ORDIVANT_CODE_WEBHOOK_SECRET` 設定。

冒煙檢查命令會輸出不含 token 的 JSON 證據，其中有產品狀態、port、資料目錄、API 檢查及 MCP 往返結果。它只會停止自己啟動的程式。唯一的驗證資料目錄會保留下來；其中含有本機 bootstrap 憑證，因此應保持未追蹤狀態，且不可公開釋出。

2026-10-06 驗證結果：Knowledge 和 Code 的獨立執行均通過，包括 API 和 MCP 檢查。`all` 選項會在同一次執行中依序進行相同檢查。
