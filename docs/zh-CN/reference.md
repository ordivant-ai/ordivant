# 架构与 API 索引

## 业务契约

| 文档 | 内容 |
| --- | --- |
| [Work contracts](./contracts.md) | 任务状态、租约、fencing、scope、幂等、独立 review |
| [Suite contracts](./suite-contracts.md) | 产品边界、Knowledge 版本、Code/Gitea、跨产品来源 |
| [运行契约](./execution-contracts.md) | Run control/sync、Agent 模板、workflow、MCP、沙箱 |
| [登录契约](./auth-contracts.md) | 账号、session、邀请、复原与 bridge |
| [SSO 契约](./sso-contracts.md) | OIDC、安全验证、企业群组与 IdP broker |
| [模型契约](./model-contracts.md) | Provider、Agent 选模、加密及用量收据 |

## REST 文档

原生开发启动后，FastAPI 的 `/docs` 与 `/openapi.json` 提供实时 schema。预设 Work、Knowledge、Code、Identity 分别使用 8000、8010、8020、8030。production 的 Nginx 公开业务 API 前缀，不应为了查 schema 而对外公开内部 API 端口。

## MCP

Work／Knowledge／Code 的 MCP stdio bridge 调用各自 REST API，使用各自受限的 Agent token。Mutation 的 `request_id` 映射至 `Idempotency-Key`；调用者不能在 body 伪造 actor。启动范例见[容器文档](./containers.md)，依产品使用 `ordivant.mcp_server`、`ordivant_knowledge.mcp_server` 或 `ordivant_code.mcp_server`。

Runtime 的外部工具连接使用 MCP Streamable HTTP，与产品向外提供的 stdio bridge 是两个方向。详见[外部工具指南](./execution-usage.md#外部-mcp-工具)。

## 源代码与开发

[GitHub 源代码](https://github.com/bigtongue5566/ordivant)、[贡献指南](../../CONTRIBUTING.md)、[产品部署独立性](./product-independence.md)、[验收记录](./validation.md)。文档中指向代码的链接会前往 GitHub，文档站不包含服务器数据、密钥或验收数据库。
