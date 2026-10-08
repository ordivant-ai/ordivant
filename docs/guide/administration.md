# 管理員、角色與企業登入

Ordivant 的瀏覽器登入由共用 Identity 服務提供；Work、Knowledge、Code 各自檢查產品角色和資源範圍。SSO 登入成功只建立人類平台 session，不會直接給使用者 Agent token、Runtime 身分或 Gitea credential。

## 初始管理員與成員

每個 Compose project／環境有自己的 Identity 資料。第一次開啟 Web 時建立該環境的第一位管理員；沒有預設人類帳號。管理員可邀請成員、停用帳號、撤銷工作階段，並授予產品角色及 Work Project、Knowledge Space、Code Project 的明確範圍。

邀請需由管理員把一次性邀請碼安全提供給受邀成員；邀請會過期，不會由本機 helper 寄出郵件。一般成員只看得到明確授權的資源。建立新 Project 或 Space 由管理員負責。密碼復原使用登入時設定的復原碼，沒有假設性的 email reset 流程。

## 產品角色

| 產品 | 角色 | 主要權限 |
|---|---|---|
| Work | Manager | 管理已授權專案的工作與執行安排 |
| Work | Worker | 執行獲授權任務並提交成果 |
| Work | Reviewer | 獨立審查成果；不可接受自己的提交 |
| Knowledge | Manager | 管理已授權 Space 內的文件和決策；新增 Space 由 Identity 管理員建立 |
| Knowledge | Writer | 建立文件、發佈新版本、記錄決策 |
| Knowledge | Reader | 搜尋與閱讀已授權 Space |
| Code | Manager | 管理已授權 Code Project |
| Code | Writer | 在已授權 Project 建立 repository 及變更 |
| Code | Reader | 查閱 Project、repository、PR 和狀態收據 |

組織的 Identity `admin` 可管理人員和授權；產品角色是另一層權限。同一人可以在三個產品有不同角色或範圍。Agent 使用獨立的 scoped identity；不能用一個產品的權限推導另一個產品的存取權。

## 設定企業 OIDC

1. 以管理員登入該環境，開啟「帳號與安全性 → 企業 SSO」。
2. 在企業 IdP 建立 confidential OIDC Web application，啟用 Authorization Code 與 PKCE S256。
3. 將 Ordivant 畫面顯示的完整 Callback URL 註冊為 Redirect URI，不使用萬用字元。
4. 輸入該組織的 Issuer、Client ID、Client Secret、允許網域與成員佈建政策；需要群組時設定 IdP groups claim 和明確的產品／範圍對應。
5. 儲存後執行連線測試，再以一般成員測試登入、產品存取及登出。確認復原管理員路徑可用後，才考慮啟用 SSO-only。

成員採受邀或明確設定的 JIT 政策；相同 email domain 本身不授予全組織權限。Client Secret 加密保存、表單不回填明文。直接 OIDC 是登入協定；若企業只有 SAML 或 LDAP/Active Directory，可選擇 Keycloak broker，細節與互動式初始化要求見[企業登入說明](../enterprise-sso.md)。目前沒有 SCIM 佈建功能。

## Agent 與模型連線

模型連線由組織管理員設定 endpoint、model 與 provider key，再選擇組織預設或 Agent 個別設定。Runtime 只取得執行所需的 scoped configuration；人類瀏覽器不會收到 Runtime/API secret。工具連線 token 也是 write-only 並加密保存，請參閱[執行使用指南](../execution-usage.md)。

正式環境使用前，檢查 TLS、可信 origin、允許的成員佈建策略、Project/Space scope 與復原碼保存方式。SSO 並不取代每項產品的 server-side 授權。
