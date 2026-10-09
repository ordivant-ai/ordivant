<span id="架構與-api-索引"></span>
<span id="架构与-api-索引"></span>

# 架構與 API 索引 {#architecture-and-api-reference}

<span id="業務契約"></span>
<span id="业务契约"></span>

## 業務契約 {#business-contracts}

| 文件 | 內容 |
| --- | --- |
| [Work 契約](./contracts.md) | 任務狀態、租約、fencing token、授權範圍、冪等性、獨立審查 |
| [Suite 契約](./suite-contracts.md) | 產品界線、Knowledge 版本、Code／Gitea、跨產品來源追溯 |
| [執行契約](./execution-contracts.md) | Run 控制／同步、Agent 範本、工作流程、MCP、沙箱 |
| [登入契約](./auth-contracts.md) | 帳號、工作階段、邀請、復原與橋接程序 |
| [SSO 契約](./sso-contracts.md) | OIDC、安全驗證、企業群組與 IdP broker |
| [模型契約](./model-contracts.md) | 模型供應商、Agent 選模、加密及用量收據 |

<span id="rest-文件"></span>
<span id="rest-文档"></span>

## REST 文件 {#rest-documentation}

原生開發模式啟動後，FastAPI 的 `/docs` 與 `/openapi.json` 會提供即時 API 結構描述。Work、Knowledge、Code、Identity 預設分別使用連接埠 8000、8010、8020、8030。正式環境的 Nginx 只公開業務 API 前綴；不要為了查看結構描述而對外公開內部 API 連接埠。

## MCP

Work／Knowledge／Code 的 MCP stdio 橋接程序會呼叫各自的 REST API，並使用各自受範圍限制的 Agent token。變更操作中的 `request_id` 會對應至 `Idempotency-Key`；呼叫者不能在請求本文偽造 `actor`。啟動範例見[容器文件](./containers.md)，依產品使用 `ordivant.mcp_server`、`ordivant_knowledge.mcp_server` 或 `ordivant_code.mcp_server`。

Runtime 連接外部工具時使用 MCP Streamable HTTP；這與各產品透過 stdio 橋接程序向外提供 MCP 的方向相反。詳見[外部工具指南](./execution-usage.md#外部-mcp-工具)。

<span id="原始碼與開發"></span>
<span id="源代码与开发"></span>

## 原始碼與開發 {#source-and-development}

[GitHub 原始碼](https://github.com/ordivant-ai/ordivant)、[貢獻指南](../CONTRIBUTING.md)、[產品獨立部署](./product-independence.md)、[驗收紀錄](./validation.md)。文件中的程式碼連結會前往 GitHub；文件站不包含伺服器資料、金鑰或驗收資料庫。
