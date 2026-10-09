<span id="v0-1-0-公開版本"></span>
<span id="v0-1-0-公开版本"></span>

# v0.1.0 公開版本 {#public-release-v0-1-0}

發布日期：2026-10-08。授權：[MIT](../LICENSE)。原始碼與下載：[GitHub Releases](https://github.com/ordivant-ai/ordivant/releases)。

<span id="本版內容"></span>
<span id="本版内容"></span>

## 本版內容 {#included-in-this-release}

Work／Knowledge／Code 與共用登入、Docker 部署、執行控制台、自動工作流程、Agent 範本、外部工具連接及執行沙箱。完整更新見 [Changelog](https://github.com/ordivant-ai/ordivant/blob/main/CHANGELOG.md)。

<span id="升級與限制"></span>
<span id="升级与限制"></span>

## 升級與限制 {#upgrade-and-limitations}

從 source 部署請先備份資料庫、持久化 volumes 與 `.data/container-secrets/`，確認 Work／Identity 加密金鑰也備妥，再更新程式並用相同 ProjectName 啟動。不要以刪除 volumes 處理升級錯誤。正式投入企業使用前應在隔離環境演練還原；本版未宣稱提供跨區災難復原、完成效能負載測試，或已針對所有企業 IdP 驗證。

建議先閱讀[維運指南](./guide/operations.md)與[已知功能邊界](./roadmap.md)。
