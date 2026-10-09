# 原生账号验收 {#native-account-acceptance}

请使用隔离的本机 Compose 项目。此 fixture 仅接受 `http://127.0.0.1:8092`；请勿将该连接端口或项目用于真实用户数据。它会创建合成账号与业务资源、变更合成账号的密码／权限，并且只会重新启动或暂停带有指定标签的 QA 服务。

```powershell
$env:ORDIVANT_WEB_PORT = '8092'
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa -Seed
$env:UV_CACHE_DIR = Join-Path (Get-Location) '.cache/uv'
uv run --project backend --no-sync python scripts/auth_acceptance.py --containers
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa -Action down
Remove-Item Env:ORDIVANT_WEB_PORT
```

若要验收开发模式，请指定 `-Development`、设置 `ORDIVANT_DEV_WEB_PORT=8092`，并通过对应的 `ORDIVANT_*_PORT` 变量，为 Work／Knowledge／Code／Identity 选择未使用的主机 API 连接端口。变更模式前，请先停止 production QA 项目。验收命令本身不变。主环境 `5173` 与 `8088` 各自使用独立数据库与凭证。

HTTP 检查涵盖初始设置完成后的封锁、Cookie 旗标、私有 introspection、共用人类身分与各产品本地 principal、并行绑定、明确的成员范围、禁止扩张范围、无效 Bearer 的优先处理、Origin／CSRF 验证、一次性邀请／复原、密码与工作阶段撤销、停用账号、节流、重新启动后的持久性、Identity 中断时采取 fail-closed，以及该中断期间仍可独立使用 Agent Bearer。报告只包含检查结果与业务资源 ID，不含密码、工作阶段识别值、CSRF 值、邀请码或复原码。

Identity 单元测试使用暂存数据库与合成凭证：

```powershell
Push-Location products/identity/backend
uv run --no-sync python -m pytest tests -q
Pop-Location
```

浏览器验收会在同一隔离项目中，以既有合成账号正常登录。请用鼠标实际操作菜单，不可只确认 ARIA 展开状态或键盘导览：包括产品项目／Space 选择器、Work 状态筛选器、Modal 中的任务优先级，以及显示于 Drawer／Modal 上方的权限范围选择器。在 390×844 窗口中，请确认弹出菜单边界、文档宽度、可见的账号控制项与注销功能。密码创建／变更／复原测试通过 HTTP fixture 运行；用户自行输入真实凭证。

产品／账号契约见 [auth-contracts.md](auth-contracts.md)，操作说明见 [human-login.md](human-login.md)，已完成的验收证据见 [validation.md](validation.md)。
