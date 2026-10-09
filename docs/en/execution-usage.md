<span id="執行、範本、自動流程與工具環境"></span>
<span id="运行、模板、自动流程与工具环境"></span>

# Runs, Templates, Workflows, and Tool Environments

Run execution, Agent templates, workflows, and tool connections are managed by **Work**. Knowledge and Code remain independently usable and do not require a sandbox. See the [architecture and API reference](reference.md#work-api) for API and authorization rules.

To get started, sign in to Work. An administrator configures the API endpoint, key, and default model under **Model connections**. Then create any required tool connections or sandbox profiles and Agents, and manually dispatch a task or start a workflow. Existing organization model settings can be reused. Runs are explicitly marked DEMO when no valid model is configured.

<span id="啟動"></span>
<span id="启动"></span>

## Start

Use the following Compose commands for development or a standard deployment:

```powershell
# Development mode with hot reload and the isolated executor.
.\scripts\containers.ps1 -Development -WithRuntime -WithSandbox

# Deployment images with local Nginx and PostgreSQL.
.\scripts\containers.ps1 -WithRuntime -WithSandbox
```

For a new demo environment, add `-Seed`. It creates business data marked DEMO; the user still creates the administrator account in the browser. Add `-WithGitea` for Code's local forge. Development and production each keep their own data and accounts. The sandbox API does not publish a host port and accepts requests only from the internal runtime network.

<span id="run-執行控制台"></span>
<span id="run-运行控制台"></span>

## Run console

1. Select a project and dispatch a Pi Agent from a task. A queued Run appears immediately.
2. Open **Runs** to inspect the task, Agent, execution, status, and model snapshot. Select a Run to view events, tool results, and the observed token receipt.
3. Administrators and project managers can request pause, resume, stop, or retry. Other members can inspect projects they are authorized to access.

Pause is cooperative: the Run waits before its next tool operation, while a model or tool call already in progress may finish. The UI distinguishes a pending pause request from a Run that has actually reached the paused state. Pi does not expose an API for immediately freezing a model request. The dispatcher continues renewing the lease while paused, and the global Run timeout still applies. Resume opens the gate for the same execution. After a restart, the service restores a Run only when its original execution lease is still valid; an expired or lost lease fails closed and requires a new dispatch. External side effects with an uncertain outcome are never replayed automatically.

Stop immediately fences the business execution's write access, then terminates the model and sandbox; the task returns to `ready`. Check the remote service's result if an already-started external tool may have caused a side effect. Stopping a Run does not delete its evidence. A failed or stopped Run can be retried, creating a new Run and execution with a link to its source. Retry does not reopen a task that has already been accepted.

Run status `done` means model execution and submission have completed; the task is done only after an independent reviewer accepts it. DEMO does not call a paid model. A live receipt reports the model and usage actually returned. Unknown token usage or USD cost remains unknown.

<span id="agent-範本"></span>
<span id="agent-模板"></span>

## Agent templates

Under **Automation → Agent templates**, define the role, capabilities, instructions, model, tool allowlist, sandbox, and execution limits. Each change publishes a new immutable version. When creating or editing an Agent, select an exact version and optionally override individual settings. Changes take effect on its next dispatch.

Previous template versions and dispatched Run snapshots remain traceable. Templates do not grant project access: the Agent must already be authorized for the project containing the tool connection and sandbox. Organization administrators continue to manage model connections; templates never store API keys.

<span id="自動工作流程"></span>
<span id="自动工作流程"></span>

## Automated workflows

Under **Automation → Workflows**, define steps and their dependencies. Each step can name a Pi Agent or required capabilities, and may name an independent reviewer. Steps can run in parallel, but dependencies must form an acyclic graph.

Provide text input for the whole workflow when starting it manually. The system creates a task for each step, and the runtime scheduler dispatches eligible work. A step waits if no suitable Agent is available or a dependency is still awaiting review. Once a reviewer accepts the prerequisite result, dependent steps start automatically. The workflow completes only after every step passes independent acceptance.

Scheduled starts use a minute interval and a maximum run count; the runtime must remain running. An active workflow prevents an overlapping start on the same schedule. Missed intervals during downtime are not replayed. Cancelling a workflow stops unfinished tasks and Runs while preserving accepted results. Publishing a new workflow version does not change instances already started.

<span id="外部-mcp-工具"></span>

## External MCP tools

The deployment operator first allowlists the trusted MCP server host. A Work administrator can then add a project connection under **Tools and sandboxes**. The first release uses MCP Streamable HTTP and does not launch arbitrary host processes over stdio.

```powershell
$env:ORDIVANT_TOOL_ALLOWED_HOSTS = 'mcp.company.example'
.\scripts\containers.ps1 -Development -WithRuntime -WithSandbox
```

Enter an HTTPS MCP endpoint, a write-only bearer token, and the allowed tool names, then select **Test connection** to fetch a real `tools/list` response. HTTP is only for explicitly configured private or local test services and also requires `ORDIVANT_TOOL_HTTP_HOSTS`. In every mode, hosts resolving to private, loopback, or other non-public addresses must also appear in `ORDIVANT_TOOL_PRIVATE_HOSTS`. Private HTTPS services still need a valid TLS certificate. No external hosts are allowed by default. URLs cannot contain credentials, and redirects cannot forward authentication to another service.

Connection credentials are encrypted and never returned to the form; leaving the field blank preserves the existing key. Changing an authenticated endpoint requires entering a new key. An Agent receives only tools allowed for its execution project, with namespaced tool names. External operations are not replayed automatically; uncertain side effects are neither reported as success nor repeated automatically.

Bearer authentication is supported. Vendor-specific interactive MCP OAuth, stdio launchers, and remote A2A are not supported yet.

<span id="沙箱"></span>

## Sandboxes

An administrator creates a project sandbox profile with limits for command time, memory, CPU, process count, output bytes, and workspace size, then assigns it to an Agent. Dispatch stores an immutable profile snapshot. Runtime exposes sandbox tools to read and write files, list files, and execute argv commands.

Each Run receives its own container and size-limited memory workspace. Jobs run as non-root with a read-only root filesystem, no network, no host directories, and no provider, tool, or platform credentials. The fixed image includes Python, Node.js, and Git for running programs and tests with the dependencies already in the image. Because networking is disabled, deployment operators must add required packages to the fixed job image in advance or write authorized files into the workspace. Arbitrary Git cloning and online package installation are not currently supported.

Failed commands retain their non-zero exit code, and timeouts or truncated output are marked explicitly. File tools accept only relative workspace paths and reject traversal and symlink escapes. Submit result files and test output as evidence before the Run ends. The workspace is removed when a Run completes, stops, or reaches its global timeout; after restart the executor cleans up orphaned jobs it owns. A command timeout terminates that command's process group and returns an explicit result. The workspace is not persistent file storage.

If the cleanup API does not confirm deletion, the console shows the sandbox as `failed` with an unconfirmed-cleanup error. If a temporary workspace becomes unreachable after restart, its status is `lost`. Model results and cleanup status are recorded separately. The operator must inspect or restart their executor to complete orphan cleanup; an unconfirmed deletion is never reported as successful, and model side effects are never replayed automatically.

Only the separately trusted `sandbox-api` service holds the Docker daemon socket. Work, Runtime, the browser, and sandbox jobs do not. The deployment operator controls the executor's internal network and service credentials. Docker isolation shares the host kernel; organizations requiring a VM boundary should connect a VM or microVM executor.

<span id="隔離驗收"></span>

## Validate runs in your project {#isolated-acceptance}

Run a low-risk task in your project and confirm that its Run moves from queued to execution and submission. Have a different authorized member review the result independently. DEMO validates the product workflow but does not call a paid model. When using a configured model connection, first confirm the provider, model, and spending policy.

For a tool connection, use **Test connection** to confirm the allowed tool list, then dispatch a task that only reads data or creates test data that can be safely removed. Check the actual side effect in the upstream service. Stopping a Run does not undo an operation already completed by an external service, and uncertain operations are not replayed automatically.

If the Agent uses a sandbox, confirm that files and command results have been submitted as evidence before the Run ends, and that the workspace is cleaned up afterward. If the sandbox API cannot confirm deletion, the console reports unconfirmed cleanup; the deployment operator should inspect the executor they manage. Docker isolation shares the host kernel. Connect a VM or microVM executor when a VM boundary is required.
