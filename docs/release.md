<span id="v0-1-0-公開版本"></span>
<span id="v0-1-0-公开版本"></span>

# v0.1.0 公開版本 {#public-release-v0-1-0}

發布日期：2026-10-08。授權：[MIT](../LICENSE)。原始碼與下載：[GitHub Releases](https://github.com/ordivant-ai/ordivant/releases)。

<span id="本版內容"></span>
<span id="本版内容"></span>

## 本版內容 {#included-in-this-release}

Work／Knowledge／Code 與共用 Identity、Docker 開發和部署、Run 執行控制台、自動工作流程、Agent 範本、MCP 工具及沙箱。完整更新見 [Changelog](../CHANGELOG.md)。

<span id="驗證方式"></span>
<span id="验证方式"></span>

## 驗證方式 {#validation}

GitHub Actions 對公開原始碼執行鎖定依賴安裝、Python 業務與授權測試、Runtime 測試、四種前端建置及文件站建置。實際使用版本可從倉庫的 Actions 結果確認。

公開前的本機驗收包括 Work 41、Identity 28、Knowledge 10、Code 20、Sandbox 3 與 Runtime 25 個測試；另有真實 Docker、MCP、付費模型、重啟、併發及桌面／手機操作。這些是日期明確的維護者驗收，不代表每種客戶環境已驗證。歷史原始 QA 資料含本機合成資源，未放入 GitHub；可重跑的程式與結果摘要保留於原始碼。詳見[驗收紀錄](./validation.md)。

<span id="升級與限制"></span>
<span id="升级与限制"></span>

## 升級與限制 {#upgrade-and-limitations}

從 source 部署請先備份資料庫、持久化 volumes 與 `.data/container-secrets/`，確認 Work/Identity 加密金鑰也備妥，再更新程式並用相同 ProjectName 啟動。不要以刪除 volumes 處理升級錯誤。正式投入企業使用前應在隔離環境演練還原；本版未宣稱完成跨區容災、效能壓測或所有企業 IdP 驗收。

建議先閱讀[維運指南](./guide/operations.md)與[已知功能邊界](./roadmap.md)。
