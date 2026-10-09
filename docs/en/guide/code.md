# Ordivant Code

Use Ordivant Code to manage repository branches, file changes, commits, and pull requests. Gitea stores the Git history and PRs; Code shows the change context and status.

![Code pull request for changes in a real demonstration repository](/screenshots/code-en.png)

<span id="啟用-gitea"></span>
<span id="激活-gitea"></span>

## Enable Gitea {#enable-gitea}

Gitea is optional. If it is not enabled, Code cannot create or update repositories, branches, commits, pull requests, or statuses. Ask your deployment administrator to enable Gitea using the [container deployment guide](../containers.md).

<span id="repository-到-pr"></span>

## From repository to pull request {#from-repository-to-pull-request}

1. Select a Code project you are authorized to use. A **Manager** can create and manage projects; contact an administrator if you cannot find the project you need.
2. A **Writer** can create a private repository in the project or select an existing repository.
3. Choose a source branch and create a working branch. Add or update files on that branch, then enter a clear commit message and commit the changes.
4. Open a PR by choosing the head and base branches and entering a title and description. Attach a Work, Knowledge, or external reference so reviewers can understand the context.
5. Review the changes, references, status, and review progress in the PR details. Follow your organization's Gitea process to review and merge; opening a PR does not automatically approve a Work task.

Code project roles determine what you can do: **Manager** manages the project, **Writer** creates repositories, branches, commits, and PRs in authorized projects, and **Reader** views project data. A source reference describes a work relationship; it does not grant access to Work, Knowledge, or another system.

<span id="pr-狀態與證據"></span>
<span id="pr-状态与证据"></span>

## PR status and evidence {#pr-status-and-evidence}

**Report status** can mark a commit as pending, success, failure, or error. A status labeled `agent_reported` means an Agent reported the result; it does not mean a test actually ran. `gitea_webhook` means the status came from a Gitea webhook. To confirm what ran and its result, open the corresponding check in Gitea.

PR status helps track work, but it does not replace actual testing, Gitea review, or the merge process.
