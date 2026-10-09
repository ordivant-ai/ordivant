<span id="管理員、角色與企業登入"></span>
<span id="管理员、角色与企业登录"></span>

# 管理员、角色与企业登录 {#administrators-roles-and-enterprise-sign-in}

Ordivant 的浏览器登录由共用 Identity 服务提供；Work、Knowledge、Code 各自检查产品角色和资源范围。SSO 登录成功只创建用户的平台会话，不会直接授予 Agent token、Runtime 身份或 Gitea 凭证。

<span id="初始管理員與成員"></span>
<span id="初始管理员与成员"></span>

## 初始管理员与成员 {#first-administrator-and-members}

每个 Compose 项目／环境都有自己的 Identity 数据。第一次打开 Web 时，请为该环境创建第一位管理员；系统没有预设用户账号。管理员可邀请成员、禁用账号、撤销会话，并授予产品角色，以及 Work Project、Knowledge Space、Code Project 的明确资源范围。

管理员需安全地将一次性邀请码提供给受邀成员；邀请码会过期，本地脚本不会发送邮件。普通成员只能查看明确授权的资源。创建新的 Project 或 Space 由管理员负责。密码恢复使用登录时设置的恢复码；目前不提供未实现的电子邮件重置流程。

<span id="產品角色"></span>
<span id="产品角色"></span>

## 产品角色 {#product-roles}

| 产品 | 角色 | 主要权限 |
|---|---|---|
| Work | Manager | 管理已授权项目的工作与运行安排 |
| Work | Worker | 运行获授权任务并提交成果 |
| Work | Reviewer | 独立审查成果；不可接受自己的提交 |
| Knowledge | Manager | 管理已授权 Space 内的文档和决策；添加 Space 由 Identity 管理员创建 |
| Knowledge | Writer | 创建文档、发布新版本、记录决策 |
| Knowledge | Reader | 搜索与阅读已授权 Space |
| Code | Manager | 管理已授权 Code Project |
| Code | Writer | 在已授权 Project 创建 repository 及变更 |
| Code | Reader | 查阅 Project、repository、PR 和状态收据 |

Identity 的组织管理员（`admin`）可管理成员和授权；产品角色是另一层权限。同一人在三个产品可以有不同角色或范围。Agent 使用各自独立且受资源范围限制的身份；不能用一个产品的权限推导另一个产品的访问权。

<span id="設定企業-oidc"></span>
<span id="设置企业-oidc"></span>

## 设置企业 OIDC {#configure-enterprise-oidc}

1. 以管理员登录该环境，打开「账号与安全性 → 企业 SSO」。
2. 在企业 IdP 创建机密客户端类型的 OIDC Web 应用，启用 Authorization Code 与 PKCE S256。
3. 将 Ordivant 界面显示的完整 `Callback URL` 注册为 `Redirect URI`，不可使用通配符。
4. 输入该组织的 `Issuer`、`Client ID`、`Client Secret`、允许网域与成员布建政策；需要群组时，设置 IdP 的 `groups` claim 及明确的产品／范围对应。
5. 保存后运行连接测试，再以普通成员测试登录、产品访问及注销。确认管理员恢复路径可用后，才考虑启用 `SSO-only`。

成员依据受邀或明确设置的 JIT 政策加入；相同电子邮件网域本身不会授予全组织权限。`Client Secret` 会加密保存，表单不会回填明文。直接 OIDC 是登录协议；若企业只提供 SAML 或 LDAP／Active Directory，可选择 Keycloak broker。详细设置与交互式初始化要求见[企业登录说明](../enterprise-sso.md)。目前尚未提供 SCIM 布建功能。

<span id="agent-與模型連線"></span>
<span id="agent-与模型连接"></span>

## Agent 与模型连接 {#agents-and-model-connections}

模型连接由组织管理员设置端点、模型 ID 和 Provider API 密钥，再选择使用组织预设值或为 Agent 单独设置。Runtime 只会取得该次运行所需且受范围限制的设置；用户浏览器不会收到 Runtime／API 机密凭证。工具连接 token 仅能写入、不能读回，并会加密保存。详见[运行使用指南](../execution-usage.md)。

正式环境使用前，请检查 TLS、可信任的网站来源（Origin）、允许的成员布建策略、Project／Space 授权范围，以及恢复码的保管方式。SSO 不会取代各产品的服务器端授权。
