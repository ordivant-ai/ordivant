<span id="模型連線與-agent-設定"></span>
<span id="模型连接与-agent-设置"></span>

# 模型连接与 Agent 设置 {#model-connections-and-agent-settings}

模型设置属于 Work；Knowledge、Code 不需要模型连接就能使用自己的 API／MCP。开发与部署环境各有独立数据库，设置不会跨环境同步。

<span id="管理員設定全域連線"></span>
<span id="管理员设置全域连接"></span>

## 管理员设置全域连接 {#configure-a-global-connection-as-an-administrator}

1. 登录 Work，从侧栏打开「模型连接」。只有组织管理员可以管理连接。
2. 添加 Provider，填入名称、识别码、API base URL 和 API key。兼容 Responses API 的网址以 `/v1` 结尾，程序会调用其 `/responses`。
3. 添加模型的 ID、显示名称、context／output 限制及支持的 reasoning efforts。这些限制是设置值；不代表平台验证了上游的实际容量或费率。
4. 指定组织预设的 Provider、模型、推理强度和单次输出上限，保存设置。

密钥只写入 Work 服务器的加密设置。重新打开设置会显示「已设置」，不回传原始密钥；留空再保存会保留原有密钥。只改模型或 reasoning effort 不需要换 key。改 API base URL 时必须明确提供该端点使用的 key。版本冲突会要求重新加载，避免覆盖另一位管理员的变更。

<span id="建立或編輯-agent"></span>
<span id="创建或编辑-agent"></span>

## 创建或编辑 Agent {#create-or-edit-an-agent}

在「Agent 名录」添加 Agent，将 Runtime 选成 `Pi Durable`。模型设置可以选：

| 模式 | 行为 |
|---|---|
| 继承全域预设 | 新派工使用当时的组织预设，适合共同使用同一连接的 Agent |
| 个别设置 | 指定 Provider、模型、推理强度与输出上限，仍使用该 Provider 保存的 key |

编辑 Agent 也提供相同设置。改回继承会移除个别设置；Agent 名录显示实际生效的选择。已经派出的工作保留派工时的模型选择，设置变更影响下一次派工。

`External` Agent 由外部程序透过 REST／MCP 工作，平台不代替它调用模型；这种 Agent 的模型名称只是外部运行者的描述。

<span id="provider-設定範例"></span>
<span id="provider-设置范例"></span>

## Provider 设置范例 {#provider-configuration-example}

填入你的模型供应商提供的 HTTPS base URL（例如 `https://api.example.com/v1`，此为占位范例，不能直接调用），以及该供应商实际支持的 Model ID、reasoning effort 和 context/output 限制。平台没有附赠模型服务或 API key。

模型容量上限与单次输出上限是不同设置。可先用小输出上限测试；Pi adapter 的最低输出上限是 16。每次模型请求强制 `store:false`。API 兼容性、模型回传及费率仍以供应商服务为准。

开发与正式环境的连接需要各自设置；切换模型可沿用同一 Provider 已保存的 key。

<span id="執行與證據"></span>
<span id="运行与证据"></span>

## 运行与证据 {#execution-and-evidence}

创建任务、指定有项目权限的 Pi Agent 后派工。已设置连接的派工使用真实模型；未设置连接时使用清楚标示的 DEMO。模型或 API 失败会留下失败状态，不能回退成示范成功。

Pi 模型可以调用平台工具读取任务与回报进度；成果提交后进入「待验收」，必须由独立且有权限的审查者接受。模型的 token usage、上游回报 model ID、工具名称和调用次数保存在运行 receipt。模型回报的身分无法单独证明代理服务底层路由；美元费用保持未知，不能把 token usage 当成帐单。

服务健康检查的 `mode` 是未设置工作的预设行为。即使显示 `demo`，有连接的工作也可以有 `mode:live` receipt；以单次工作的 receipt 判断实际运行方式。

备份模型设置时，需一起保存 Work 数据库及 Work data volume 的 `model-settings.key`。只还原数据库而遗失加密密钥，无法解密原有 Provider key。

模型连接与派工操作说明见[执行指南](guide/work.md)及[运行与自动化指南](execution-usage.md)；API 与 runtime 边界见[模型 API](reference.md#model-settings)。目前规划中的模型功能见[产品路线图](roadmap.md)。
