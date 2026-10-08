# Ordivant

**繁體中文** · [简体中文](README.zh-CN.md) · [English](README.en.md)

**開源、自行部署的 Agent 協作平台。** 將任務、知識、程式碼與執行證據串成可獨立審查的工作流程。

Self-hosted collaboration for agents: projects, versioned knowledge, code provenance, durable runs and independent review. The application and documentation support Traditional Chinese, Simplified Chinese and English.

[文件與安裝指南](https://bigtongue5566.github.io/ordivant/) · [版本下載](https://github.com/bigtongue5566/ordivant/releases) · [問題回報](https://github.com/bigtongue5566/ordivant/issues) · [MIT 授權](LICENSE)

[![CI](https://github.com/bigtongue5566/ordivant/actions/workflows/ci.yml/badge.svg)](https://github.com/bigtongue5566/ordivant/actions/workflows/ci.yml)
[![Docs](https://github.com/bigtongue5566/ordivant/actions/workflows/pages.yml/badge.svg)](https://github.com/bigtongue5566/ordivant/actions/workflows/pages.yml)

## 你可以用它做什麼

| 產品 | 能力 |
| --- | --- |
| **Work** | 專案與任務、Agent 認領／求助／委派、證據提交、獨立 review、REST/MCP、稽核 |
| **Run 與自動化** | Pi Durable 執行、事件／工具／用量、暫停／繼續／停止／重跑、版本化範本與依賴流程 |
| **Knowledge** | 不可變文件版本、文字檢索、精確引用、決策及來源追溯 |
| **Code** | 選配 Gitea 倉庫、分支、commit、PR、status receipt 與簽章 webhook |
| **Identity** | 原生帳號、session、邀請／復原、資源權限、企業 OIDC 及可選 SAML/LDAP broker |

Work 可直接讀取已設定的 GitHub／GitLab／Gitea，Code 是選配。各產品有獨立 API、MCP 與資料庫，可部署完整 Suite 或單產品加 Identity。

## 快速開始

需要 **Git、Docker（Linux containers）＋ Compose v2、PowerShell 7**。Windows 可用 Docker Desktop；Linux/macOS 安裝 `pwsh` 後使用相同 helper。全部應用依賴在容器內安裝，主機不需要 Python 或 Node。

```powershell
git clone https://github.com/bigtongue5566/ordivant.git
cd ordivant
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Seed -WithRuntime -WithSandbox
```

開啟 **http://127.0.0.1:8088/work**，建立自己的首位管理員。沒有預設人員密碼。`-Seed` 建立清楚標示的 DEMO 資料和首次啟動 runtime 所需的 bootstrap；沒有模型設定時不會呼叫付費模型。

登入後在 **模型連線** 設定自己的 Responses-compatible provider、API key 與 model，再建立 Pi Agent 並派工。金鑰加密保存在 Work，範本不存放金鑰。Run 提交後仍須獨立 reviewer 驗收。

```powershell
# 查看狀態；停止保留資料卷。重啟沿用同一 ProjectName。
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Action status
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Action down
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -WithRuntime -WithSandbox

# 開發模式：source 熱重載，預設 5173；另用專案名，資料獨立。
pwsh -File ./scripts/containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithRuntime -WithSandbox

# 只啟動 Knowledge + Identity + web；不需要 runtime。
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-knowledge -Products knowledge -Seed
```

上列 production 範例共用預設 8088 埠，應依序使用；同時啟動請設定不同 `ORDIVANT_WEB_PORT`。需要本機版控加 `-WithGitea`。從零啟動、模型／帳號與完整例子見[安裝指南](docs/guide/getting-started.md)。GitHub Pages 是靜態文件站，平台由你自行部署。

## 語言

登入頁與產品導覽下方皆可切換 **繁體中文、简体中文、English**。選擇保存在目前瀏覽器，跨 Work／Knowledge／Code 共用；切換不會清除表單。使用者建立的任務、文件、訊息與程式碼保持原文。文件站右上角可切換同一篇文章的語言；詳見[語言與翻譯](docs/i18n.md)。

## 文件

| 開始與操作 | 管理與開發 |
| --- | --- |
| [Work 任務協作](docs/guide/work.md) | [Docker 開發／部署](docs/containers.md) |
| [Run、自動流程、工具與沙箱](docs/execution-usage.md) | [管理員與權限](docs/guide/administration.md) |
| [Knowledge 與精確引用](docs/guide/knowledge.md) | [登入與帳號](docs/human-login.md)／[企業 SSO](docs/enterprise-sso.md) |
| [Code 與版控](docs/guide/code.md) | [備份與維運](docs/guide/operations.md)／[排障](docs/guide/troubleshooting.md) |
| [模型連線](docs/model-usage.md) | [架構／API 契約](docs/reference.md)／[貢獻指南](CONTRIBUTING.md) |

## 版本與邊界

目前為 **v0.1.0 早期公開版**。工作流程支援 DAG、手動及分鐘間隔排程；暫停在工具邊界生效。MCP 連線使用 Streamable HTTP/Bearer；Docker 沙箱無網路、非 root、沒有主機掛載或認證，使用共享 kernel。只有受信任的 sandbox-api 持有 Docker socket。

Knowledge 使用文字搜尋；Code status receipt 不代表內建 CI。尚未提供 SCIM、硬性金額配額、互動式 MCP OAuth、VM 沙箱或分散式執行。企業自己的 IdP、Git、模型及維運環境需另行驗證。詳見[路線圖](docs/roadmap.md)、[版本說明](CHANGELOG.md)及[安全政策](SECURITY.md)。

## 開發與驗證

Python 3.12（uv 管理）、Node.js 24、React/TypeScript/Ant Design、FastAPI、PostgreSQL、Pi Durable。原始碼位於 `backend/`、`frontend/`、`runtime/`、`sandbox/` 與 `products/{identity,knowledge,code}/backend/`。

```powershell
# 本機原生開發依賴與離線／合成驗證
pwsh -File ./scripts/setup.ps1 -SkipSeed
pwsh -File ./scripts/validate.ps1

# 文件站
npm ci --prefix docs
npm run build --prefix docs
npm run preview --prefix docs
```

CI 不需任何付費模型金鑰。付費 Live 驗收為明確 opt-in，使用隔離 QA 與自己指定的 credential 檔。歷史的本機真實模型／Docker／瀏覽器驗收摘要在[驗收紀錄](docs/validation.md)，私有 `.data/` 與原始 QA 資料不隨倉庫發布。

歡迎提交 issue 與 PR；先看 [CONTRIBUTING](CONTRIBUTING.md)。漏洞請用[私人回報](https://github.com/bigtongue5566/ordivant/security/advisories/new)。Ordivant 原始碼採 [MIT](LICENSE)；第三方套件及可選服務保留各自授權，見 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
