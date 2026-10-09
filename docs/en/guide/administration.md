<span id="管理員、角色與企業登入"></span>
<span id="管理员、角色与企业登录"></span>

# Administrators, roles, and enterprise sign-in

Browser sign-in is provided by the shared Identity service. Work, Knowledge, and Code each enforce their own product roles and resource scopes. Successful SSO sign-in creates a human platform session; it does not issue an Agent token, Runtime identity, or Gitea credential to the user.

<span id="初始管理員與成員"></span>
<span id="初始管理员与成员"></span>

## First administrator and members

Each Compose project or environment has its own Identity data. Create the first administrator for that environment when you first open the web application; there is no default human account. Administrators can invite members, disable accounts, revoke sessions, and grant product roles plus explicit Work Project, Knowledge Space, and Code Project scopes.

An administrator must securely deliver the one-time invitation code to the invited member. Invitations expire, and the local helper does not send email. Members can see only explicitly authorized resources. Administrators create new Projects and Spaces. Password recovery uses the recovery code set at sign-in; there is no assumed email reset flow.

<span id="產品角色"></span>
<span id="产品角色"></span>

## Product roles

| Product | Role | Main permissions |
|---|---|---|
| Work | Manager | Manages work and execution schedules in authorized Projects |
| Work | Worker | Runs authorized tasks and submits results |
| Work | Reviewer | Independently reviews results; cannot accept their own submission |
| Knowledge | Manager | Manages documents and decisions in authorized Spaces; only Identity administrators create Spaces |
| Knowledge | Writer | Creates documents, publishes versions, and records decisions |
| Knowledge | Reader | Searches and reads authorized Spaces |
| Code | Manager | Manages authorized Code Projects |
| Code | Writer | Creates repositories and changes in authorized Projects |
| Code | Reader | Inspects Projects, repositories, pull requests, and status receipts |

The organization's Identity `admin` manages people and grants; product roles are a separate authorization layer. A person may have different roles or scopes in each product. Agents use separate scoped identities; access to one product does not imply access to another.

<span id="設定企業-oidc"></span>
<span id="设置企业-oidc"></span>

## Configure enterprise OIDC

1. Sign in to the environment as an administrator and open “Accounts and security → Enterprise SSO.”
2. Create a confidential OIDC web application in your enterprise IdP and enable Authorization Code with PKCE S256.
3. Register the complete Callback URL shown by Ordivant as a Redirect URI. Do not use wildcards.
4. Enter the organization's Issuer, Client ID, Client Secret, allowed domains, and membership provisioning policy. To use groups, configure the IdP groups claim and explicit product/scope mappings.
5. Save, test the connection, then test a regular member's sign-in, product access, and sign-out. Confirm the administrator recovery path still works before considering SSO-only mode.

Members use invitations or an explicitly configured JIT policy; matching an email domain alone does not grant organization-wide access. The Client Secret is encrypted at rest, and forms never refill its plaintext. Direct OIDC is a sign-in protocol. Organizations with only SAML or LDAP/Active Directory can use the optional Keycloak broker; see [enterprise sign-in](../enterprise-sso.md) for details and interactive initialization requirements. SCIM provisioning is not available.

<span id="agent-與模型連線"></span>
<span id="agent-与模型连接"></span>

## Agents and model connections

Organization administrators configure providers, API URLs, keys, and models, then choose an organization default. When creating or editing an Agent, inherit that default or select another configured model. Saved keys and tool access tokens are never refilled in plaintext; enter a new value to replace one. See [model settings](../model-usage.md) and the [Run and tools guide](../execution-usage.md).

Before production use, review TLS, trusted origins, allowed membership provisioning policies, Project/Space scopes, and recovery-code storage. SSO does not replace server-side authorization in each product.
