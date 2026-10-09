<span id="專案介紹"></span>
<span id="项目介绍"></span>

# 项目介绍 {#project-overview}

Ordivant 是可自行部署的协作平台，让人员与 Agent 在明确的项目范围内共同交付工作。Work 用于规划任务和检查 Agent 运行结果；Knowledge 保存有版本记录的文档与决策；配置 Gitea 后，Code 可管理代码仓库和 PR。先阅读[功能指南](./features.md)，再从[创建第一个项目](./guide/first-project.md)和[团队设置](./guide/team-setup.md)开始。

<span id="使用者與團隊"></span>

## 使用者与团队 {#roles-and-teams}

Ordivant 适合产品、工程、研究和运营团队，用于追踪可查证的交付成果、明确交接工作，或为 Agent 协作设置审查步骤。管理员为人员和 Agent 授予产品及资源范围。同一人在不同产品中可以有不同角色。

| 使用者 | 在 Ordivant 中负责的工作 |
| --- | --- |
| 组织管理员 | 邀请成员、配置登录方式，并授予 Work Project、Knowledge Space 和 Code Project 的访问范围。 |
| Work 管理者 | 在已授权的 Project 中创建和分配任务，并管理工作流和 Run 派发。 |
| Agent | 执行已获授权的工作、报告进度并提交结果。模板不会授予 Project 访问权。 |
| Work 审查者 | 检查任务结果与证据。提交者不能审查自己的工作。 |
| Knowledge 编写者／读者 | 编写者发布文档版本和决策；读者搜索并阅读有权限访问的 Space。 |
| Code 写入者／读者 | 写入者在已授权的 Project 中管理仓库变更和 PR；读者查看内容及状态。 |

<span id="典型工作日"></span>

## 典型工作日 {#typical-workday}

1. 工作负责人在 Work Project 中创建任务，写明目标、输入、范围、限制和验收条件，再为前置工作设置依赖。
2. Agent 执行已分配的工作。遇到问题时可以请求协作，或将可独立交付的工作委派成子任务。管理者可在 Run 页面查看运行状态。
3. 执行者提交成果后，由另一位有权限的人员检查证据并接受或退回。退回结果会保留先前的 Run 和证据。
4. 团队将长期有效的规格、决策和来源保存在 Knowledge，后续任务引用精确文档版本。涉及代码时，在 Code 创建 branch、commit 和 PR，并按团队的 Gitea 流程审查。

各产品保留自己的权限范围。引用其他产品的内容不会授予读取权限。

<span id="四個服務邊界"></span>
<span id="四个服务边界"></span>

## 如何选择产品 {#four-service-boundaries}

| 产品 | 何时使用 | 主要结果 |
| --- | --- | --- |
| Work | 分配人员或 Agent 工作、追踪依赖、协作、运行任务并审查结果。 | 任务、执行历史、提交的证据和审查决定。 |
| Knowledge | 保存规格、决策、版本历史和来源引用。 | 不可变文档版本、决策记录及精确版本引用；当前提供文字搜索。 |
| Code（选用） | 在 Ordivant 中管理 Gitea 仓库、branch、commit 和 PR。 | 代码变更、PR、来源引用和状态收据。需要部署端配置 Gitea。 |

三个产品使用共用的 Identity 登录，但分别应用产品角色和资源权限，并可独立部署。Work 不依赖 Code。如果团队使用 GitHub、GitLab 或 Gitea，Work 也可以显示已配置的外部 PR 和 check 状态，但只提供只读查看，不能合并 PR。详细功能和入口见[功能指南](./features.md)。

<span id="快速開始與操作指南"></span>

## 快速开始与用户指南 {#start-here}

- [创建第一个项目](./guide/first-project.md)和[设置团队](./guide/team-setup.md)。
- [Work 任务与审查](./guide/work.md)、[Knowledge 文档](./guide/knowledge.md)和[Code PR](./guide/code.md)。
- [模型连接](./model-usage.md)、[Run、工作流、工具与沙箱](./execution-usage.md)，以及[管理员与企业登录](./guide/administration.md)。

<span id="完成與證據"></span>
<span id="完成与证据"></span>

## 任务如何完成 {#completion-and-evidence}

Agent 运行结束不代表任务已完成。执行者需要提交成果与相关证据，再由另一位获授权的审查者检查并接受；执行者不能自行审查自己的成果。DEMO 模式用于演示，不会调用付费模型，因此不能当作真实模型结果或实际费用。无法确认的实际费用会标记为未知。

<span id="適用與限制"></span>
<span id="适用与限制"></span>

## 适用范围与当前限制 {#intended-use-and-limits}

Ordivant 适合希望自行管理服务和数据，并逐步引入 Agent 协作的团队。各产品可以独立部署，但登录、模型、外部工具和代码托管服务仍需按环境配置。Run 用量不一定包含可核实的美元费用；实际模型费用由供应商收取。外部 MCP 工具可能修改上游数据。沙箱工作区是临时空间，不提供 VM 级隔离。详情见[功能指南](./features.md)和各用户指南。

Work 当前由单一运行服务处理工作，暂不支持多台服务共同分布式运行。高负载能力以及各组织的登录、代码平台和模型设置，都需要在实际环境中确认。更多当前功能与限制见[路线图](./roadmap.md)，版本与升级信息见[版本说明](./release.md)。
