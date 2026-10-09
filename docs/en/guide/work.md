# Ordivant Work

Work organizes projects, tasks, Agent execution, messages, result evidence, and independent review. A Task is business work; a Run or Execution is one actual attempt. Execution completion does not automatically complete the Task: an authorized reviewer other than the submitter must accept the result.

![Work task list: follow demonstration tasks by status](/screenshots/work-en.png)

<span id="建立專案與任務"></span>
<span id="创建项目与任务"></span>

## Create projects and tasks

1. An Identity administrator creates a Project in Work and grants members access to it. Members see only their authorized scope.
2. In the Project's “Tasks” view, create a Task and enter its goal, description, inputs, scope, constraints, acceptance criteria, and priority.
3. Choose an execution Agent with the required capabilities and access to this Project, then assign a different reviewer. Add prerequisite Tasks as dependencies when needed. Cycles are rejected. A dependent Task can start only after its prerequisites pass independent review.
4. Save and search the task list or filter it by status. Editing the task specification does not replace saved execution or review history.

<span id="執行並提交證據"></span>
<span id="运行并提交证据"></span>

## Execute and submit evidence

Each Agent attempt has its own execution record. Automatic execution requires an administrator to enable the Agent execution service first. You can still arrange tasks, submit results, and review them manually without it. See [Runs and automation](../execution-usage.md) for dispatching.

After the work is complete, the executor submits a summary and one or more results, such as text, an Artifact URI, or a file/test-result reference. Submission moves the Task into review and preserves the Run's events and receipt. Explain how the evidence meets the acceptance criteria. “Run done” means only that execution was submitted; it does not mean the Task was accepted.

The reviewer checks the summary and evidence in the Task details, then accepts or returns it with a comment. Acceptance completes the Task. Returning it makes it executable again and preserves prior evidence. A submitter cannot accept their own result. When a Task is rejected or retried, its new Execution does not overwrite the previous history.

<span id="協作與引用"></span>
<span id="协作与引用"></span>

## Collaboration and citations

Use messages in the Task context to ask another member or Agent a question, reply, hand off work, or record a decision. A Project manager or the Agent responsible for a parent Task can delegate a child Task; delegation does not grant the delegate access to other Projects.

When work depends on a Knowledge document, put its **exact-version citation URI** in Task inputs or submitted evidence, retaining the version number. A citation records the source but does not authorize readers in the Knowledge Space; members who need the original document must be granted access separately. See the [Knowledge guide](knowledge.md) for the citation format and workflow.

Work can also read pull-request and check states from configured existing GitHub, GitLab, or Gitea providers. This is scoped read access and evidence inspection; it does not merge pull requests or replace independent review. See the [Code guide](code.md) for repositories and pull requests managed through Gitea in Code.

<span id="run-控制"></span>

## Run controls

Use “Run execution” to view each attempt's status, events, and usage. Administrators and project managers can pause, resume, stop, or retry. Pause takes effect before the next tool operation and keeps the task assigned. After stopping, that attempt cannot update the task. Retry creates a new Run. Stopping does not undo completed external operations; check their results before retrying.

See the [execution guide](../execution-usage.md) for Run states, waiting and stop semantics, sandbox configuration, and tools. External side effects from tools are not automatically replayed on retry; verify uncertain outcomes with the upstream service first.

<span id="權限概覽"></span>
<span id="权限概览"></span>

## Permissions overview

- **Manager:** manages tasks and execution schedules in authorized Projects.
- **Worker:** performs authorized work and submits results.
- **Reviewer:** reviews submissions and cannot accept their own.

Organization administrators create Projects, invite members, and grant product roles. Work access is based on Project scope and manager, worker, or reviewer identity; there is no separate Work Reader role. A human sign-in session does not become an Agent or Runtime credential.
