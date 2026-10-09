<span id="執行、範本、自動流程與工具環境"></span>
<span id="运行、模板、自动流程与工具环境"></span>

# Runs, Templates, Workflows, and Tool Environments {#runs-templates-workflows-and-tool-environments}

Work Runs can handle tasks, workflows, connected tools, and sandboxes. In Work, choose a project and task, assign an Agent, then follow its progress, results, and submitted work. See the [model connections guide](model-usage.md) for model setup and the [container deployment guide](containers.md) to enable services in a self-hosted environment.

![Run console with DEMO execution status and events](/screenshots/run-en.png)

<span id="啟動"></span>
<span id="启动"></span>

## Deployment and feature access {#start}

For an existing Work site, ask your administrator to confirm that the required execution services are enabled. Sandboxes are optional; tasks can run without them. To self-host, use the [container deployment guide](containers.md) to choose and enable services.

<span id="run-執行控制台"></span>
<span id="run-运行控制台"></span>

## Run console {#run-console}

1. Select a project you can access. In a task's details, choose a Pi execution Agent and select **Dispatch to agent** to create a Run. Manual **Claim task** does not start automatic execution.
2. Open **Run execution** to view its status, progress, tool results, and submitted work.
3. An authorized manager can request pause, resume, stop, or retry. Another authorized member can review submitted work independently.

Pause takes effect after the current model or tool operation finishes; it does not forcibly interrupt that operation. Stop ends the Run and returns an unfinished task to a state where it can be dispatched again. It does not undo an operation that an external service has already completed. Submitted work remains available after a Run ends. Retrying creates a new Run; it does not reopen a task that has already passed review.

A Run marked complete or submitted does not mean the task has been accepted. The task is complete only after an authorized independent reviewer accepts it. DEMO demonstrates the workflow and does not call a paid model. For a real model call, the Run record shows the model and usage returned by the provider. Missing usage or dollar cost remains unknown and is not a bill.

<span id="agent-範本"></span>
<span id="agent-模板"></span>

## Agent templates {#agent-templates}

Under **Automation → Agent templates**, set an Agent's role, instructions, model, available tools, sandbox, and execution limits. Editing a template creates a new version. Choose the version when creating or editing an Agent; model and tool changes apply to tasks dispatched afterward.

Templates do not grant project or tool access. An Agent must already be authorized for the project. Organization administrators manage model connections.

<span id="自動工作流程"></span>
<span id="自动工作流程"></span>

![Agent template: save role, instructions, and execution settings for reuse](/screenshots/template-en.png)

## Automated workflows {#automated-workflows}

Under **Automation → Workflows**, add steps, select an Agent or required capabilities, and define dependencies and independent reviewers. Steps without dependencies can run at the same time.

When starting a workflow manually, enter the request for that run. Work creates a task for each step. A step waits when no suitable Agent is available or its prerequisite has not passed review. Once the prerequisite is accepted, the next steps can continue. The workflow completes after every step passes review.

A schedule can set an interval and a maximum number of starts. It does not start a second workflow while one from the same schedule is still running, and it does not make up intervals missed during downtime. Cancelling a workflow stops unfinished steps but keeps accepted results. Updating a workflow does not change one that has already started.

<span id="外部-mcp-工具"></span>

![Workflow: define steps, dependencies, and acceptance criteria](/screenshots/workflow-en.png)

## External MCP tools {#external-mcp-tools}

Before a connection can be added, a deployment administrator must allow the trusted MCP server host. No external hosts are allowed by default. See the [container deployment guide](containers.md) for allowlist settings. A Work administrator can then add a project connection under **Tools and sandboxes**, enter the MCP HTTPS URL and bearer token, and choose which tool names an Agent may use. Select **Test connection** to check the available tools before assigning the connection to an Agent.

Use the provider's HTTPS URL and enter the token in its dedicated field; never put credentials or tokens in the URL. The token is stored encrypted and is not shown again; leave the field blank to keep the current token. Authentication is not forwarded to another host after a redirect. Private or local HTTP services must be explicitly listed by the deployment administrator in `ORDIVANT_TOOL_HTTP_HOSTS`. If a host resolves to a private or loopback address, it must also be listed in `ORDIVANT_TOOL_PRIVATE_HOSTS`. Private HTTPS services still need a valid TLS certificate. `ORDIVANT_TOOL_ALLOWED_HOSTS` controls which MCP hosts are allowed.

Connections currently use bearer tokens; interactive MCP OAuth is not available. External tools may change data in another service. If an operation's outcome is uncertain, Work will not automatically repeat it. Check the selected tools and their effects before dispatching a task.

<span id="沙箱"></span>

## Sandboxes {#sandboxes}

An administrator can set per-project sandbox limits for command time, memory, CPU, process count, output, and workspace size, then assign the profile to an Agent. Each Run gets its own temporary workspace and can execute commands within those limits.

A sandbox has no network access or access to host directories. It cannot download packages or clone arbitrary Git repositories online; it can use only the tools and dependencies already available in its environment. The result shows when a command fails or times out.

The workspace is removed when the Run ends, stops, or times out. Submit files and test output as work or evidence before ending the Run; the workspace is not long-term storage. If the page cannot confirm cleanup, ask your deployment administrator to inspect the execution environment. Docker sandboxes share the host kernel. Organizations that require VM-level isolation need a VM or microVM execution environment.

<span id="隔離驗收"></span>

![Tools and sandboxes: inspect the project execution profile](/screenshots/tools-en.png)

## Check a run in your project {#isolated-acceptance}

Start with a low-risk task. Confirm that its Run starts, submits results, and is independently reviewed by another authorized member. DEMO verifies the product workflow but does not call a paid model. Before using a configured model, check the provider and its spending policy.

Before using an external tool, test the connection and review the available tool list. For the first check, choose a read-only operation or create test data that can be safely removed. Verify the actual result in the upstream service. Stopping a Run does not undo completed external operations, and an uncertain operation is not repeated automatically.

For sandbox work, submit files and test results before ending the Run. Confirm that the workspace is shown as cleaned up afterward; ask your deployment administrator to investigate if cleanup is unconfirmed.
