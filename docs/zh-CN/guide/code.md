# Ordivant Code

Code 将有范围的 Code Project 绑定到实际 Gitea repository，提供创建 repository、branch、文件 commit、Pull Request 及状态收据的界面。Git 与 PR 的实际状态由 Gitea 保存；Code 服务保留授权范围、引用和操作收据。

<span id="啟用-gitea"></span>
<span id="激活-gitea"></span>

## 激活 Gitea {#enable-gitea}

Gitea 是可选服务。没有 Gitea 时 Code API 仍可启动并查看已保存的中继数据，但需要上游写入的 repository、branch、commit、PR 和 status 操作会不可用。

新开发环境可一次激活：

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithGitea
```

若已先启动相同 ProjectName 的三产品环境，可只加 `-WithGitea` 重跑 helper，不要重新 seed。Linux PowerShell 7 使用 `./scripts/containers.ps1`。Gitea service credential 由 helper 创建并留在 ignored local secret directory；不要打印、提交或手动拷贝到 Agent 设置。

<span id="repository-到-pr"></span>

## Repository 到 PR {#from-repository-to-pull-request}

1. 选择已授权的 Code Project。具管理权者可以创建新 Project；若尚无访问权，请 Identity 管理员授权。
2. 由具 write 权限的人创建 Private repository。Code 将 repository 绑定到所选 Project。
3. 选取 repository 后创建 branch，选择来源 branch；再选 branch，提交 UTF-8 文件内容与 commit message。修改既有文件时会依现有版本保护更新。
4. 创建 PR，填入 head branch、base branch、标题与描述。使用「Work / Knowledge / 外部来源」加入来源引用，例如核对过的 Knowledge 精确版本 URI。
5. 在 PR 详情查看 head SHA、state、来源引用与状态收据。PR 的评审／合并仍依组织的 Gitea 流程处理；Ordivant 不会自动批准 Work 任务。

Code 权限以 Code Project 为范围：**Manager** 创建及管理 Project，**Writer** 在已授权 Project 操作 repository，**Reader** 查阅数据。Gitea service credential 不会回传到浏览器，Code 仍会在每个操作检查平台端 Project scope。

<span id="pr-狀態與證據"></span>
<span id="pr-状态与证据"></span>

## PR 状态与证据 {#pr-status-and-evidence}

「回报状态」可把指定 commit 的 pending、success、failure 或 error 回报到 Gitea。这类收据明确标记为 `agent_reported`，不代表实际 CI runner 运行过测试。有效的 Gitea webhook 收据会标记为 `gitea_webhook`。此套件目前不包含 CI runner；请在描述中说清楚状态来源与测试实际运行情况。

PR 来源引用是 provenance，不会使 Code 用户自动取得 Work、Knowledge 或外部系统权限。Work 可独立连接既有 VCS 读取 PR 状态，不必先激活 Code；两者的边界见[架构与 API 索引](../reference.md)。
