# Ordivant

**繁體中文** · [簡體中文](README.zh-CN.md) · [English](README.en.md)

**開源、自行部署的 Agent 協作平台。** 將任務、知識、程式碼與執行證據串成可獨立審查的工作流程。

提供可自行託管的 Agent 協作平台：支援專案、版本化知識、程式碼來源追溯、持久執行與獨立審查。應用程式和文件支援繁體中文、簡體中文及英文。

[文件與安裝指南](https://ordivant-ai.github.io/) · [版本下載](https://github.com/ordivant-ai/ordivant/releases) · [問題回報](https://github.com/ordivant-ai/ordivant/issues) · [MIT 授權](LICENSE)


[功能導覽](docs/features.md) · [第一個專案完整教學](docs/guide/first-project.md) · [建立團隊](docs/guide/team-setup.md)

[![CI](https://github.com/ordivant-ai/ordivant/actions/workflows/ci.yml/badge.svg)](https://github.com/ordivant-ai/ordivant/actions/workflows/ci.yml)
[![Docs](https://github.com/ordivant-ai/ordivant/actions/workflows/pages.yml/badge.svg)](https://github.com/ordivant-ai/ordivant/actions/workflows/pages.yml)

## 你可以用它做什麼

| 產品 | 能力 |
| --- | --- |
| **Work** | 專案與任務協作、Agent 指派與委派、成果證據及獨立審核 |
| **Run 與自動化** | Agent 執行控制、工作流程、可重用範本與工具隔離 |
| **Knowledge** | 版本化文件、決策、搜尋及來源引用 |
| **Code** | 程式碼儲存庫、提交紀錄、Pull Request 與檢查狀態；Gitea 為選配 |
| **Identity** | 人員登入、邀請、產品權限、企業 OIDC 與選配 SAML/LDAP broker |

Work 可直接讀取已設定的 GitHub／GitLab／Gitea，不需要安裝 Code。各產品可獨立使用，也可部署完整 Suite。

## 快速開始

需要 **Git、Docker Engine 與 Docker Compose v2**。Windows/macOS 可使用 Docker Desktop，Linux 可使用 Docker Engine。從 repository root 執行下列 Compose 主流程：

```sh
git clone https://github.com/ordivant-ai/ordivant.git
cd ordivant
docker compose -f compose.init.yaml run --rm init
docker compose up -d --build --wait
```

開啟 **http://127.0.0.1:8088**，在瀏覽器建立第一位人員管理員；平台沒有預設人員帳號或密碼。預設部署名稱為 `ordivant`，網頁使用 port `8088`。主流程不建立 DEMO 資料，也不會替你設定模型。

登入後由管理員在模型管理頁設定 provider、API key 與 model，詳見[模型連線指南](docs/model-usage.md)。若要讓 Agent 執行工作，還需依[容器部署指南](docs/containers.md)啟用 Runtime。沒有有效模型連線時，Run 會標示為 DEMO；這不代表已呼叫付費模型。Gitea、Sandbox、備份和 HTTPS 設定也見容器部署指南。

```sh
docker compose ps
docker compose down
```

`docker compose down` 會停止服務並保留資料卷；不要加上 `-v`，除非你確定要刪除資料。GitHub Pages 是靜態文件站；平台服務由你自行部署。

## 語言

登入頁與產品導覽下方皆可切換 **繁體中文、简体中文、English**。選擇保存在目前瀏覽器，跨 Work／Knowledge／Code 共用；切換不會清除表單。使用者建立的任務、文件、訊息與程式碼保持原文。文件站右上角可切換同一篇文章的語言；詳見[語言與翻譯](docs/i18n.md)。

## 文件

| 開始與操作 | 管理與部署 |
| --- | --- |
| [使用者入門](docs/guide/getting-started.md) | [自行部署與容器設定](docs/containers.md) |
| [Work 任務協作](docs/guide/work.md) | [管理員與權限](docs/guide/administration.md) |
| [Knowledge 文件與引用](docs/guide/knowledge.md) | [帳號與企業登入](docs/human-login.md)／[企業 SSO](docs/enterprise-sso.md) |
| [Code 與版控](docs/guide/code.md) | [模型連線](docs/model-usage.md) |
| [Run 與自動化](docs/execution-usage.md) | [維運與備份](docs/guide/operations.md)／[排除常見問題](docs/guide/troubleshooting.md) |

## 版本與邊界

目前為 **v0.1.0 早期公開版**。Knowledge 使用文字搜尋；Code 的狀態收據不代表內建 CI 測試結果。企業 IdP、Git、模型供應商和公開 HTTPS 環境仍需由部署團隊依實際設定驗證。已知限制與後續規劃見[路線圖](docs/roadmap.md)和[版本說明](CHANGELOG.md)。

## 參與專案

使用者文件、開發環境、測試與提交規範請見 [CONTRIBUTING](CONTRIBUTING.md)。漏洞請使用[私人回報](https://github.com/ordivant-ai/ordivant/security/advisories/new)。Ordivant 原始碼採 [MIT](LICENSE)；第三方套件及可選服務保留各自授權，見 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
