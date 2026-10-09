# Ordivant Code

Code binds a scoped Code Project to a real Gitea repository. It provides interfaces for creating repositories and branches, committing files, opening pull requests, and recording status receipts. Gitea stores the actual Git and PR state; the Code service stores authorization scopes, references, and operation receipts.

<span id="啟用-gitea"></span>
<span id="激活-gitea"></span>

## Enable Gitea

Gitea is optional. Without it, the Code API can still start and show saved metadata, but upstream write operations for repositories, branches, commits, pull requests, and statuses are unavailable.

Enable it when starting a new development environment:

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithGitea
```

If the three-product environment is already running under the same ProjectName, rerun the helper with `-WithGitea`; do not seed again. On Linux, PowerShell 7 uses `./scripts/containers.ps1`. The helper creates Gitea service credentials in an ignored local secret directory. Do not print, commit, or copy them manually into Agent settings.

<span id="repository-到-pr"></span>

## From repository to pull request

1. Select an authorized Code Project. A manager can create a project; ask an Identity administrator for access if you are not authorized.
2. A user with write access creates a private repository. Code binds the repository to the selected project.
3. Select the repository and create a branch from a source branch. Then select a branch and commit UTF-8 file contents with a commit message. Updates to existing files are guarded by their current version.
4. Open a PR with the head branch, base branch, title, and description. Use “Work / Knowledge / External source” to attach provenance, such as a verified Knowledge version URI.
5. Review the head SHA, state, source references, and status receipts in the PR details. Review and merge still follow your organization's Gitea process; Ordivant does not automatically approve a Work task.

Code permissions are scoped to a Code Project: **Manager** creates and manages projects, **Writer** operates repositories in authorized projects, and **Reader** inspects their data. The Gitea service credential is never returned to the browser. Code checks the project scope on every operation.

<span id="pr-狀態與證據"></span>
<span id="pr-状态与证据"></span>

## PR status and evidence

“Report status” sends pending, success, failure, or error for a selected commit to Gitea. Such receipts are marked `agent_reported`; they do not mean that a CI runner actually ran tests. A valid Gitea webhook receipt is marked `gitea_webhook`. This release does not include a CI runner, so state the source of a status and whether a test really ran.

PR references provide provenance; they do not grant Code users access to Work, Knowledge, or external systems. Work can independently read PR and check states from configured existing VCS providers without enabling Code. See the [architecture and API reference](../reference.md) for the boundary between them.
