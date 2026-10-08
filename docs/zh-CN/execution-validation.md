# 运行功能验收

日期：2026-10-08（Asia/Taipei）。Run 运行控制台、Agent 模板／自动流程与 MCP 工具／沙箱已完成本机交付；包含真实授权模型回合、容器、重启、并发与鼠标操作验收。

范围与权限：[运行契约](execution-contracts.md)。操作：[使用说明](execution-usage.md)。验收使用独立的 `ordivant-execution-qa` PostgreSQL 环境与 `127.0.0.1:8092`，登录使用先前获授权的合成 QA 账号。

## 已取得的证据

| 验证 | 结果 | 涵盖 |
|---|---|---|
| Work backend | 41 tests passed；compileall 通过 | Run 权限、lease、停止／重跑、terminal sync 回应遗失重放、实际提交／快速 review 完成检查、有效租约重交付、不可变版本、调度锁顺序、工具认证屏蔽与 scope |
| 既有产品回归 | Identity 28、Knowledge 10、Code 20 tests passed | 既有企业登录、各产品授权与 service 行为 |
| Runtime／Pi SDK | 25 tests passed；build 通过 | 真实 Pi 工具事件与收据、续租／进度交错、平台写入新 token、pause、reply-loss 同 body／sequence 重试、完成证据比对与有效租约恢复；延迟／失败的 workspace 清理及 terminal Run 重启恢复 |
| 沙箱 service | 3 tests passed | 参数／路径限制、服务授权与 command 错误；实际 Docker 验证另列 |
| REST／MCP／Pi 回归 | passed；官方 SDK 发现 29 tools | 真实 collaboration／claim 竞争／scope／依赖／review／幂等；实际 Pi DEMO outbox 回合 |
| 完整运行容器 | 53 checks passed | queued stop／retry、新 execution 与历史、真实工具事件、两步骤 DAG 自动派工／独立 review、实际分钟间隔、不重叠／取消、全新项目 runtime 授权、沙箱与 Work／runtime 重启 |
| 真实授权模型回合 | 20 checks passed | `測試 Provider／gpt-6.1-sol` 真实 MCP wait／add、工具边界 pause→resume 并保留同 execution、实际 Python exit 0／刻意 exit 7、独立 PM review、receipt／execution 重启持久化 |
| 真实纪录与清理 | 16 checks passed | 脱机检查 Pi MCP result 的 sum=42；provider／MCP 加密、派工凭证撤销、Pi／RunStore／idempotency／最近 logs 无已知凭证、没有 QA job 残留 |
| 最终 terminal 清理回归 | 9 checks passed | 不调用付费模型的实际 Docker job：创建 workspace、完成 DEMO 工具回合，等待真正的清理后才同步 sandbox stopped／不可用，再由独立 PM review；没有 job 残留 |
| PostgreSQL 实际并发 | 8 checks passed | 六次版本发布得到 v2–v7；六次手动启动一个成功；八次 tick 只创建一个调度流程 |
| 真实 MCP／API 设置 | 26 checks passed | 官方 MCP tools/list、Bearer 认证、白名单主机、write-only 密钥、Agent 创建／编辑、模板版本、流程依赖／幂等 |
| 真实 Docker executor | 67 checks passed | Python／Node／Git、文件与命令、exit 0／7、非 root、唯读根目录、network none、resource／workspace／output 限制、path／symlink／FIFO、逾时及清理 |
| Executor 异常重启 | 2 checks passed | 对 QA 运行器 SIGKILL 后重新启动，两个实际孤儿 job 被清理 |
| 浏览器实际操作 | 表单／自动化 45 checks、Run 控制台 10 checks、Live inspector 10 checks passed | 桌面 1440×1000 与 390×844；鼠标下拉／虚拟清单卷动、模板及工具／沙箱绑定、Agent 修改、流程启动；真实服务器已提交后遗失回应，重试得到同一个 instance／Run；停止／重跑、真实模型用量／MCP 工具／沙箱 stdout／exit0／7与手机详细页 |
| 前端 | TypeScript、Suite／Work／Knowledge／Code builds 通过 | 四种可独立建置的产品模式；既有 bundle 大小警告仍存在 |
| 两套本机环境保留／健康 | 40 checks passed | 5173／8088 的账号数、初始设置 marker、SSO／模型／加密 provider 设置摘要及项目数与更新前一致；产品入口／API 200，Identity／各产品／web／runtime／sandbox healthy |
| 隔离 QA 收尾 | 8 checks passed | 自有容器、网络及 job 均已移除，named volumes 保留，两套主环境 Work／Identity 仍为 200 |

DEMO 与合成服务检查保持各自标示；真实模型那一列才有实际 provider 请求。最后 Live receipt 回报要求／回传模型均为 `gpt-6.1-sol`，输入 40,000 tokens（其中缓存 16,128）、输出 744、合计 40,744；工具有 MCP wait／add 各一次、平台 progress 一次、sandbox write 一次、execute 两次。供应商实际路由与发票尚未核对，`cost_usd=null`，UI 显示未知。

## 可重现的证据位置

验收程序位于 `scripts/execution_acceptance.py`、`execution_postgres_probe.py`、`sandbox_probe.py`、`execution_browser.py`／`execution_ui.cjs`、`execution_run_browser.py`／`execution_run_ui.cjs`、`execution_live_acceptance.py`／`execution_live_ui.cjs`、`execution_record_checks.py`、`execution_cleanup_acceptance.py` 与 `execution_local_readiness.py`。完整启动与测试命令见使用说明。

报告保存在本机 `.data/validation/`：`execution-e8f561d8/report.json`（53）、`execution-55faa750/live-report.json`（20）／`record-checks.json`（16）、`execution-cleanup.json`（9）、`execution-postgres.json`、`sandbox-integration.json`、`sandbox-crash-recovery.json`、`execution-browser/report.json`、`execution-run-browser/report.json`、`execution-live-browser/report.json` 与浏览器 PNG。主环境保留／健康在 `execution-local-before.json`／`execution-local-after.json`（40）。REST／MCP／Pi 回归在 `20261008-021346-6e1664/report.json`。报告只保存结果与合成资源 ID，不保存账号密码、provider／MCP 密钥、Agent credential 或沙箱 capability。早期失败报告保留供追查；以本段指定的最后成功报告为准。

Terminal sync 会等待运行器的清理 Promise 结束，再读最新 RunStore。清理 DELETE 失败显示 sandbox `failed` 与固定的「清理尚未确认」事件；重启后失去 capability 的旧 terminal workspace 显示 `lost`，不会重跑模型，也不宣称已删除。延迟及失败测试同时确认等待期间的 task／delivery heartbeat 仍持续续租。

历史 Live 验收曾在操作者授权下沿用其测试连接。公开版本已移除从开发环境数据库读取／解密凭证的专用 helper 行为；重现验收需明确设置隔离 `*-qa` Compose project、HTTPS endpoint、model 及自己的 key 文件，见[操作说明](execution-usage.md)。公开源代码不包含当次连接设置、密钥或原始 QA 数据。

两套既有主环境更新时没有运行 Seed；用户仍自行创建第一位管理员。开发模式保留既有加密模型连接，本机 production 模式保留未设置 provider 的状态。各自的四个 PostgreSQL、Gitea、应用程序、runtime 与沙箱服务均 healthy。隔离 `ordivant-execution-qa` 容器／网络已以 helper down 清除，数据卷及验收报告保留；收尾证据在 `execution-teardown.json`（8）。没有对外部署、推送或发布。
