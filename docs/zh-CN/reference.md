<span id="架構與-api-索引"></span>
<span id="架构与-api-索引"></span>

# 架构与 API 索引 {#architecture-and-api-reference}

<span id="業務契約"></span>
<span id="业务契约"></span>

## 业务契约 {#business-contracts}

| 文档 | 内容 |
| --- | --- |
| [Work 契约](./contracts.md) | 任务状态、租约、fencing token、授权范围、幂等性、独立审查 |
| [Suite 契约](./suite-contracts.md) | 产品边界、Knowledge 版本、Code／Gitea、跨产品来源追溯 |
| [运行契约](./execution-contracts.md) | Run 控制／同步、Agent 模板、工作流程、MCP、沙箱 |
| [登录契约](./auth-contracts.md) | 账号、会话、邀请、恢复与桥接程序 |
| [SSO 契约](./sso-contracts.md) | OIDC、安全验证、企业群组与 IdP broker |
| [模型契约](./model-contracts.md) | 模型供应商、Agent 选模、加密及用量收据 |

<span id="rest-文件"></span>
<span id="rest-文档"></span>

## REST 文档 {#rest-documentation}

原生开发模式启动后，FastAPI 的 `/docs` 与 `/openapi.json` 会提供实时 API 结构描述。Work、Knowledge、Code、Identity 预设分别使用端口 8000、8010、8020、8030。生产环境的 Nginx 只公开业务 API 前缀；不要为了查看结构描述而对外公开内部 API 端口。

## MCP

Work／Knowledge／Code 的 MCP stdio 桥接程序会调用各自的 REST API，并使用各自受范围限制的 Agent token。变更操作中的 `request_id` 会对应至 `Idempotency-Key`；调用者不能在请求正文伪造 `actor`。启动示例见[容器文档](./containers.md)，依产品使用 `ordivant.mcp_server`、`ordivant_knowledge.mcp_server` 或 `ordivant_code.mcp_server`。

Runtime 连接外部工具时使用 MCP Streamable HTTP；这与各产品通过 stdio 桥接程序向外提供 MCP 的方向相反。详见[外部工具指南](./execution-usage.md#外部-mcp-工具)。

<span id="原始碼與開發"></span>
<span id="源代码与开发"></span>

## 源代码与开发 {#source-and-development}

[GitHub 源代码](https://github.com/ordivant-ai/ordivant)、[贡献指南](../../CONTRIBUTING.md)、[产品独立部署](./product-independence.md)、[验收记录](./validation.md)。文档中的代码链接会前往 GitHub；文档站不包含服务器数据、密钥或验收数据库。
