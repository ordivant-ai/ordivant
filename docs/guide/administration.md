<span id="管理員、角色與企業登入"></span>
<span id="管理员、角色与企业登录"></span>

# 管理員、角色與企業登入 {#administrators-roles-and-enterprise-sign-in}

Ordivant 的瀏覽器登入由共用 Identity 服務提供；Work、Knowledge、Code 各自檢查產品角色和資源範圍。SSO 登入成功只建立使用者的平台工作階段，不會直接授予 Agent token、Runtime 身分或 Gitea 憑證。

<span id="初始管理員與成員"></span>
<span id="初始管理员与成员"></span>

## 初始管理員與成員 {#first-administrator-and-members}

每個 Compose 專案／環境都有自己的 Identity 資料。第一次開啟 Web 時，請為該環境建立第一位管理員；系統沒有預設使用者帳號。管理員可邀請成員、停用帳號、撤銷工作階段，並授予產品角色，以及 Work Project、Knowledge Space、Code Project 的明確資源範圍。

管理員需安全地將一次性邀請碼提供給受邀成員；邀請碼會過期，本機指令碼不會寄送郵件。一般成員只能查看明確授權的資源。建立新的 Project 或 Space 由管理員負責。密碼復原使用登入時設定的復原碼；目前不提供未實作的電子郵件重設流程。

<span id="產品角色"></span>
<span id="产品角色"></span>

## 產品角色 {#product-roles}

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

Identity 的組織管理員（`admin`）可管理成員和授權；產品角色是另一層權限。同一人在三個產品可以有不同角色或範圍。Agent 使用各自獨立且受資源範圍限制的身分；不能用一個產品的權限推導另一個產品的存取權。

<span id="設定企業-oidc"></span>
<span id="设置企业-oidc"></span>

## 設定企業 OIDC {#configure-enterprise-oidc}

1. 以管理員登入該環境，開啟「帳號與安全性 → 企業 SSO」。
2. 在企業 IdP 建立機密用戶端類型的 OIDC Web 應用程式，啟用 Authorization Code 與 PKCE S256。
3. 將 Ordivant 介面顯示的完整 `Callback URL` 註冊為 `Redirect URI`，不可使用萬用字元。
4. 輸入該組織的 `Issuer`、`Client ID`、`Client Secret`、允許網域與成員佈建政策；需要群組時，設定 IdP 的 `groups` claim 及明確的產品／範圍對應。
5. 儲存後執行連線測試，再以一般成員測試登入、產品存取及登出。確認管理員復原路徑可用後，才考慮啟用 `SSO-only`。

成員依受邀或明確設定的 JIT 政策加入；相同電子郵件網域本身不會授予全組織權限。`Client Secret` 會加密保存，表單不會回填明文。直接 OIDC 是登入協定；若企業只提供 SAML 或 LDAP／Active Directory，可選擇 Keycloak broker。詳細設定與互動式初始化要求見[企業登入說明](../enterprise-sso.md)。目前尚未提供 SCIM 佈建功能。

<span id="agent-與模型連線"></span>
<span id="agent-与模型连接"></span>

## Agent 與模型連線 {#agents-and-model-connections}

模型連線由組織管理員設定端點、模型 ID 和 Provider API 金鑰，再選擇使用組織預設值或為 Agent 個別設定。Runtime 只會取得該次執行所需且受範圍限制的設定；使用者的瀏覽器不會收到 Runtime／API 機密憑證。工具連線 token 僅能寫入、不能讀回，並會加密保存。詳見[執行使用指南](../execution-usage.md)。

正式環境使用前，請檢查 TLS、可信任的網站來源（Origin）、允許的成員佈建策略、Project／Space 授權範圍，以及復原碼的保管方式。SSO 不會取代各產品的伺服器端授權。
