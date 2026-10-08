# 架構與 API 索引

## 業務契約

| 文件 | 內容 |
| --- | --- |
| [Work contracts](./contracts.md) | 任務狀態、租約、fencing、scope、冪等、獨立 review |
| [Suite contracts](./suite-contracts.md) | 產品邊界、Knowledge 版本、Code/Gitea、跨產品來源 |
| [執行契約](./execution-contracts.md) | Run control/sync、Agent 範本、workflow、MCP、沙箱 |
| [登入契約](./auth-contracts.md) | 帳號、session、邀請、復原與 bridge |
| [SSO 契約](./sso-contracts.md) | OIDC、安全驗證、企業群組與 IdP broker |
| [模型契約](./model-contracts.md) | Provider、Agent 選模、加密及用量收據 |

## REST 文件

原生開發啟動後，FastAPI 的 `/docs` 與 `/openapi.json` 提供即時 schema。預設 Work、Knowledge、Code、Identity 分別使用 8000、8010、8020、8030。production 的 Nginx 公開業務 API 前綴，不應為了查 schema 而對外公開內部 API 埠。

## MCP

Work／Knowledge／Code 的 MCP stdio bridge 呼叫各自 REST API，使用各自受限的 Agent token。Mutation 的 `request_id` 映射至 `Idempotency-Key`；呼叫者不能在 body 偽造 actor。啟動範例見[容器文件](./containers.md)，依產品使用 `ordivant.mcp_server`、`ordivant_knowledge.mcp_server` 或 `ordivant_code.mcp_server`。

Runtime 的外部工具連線使用 MCP Streamable HTTP，與產品向外提供的 stdio bridge 是兩個方向。詳見[外部工具指南](./execution-usage.md#外部-mcp-工具)。

## 原始碼與開發

[GitHub 原始碼](https://github.com/bigtongue5566/ordivant)、[貢獻指南](../CONTRIBUTING.md)、[產品部署獨立性](./product-independence.md)、[驗收紀錄](./validation.md)。文件中指向程式碼的連結會前往 GitHub，文件站不包含伺服器資料、金鑰或驗收資料庫。
