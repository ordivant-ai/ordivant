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

GitHub Actions [CI](https://github.com/ordivant-ai/ordivant/actions) 會在 push 與 Pull Request 上執行各 Python 產品與 Runtime 測試、四種前端建置、合成 REST／MCP 整合檢查及產品 smoke checks；細節見 [CI workflow](https://github.com/ordivant-ai/ordivant/blob/main/.github/workflows/ci.yml)。獨立的 [Documentation workflow](https://github.com/ordivant-ai/ordivant/blob/main/.github/workflows/pages.yml) 會檢查文件語系、公開清單、連結及網站建置。CI 使用可重現的合成資料與 Demo Runtime，不呼叫付費模型，也不代表每種客戶環境或 IdP 都已驗證。

貢獻者可依[貢獻指南](https://github.com/ordivant-ai/ordivant/blob/main/CONTRIBUTING.md)安裝鎖定依賴，並在本機重跑相同的 Python、Runtime、前端及文件檢查。CI 工作流程與重現步驟會隨原始碼一同維護。

<span id="升級與限制"></span>
<span id="升级与限制"></span>

## 升級與限制 {#upgrade-and-limitations}

從 source 部署請先備份資料庫、持久化 volumes 與 `.data/container-secrets/`，確認 Work／Identity 加密金鑰也備妥，再更新程式並用相同 ProjectName 啟動。不要以刪除 volumes 處理升級錯誤。正式投入企業使用前應在隔離環境演練還原；本版未宣稱提供跨區災難復原、完成效能負載測試，或已針對所有企業 IdP 驗證。

建議先閱讀[維運指南](./guide/operations.md)與[已知功能邊界](./roadmap.md)。
