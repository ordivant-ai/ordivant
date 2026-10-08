# 管理员、角色与企业登录

Ordivant 的浏览器登录由共用 Identity 服务提供；Work、Knowledge、Code 各自检查产品角色和资源范围。SSO 登录成功只创建人类平台 session，不会直接给用户 Agent token、Runtime 身分或 Gitea credential。

## 初始管理员与成员

每个 Compose project／环境有自己的 Identity 数据。第一次打开 Web 时创建该环境的第一位管理员；没有预设人类账号。管理员可邀请成员、禁用账号、撤销工作阶段，并授予产品角色及 Work Project、Knowledge Space、Code Project 的明确范围。

邀请需由管理员把一次性邀请码安全提供给受邀成员；邀请会过期，不会由本机 helper 寄出邮件。一般成员只看得到明确授权的资源。创建新 Project 或 Space 由管理员负责。密码复原使用登录时设置的复原码，没有假设性的 email reset 流程。

## 产品角色

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

组织的 Identity `admin` 可管理人员和授权；产品角色是另一层权限。同一人可以在三个产品有不同角色或范围。Agent 使用独立的 scoped identity；不能用一个产品的权限推导另一个产品的访问权。

## 设置企业 OIDC

1. 以管理员登录该环境，打开「账号与安全性 → 企业 SSO」。
2. 在企业 IdP 创建 confidential OIDC Web application，激活 Authorization Code 与 PKCE S256。
3. 将 Ordivant 画面显示的完整 Callback URL 注册为 Redirect URI，不使用通配符。
4. 输入该组织的 Issuer、Client ID、Client Secret、允许网域与成员布建政策；需要群组时设置 IdP groups claim 和明确的产品／范围对应。
5. 保存后运行连接测试，再以一般成员测试登录、产品访问及注销。确认复原管理员路径可用后，才考虑激活 SSO-only。

成员采受邀或明确设置的 JIT 政策；相同 email domain 本身不授予全组织权限。Client Secret 加密保存、表单不回填明文。直接 OIDC 是登录协定；若企业只有 SAML 或 LDAP/Active Directory，可选择 Keycloak broker，细节与交互式初始化要求见[企业登录说明](../enterprise-sso.md)。目前没有 SCIM 布建功能。

## Agent 与模型连接

模型连接由组织管理员设置 endpoint、model 与 provider key，再选择组织预设或 Agent 个别设置。Runtime 只取得运行所需的 scoped configuration；人类浏览器不会收到 Runtime/API secret。工具连接 token 也是 write-only 并加密保存，请参阅[运行使用指南](../execution-usage.md)。

正式环境使用前，检查 TLS、可信 origin、允许的成员布建策略、Project/Space scope 与复原码保存方式。SSO 并不取代每项产品的 server-side 授权。
