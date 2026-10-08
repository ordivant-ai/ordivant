# 开始使用 Ordivant

本指南以 Docker Compose 创建本机开发环境。Work、Knowledge、Code 和 Identity 会启动在同一个浏览器入口；数据仍分别存放在各产品自己的数据库与 volume。

## 准备环境

- Git。
- Docker Desktop（Windows/macOS，使用 Linux containers）或 Linux Docker Engine。
- Docker Compose v2 plugin，可运行 `docker compose`。
- PowerShell 7（`pwsh`）。`scripts/containers.ps1` 在 Windows 和 Linux 使用同一套参数。

不需要先在主机安装 Python、Node.js 或 `uv`。第一次启动会建置映像并下载所需容器映像，所需时间取决于网络和主机性能。

## 拷贝并启动

在 Windows PowerShell 7 中运行：

```powershell
git clone https://github.com/bigtongue5566/ordivant.git
Set-Location ordivant
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed
```

在 Linux shell 也可以这样调用：

```bash
git clone https://github.com/bigtongue5566/ordivant.git
cd ordivant
pwsh -NoProfile -File ./scripts/containers.ps1 -Development -ProjectName ordivant-dev -Seed
```

预设会选取三个产品。打开 `http://127.0.0.1:5173`，在首次设置页创建你自己的管理员账号。没有内置人类账号或预设密码。首次创建的管理员会取得一次性复原码，请自行安全保存；密码与复原码不要贴到聊天、命令行或日志。更多登录与邀请说明见[人类登录](../human-login.md)。

`-Seed` 是明确的示范数据初始化选项：它在所选产品创建标示为 DEMO 的业务范例，并创建产品 API／Agent 所需的本机 bootstrap 凭证。它不创建 Identity 的人类账号、不设置企业 SSO，也不代表已连接付费模型。不要把 `.data` 或容器 secrets 加入 Git。

这个最小启动可浏览三个产品与 Work 的一般任务流程，但不会启动 Pi Runtime、Gitea 或沙箱。要在新环境一次启动 Agent Runtime、Code 写入与 Docker 沙箱，改用完整命令：

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithGitea -WithRuntime -WithSandbox
```

Linux 使用 `./scripts/containers.ps1` 路径。若已先启动最小环境，使用相同 `-Development` 和 `-ProjectName` 加上 `-WithGitea -WithRuntime -WithSandbox` 即可；不要再次加 `-Seed`。新环境若只要 Runtime、不需要 Code 写入或沙箱，可只加 `-WithRuntime`。`-WithSandbox` 必须同时启动 Work 和 Runtime。

## Seed 与 Runtime

Seed 和 Runtime 是两个不同步骤。Seed 在 Work 的持久数据目录创建 `bootstrap.json`，Runtime 启动时使用它取得服务所需的初始连接数据。新环境若直接加 `-WithRuntime` 却没有既有 Work bootstrap，helper 会停止并提示使用 `-Seed`；它不会在背景偷偷产生示范数据。对已初始化的数据，之后可在同一 Compose project 加入 Runtime。

Runtime 未取得可用的模型连接时，运行会使用明确标示的 DEMO fallback；这不是付费模型运行。模型连接由管理员在 Work 设置并按 Agent 套用，请参阅[运行与自动化指南](../execution-usage.md)。

## 检查与停止

以相同的项目名称查看服务状态、查看服务日志或停止容器：

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action status
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action logs -WithRuntime -WithGitea -WithSandbox
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action down
```

Linux 将脚本路径改为 `./scripts/containers.ps1`。`down` 只停止该 Compose project 并保留 named volumes；不会清除数据。要重新启动，使用先前相同的 project name 和功能选项。

PowerShell 7 在 Linux 可参考[容器操作说明](../containers.md)。生产目标不加 `-Development`，预设 Web port 是 `8088`；对外提供服务前，需设置可信 HTTPS origin、secure cookie、身分服务及数据备份，不能把本机开发设置直接当成正式部署。

## 接下来

- [Work：任务与审核](work.md)
- [Knowledge：文档、版本与引用](knowledge.md)
- [Code：Repository 与 Pull Request](code.md)
- [管理员、角色与 SSO](administration.md)
- [运维与备份](operations.md)
- [排除常见问题](troubleshooting.md)
