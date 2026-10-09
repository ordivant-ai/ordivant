<span id="模型連線與-agent-設定"></span>
<span id="模型连接与-agent-设置"></span>

# Model connections and Agent settings

Model settings belong to Work. Knowledge and Code can use their own APIs/MCP without a model connection. Development and deployment environments have separate databases, and settings do not synchronize between them.

<span id="管理員設定全域連線"></span>
<span id="管理员设置全域连接"></span>

## Configure a global connection as an administrator

1. Sign in to Work and open “Model connections” in the sidebar. Only organization administrators can manage connections.
2. Add a Provider with a name, ID, API base URL, and API key. A Responses API-compatible URL ends in `/v1`; the application calls its `/responses` endpoint.
3. Add the model ID, display name, context/output limits, and supported reasoning efforts. These are configured values; they do not mean the platform has verified the provider's actual capacity or rates.
4. Choose the organization's default Provider, model, reasoning effort, and per-response output limit, then save.

Keys are written only to encrypted settings on the Work server. Reopening settings shows “Configured” without returning the original key; leaving it blank and saving preserves the current key. Changing only the model or reasoning effort does not require a new key. Changing the API base URL requires you to provide the key for that endpoint explicitly. A revision conflict prompts you to reload rather than overwrite another administrator's change.

<span id="建立或編輯-agent"></span>
<span id="创建或编辑-agent"></span>

## Create or edit an Agent

Add an Agent in “Agent directory” and select `Pi Durable` as its Runtime. Choose one of these model modes:

| Mode | Behavior |
|---|---|
| Inherit global default | Each new dispatch uses the organization's default at that time; suitable for Agents sharing one connection. |
| Agent-specific | Select the Provider, model, reasoning effort, and output limit; the saved key for that Provider is still used. |

Agent editing offers the same settings. Switching back to inheritance removes the individual selection; the Agent directory shows the effective selection. Already-dispatched work retains the model selection from dispatch time. Settings changes affect the next dispatch.

An `External` Agent works through an external program via REST/MCP. The platform does not call a model on its behalf; its model name is only a description of the external executor.

<span id="provider-設定範例"></span>
<span id="provider-设置范例"></span>

## Provider configuration example

Enter the HTTPS base URL supplied by your model provider (for example, `https://api.example.com/v1`; this is a placeholder and cannot be called directly), along with Model IDs, reasoning efforts, and context/output limits actually supported by that provider. The platform does not include a model service or API key.

The model capacity ceiling and per-response output ceiling are separate settings. Start by testing with a low output limit; the Pi adapter minimum is 16. Every model request forces `store:false`. API compatibility, model responses, and rates remain subject to the provider's service.

Connections must be configured separately in development and production. When switching models, you can reuse the key already saved for the same Provider.

<span id="執行與證據"></span>
<span id="运行与证据"></span>

## Execution and evidence

Create a task, assign a Pi Agent with Project access, and dispatch it. A dispatch with a configured connection uses the real model; without one it uses a clearly labeled DEMO. Model or API failures leave a failed status and cannot fall back to a successful demonstration.

Pi models can call platform tools to read a task and report progress. Submitted results enter “In review” and require acceptance by an authorized independent reviewer. Execution receipts retain model token usage, the model ID reported upstream, tool names, and call counts. A reported model ID alone cannot prove the provider's underlying routing; dollar cost remains unknown, and token usage is not an invoice.

The `mode` in the service health check is the default behavior for unconfigured work. Even if it says `demo`, a configured dispatch can have a `mode:live` receipt; use the individual work receipt to determine how that run executed.

When backing up model settings, preserve the Work database and `model-settings.key` from the Work data volume together. Restoring only the database without its encryption key cannot decrypt existing Provider keys.

See the [model contracts](model-contracts.md) for API and Runtime boundaries. See the [validation records](validation.md) for acceptance report locations and the scope actually completed.
