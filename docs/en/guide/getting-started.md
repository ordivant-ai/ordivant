<span id="開始使用-ordivant"></span>
<span id="开始使用-ordivant"></span>

# Getting started with Ordivant {#getting-started-with-ordivant}

Follow a product launch checklist example from signing in and creating a task through reviewing the result. Use your team's Ordivant URL. If you are self-hosting, finish installation first and open your platform address.

<span id="準備環境"></span>
<span id="准备环境"></span>
<span id="prepare-the-environment"></span>

## Sign in and choose a language {#sign-in-and-language}

For a new installation, create the initial administrator on the first screen and save the recovery codes, then use your account to sign in. To join an existing team, select **Accept invitation** on the sign-in page, enter your invitation code, and set your password. If your organization uses single sign-on, choose the identity provider shown on the sign-in page. Ordivant has no default human account or password. If you do not have an invitation or cannot sign in, contact your administrator. See [Accounts and sign-in](../human-login.md) for other sign-in options.

After signing in, use **Interface language** to choose **Traditional Chinese** (`繁體中文`), **Simplified Chinese** (`简体中文`), or **English**. This changes the platform interface; it does not automatically translate tasks, documents, or messages written by members.

![Sign in or accept an invitation on the login page](/screenshots/login-en.png)

## Choose a workspace and project {#choose-workspace-and-project}

Choose **Work** in the product navigation, then open a project you are authorized to access from **Choose project**. We will use a product launch checklist as the example task. As the initial administrator, choose **Create project** and enter a key and name, for example LAUNCH and Product launch preparation. Other members with an empty project list should ask their administrator for access. Signing in does not grant access to every project.

<span id="複製並啟動"></span>
<span id="拷贝并启动"></span>
<span id="clone-and-start"></span>
<span id="create-task-and-review"></span>

## Create your first task {#create-first-task}

On the task page, choose **Add task** and enter **Prepare product launch checklist** as the task name. Set the goal to preparing the items that must be completed before launch, then add inputs, scope, and constraints as needed.

Under **Acceptance criteria**, list checkable results, such as covering all pre-launch items, naming an owner and current status for each item, and linking to supporting sources or evidence. Choose **Create task** to save it. You can leave the task unassigned until you select an Agent in the next step. See the [Work task and review guide](work.md) for field details.

<span id="seed-與-runtime"></span>
<span id="seed-与-runtime"></span>
<span id="seed-and-runtime"></span>
<span id="create-project-and-agent"></span>

![Task details with goal, acceptance criteria, and Pi Agent dispatch](/screenshots/task-en.png)

## Select an Agent and start a Run {#select-agent-and-run}

For automatic execution, an administrator or project manager selects an available Agent under **Select a Pi runtime agent** in the task details, then chooses **Dispatch to agent**. This creates a Run: open **Run execution** in the sidebar to follow progress, events, and results. For manual work, use **Select an execution agent** and **Claim task**; claiming does not start automatic execution. If no Agent is suitable, an administrator or a member with Agent management permission can choose **Add agent** on the Agent page, set its **Worker** role and capabilities, select **Pi Durable** under **Runtime** for automatic execution, and grant it access to the current project. If you do not have that permission, ask your administrator or project manager.

Automatic execution depends on the administrator’s configuration. To run work automatically, the administrator must enable the Agent execution service and configure a valid model connection. Until then, work can still be assigned, completed, and submitted for review manually. A Run marked **DEMO** is not a paid model call. Administrators can see the [execution and automation guide](../execution-usage.md) for details.

<span id="檢查與停止"></span>
<span id="检查与停止"></span>
<span id="check-and-stop"></span>

![Run console with DEMO execution events and submitted results](/screenshots/run-en.png)

## Submit the result for review {#submit-and-review}

For the launch checklist, the executor submits a summary and evidence such as the checklist and source links. The task enters review. A different Reviewer checks the evidence against the acceptance criteria and accepts the result or returns it for changes. The executor cannot accept their own submission. A completed Run does not mean the task is complete; the task is marked complete only after an independent review accepts it. See the [Work task and review guide](work.md) for details.

<span id="self-host"></span>

## Product overview {#product-overview}

- **Work** manages projects and tasks, assigns work to Agents, and tracks completion through evidence and independent review.
- **Knowledge** organizes versioned documents, decisions, and source citations for members to find and reference in their work.
- **Code** provides access to code repositories, commits, pull requests, and check status.

<span id="接下來"></span>
<span id="接下来"></span>

## Next steps {#next-steps}

- [Work: tasks and review](work.md)
- [Knowledge: documents, versions, and citations](knowledge.md)
- [Code: repositories and pull requests](code.md)
- [Administrators, roles, and SSO](administration.md)
- [Accounts and sign-in](../human-login.md)
