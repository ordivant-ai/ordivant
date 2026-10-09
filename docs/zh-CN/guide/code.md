# Ordivant Code

使用 Ordivant Code 管理项目 repository 的分支、文件变更、commit 和 Pull Request。Git 历史与 PR 由 Gitea 保存；Code 页面可查看变更来源和状态。

![Code 合并请求：查看实际示范仓库的代码变更](/screenshots/code-zh-CN.png)

<span id="啟用-gitea"></span>
<span id="激活-gitea"></span>

## 启用 Gitea {#enable-gitea}

Gitea 是可选服务。若尚未启用，Code 无法创建或更新 repository、branch、commit、Pull Request 和状态。请联系部署管理员，按照[容器部署指南](../containers.md)启用 Gitea。

<span id="repository-到-pr"></span>

## 从 Repository 创建 PR {#from-repository-to-pull-request}

1. 在 Code 选择有权限的项目。Manager 可以创建和管理项目；如果列表中没有需要的项目，请联系管理员。
2. 有 Writer 权限的成员可以在项目中创建 private repository，或选择已有 repository。
3. 选择来源 branch 并创建工作 branch；在 branch 中新增或更新文件，输入清楚的 commit message 后提交变更。
4. 创建 PR，选择 head branch 和 base branch，填写标题与说明。可以附上 Work、Knowledge 或外部来源，方便审查者了解变更背景。
5. 在 PR 详情查看变更、来源、状态与审查进度。按照组织的 Gitea 流程审查和合并；创建 PR 不会自动核准 Work 任务。

Code 项目中的角色决定可用操作：**Manager** 管理项目，**Writer** 在已授权项目中创建 repository、branch、commit 和 PR，**Reader** 查看项目数据。添加来源引用只说明工作关联，不会自动授予 Work、Knowledge 或其他系统的访问权。

<span id="pr-狀態與證據"></span>
<span id="pr-状态与证据"></span>

## PR 状态与证据 {#pr-status-and-evidence}

「回报状态」可以将指定 commit 标记为 pending、success、failure 或 error。状态标记为 `agent_reported` 表示 Agent 回报了结果，不代表测试真的运行过。`gitea_webhook` 表示状态来自 Gitea webhook；要确认测试内容和结果，请打开 Gitea 中对应的检查记录。

PR 状态可以帮助跟踪工作，但不能替代实际测试、Gitea 审查或合并流程。
