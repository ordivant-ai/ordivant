# 运行、模板、自动流程与工具环境

本轮功能位于 **Work**。Knowledge／Code 仍可独立使用，不需要启动沙箱。完整 API 与权限在 [运行契约](execution-contracts.md)。

第一次使用时，先登录 Work，由管理员在「模型连接」设置 API endpoint、密钥与预设模型；再创建需要的工具连接／沙箱与 Agent，最后手动派工或启动工作流程。已存在的组织模型设置可直接沿用。没有设置有效模型时，运行明确标示为 DEMO。

## 启动

既有本机环境已经有 Work runtime bootstrap 时：

```powershell
# 開發模式：熱重載，啟動隔離執行器。
.\scripts\containers.ps1 -Development -WithRuntime -WithSandbox

# 部署用 images：本機 Nginx 與 PostgreSQL。
.\scripts\containers.ps1 -WithRuntime -WithSandbox
```

新建的示范环境加 `-Seed`；它会创建标示为 DEMO 的业务数据，管理员账号仍由用户在网页自行创建。若需要 Code 的本机版控，加 `-WithGitea`。两种模式各有自己的数据与账号。沙箱 API 不发布主机连接端口，只接受内部 runtime 调用。

## Run 运行控制台

1. 选择项目，在任务中派发 Pi Agent。派工后会立刻出现 queued Run。
2. 打开「Run 运行」，查看任务、Agent、execution、状态及模型快照；选取 Run 可查看事件、工具结果及实际 token receipt。
3. 管理员／项目 manager 可以要求暂停、继续、停止或重跑。其他成员可以查看自己获授权的项目。

「暂停」会在下一个工具操作前等待；正在进行的模型或工具调用可以先结束。画面将要求暂停与确实进入 paused 分开显示。Pi 目前没有立即冻结模型请求的 pause API。等待期间仍续租，并计入整次 Run 的时间上限。「恢复」解除同一次运行的等待。重启时，服务仅重新交付仍有效的原 execution 租约；已过期或遗失 ownership 会失败并要求重新派工。无法确认是否完成的外部副作用不会自动重播。

「停止」立即撤销业务运行的写入资格，再终止模型／沙箱；任务回到 ready。已启动的外部工具若产生副作用，需要依其服务结果核对。终止 Run 不会自动删除证据。失败／停止的 Run 可重跑，会创建新的 Run 和 execution 并保留来源链接。已验收完成的任务不会被重跑按钮重新打开。

Run 的 done 代表模型运行与提交完成；任务仍要由独立审查者接受才是 done。DEMO 不调用付费模型；Live receipt 显示实际回传的模型与用量。未取得的 token 或美元费用显示未知。

## Agent 模板

在「自动化 → Agent 模板」创建角色、能力、指令、模型、工具白名单、沙箱与运行限制。每次修改都发布新的不可变版本。添加或编辑 Agent 时选择确切版本，也能调整个别设置；设置保存后的下一次派工才生效。

旧版模板及已派工 Run 的快照保持可追溯。模板不授予新的项目权限；Agent 必须原本就被授予工具与沙箱所在项目。模型连接仍由组织管理员维护，模板不存放 API key。

## 自动工作流程

在「自动化 → 工作流程」创建步骤与前置依赖。每一步指定 Pi Agent，或指定必须具备的能力；可指定独立 reviewer。步骤可以平行，但依赖必须形成无环的图。

手动启动时提供整次流程的文字输入。系统创建每一步的任务，runtime 调度器会自动派发符合条件的工作。没有可用 Agent 时保留等待状态；已有前置任务待审时，也会等待。Reviewer 接受前置成果后，后续步骤会自动开始。所有步骤都通过独立验收，流程才会完成。

定时启动使用分钟间隔与最多启动次数；runtime 必须持续运行。同一调度的进行中流程会阻止重叠启动，不补发停机期间所有漏掉的周期。取消流程会停止尚未完成的任务与 Run；已验收成果保留。新版工作流程不会更改已经启动的版本。

## 外部 MCP 工具

部署操作者先允许受信任的 MCP 服务主机，再由 Work 管理员在「工具与沙箱」添加项目连接。第一版使用 MCP Streamable HTTP；不接受任意主机 stdio 命令。

```powershell
$env:ORDIVANT_TOOL_ALLOWED_HOSTS = 'mcp.company.example'
.\scripts\containers.ps1 -Development -WithRuntime -WithSandbox
```

填入 HTTPS MCP endpoint、write-only bearer token 与允许的 tool names，按「测试连接」取得真实 tools/list。HTTP 只用于明确指定的私有／本机测试服务，还需 `ORDIVANT_TOOL_HTTP_HOSTS`；解析至内网、loopback 或其他非公开地址时，各模式均需 `ORDIVANT_TOOL_PRIVATE_HOSTS`。HTTPS 私网服务也要正常的 TLS 凭证。预设没有允许的外部主机。URL 中不能含帐密，也不能透过 redirect 将认证送往其他服务。

连接密钥加密保存，不回填到表单；留白保留原密钥。变更有认证的 endpoint 时需明确重新输入密钥。Agent 绑定后只会取得该运行项目允许的工具，工具名称会加入命名空间。外部操作预设不自动重播；不确定的副作用不会被当成成功或自动重做。

目前提供 bearer 认证；各厂商的交互式 MCP OAuth、stdio launcher 和远程 A2A 不包含在本轮。

## 沙箱

管理员添加项目沙箱设置，限制 command 时间、内存、CPU、process 数、输出 bytes 与 workspace 空间。将设置套用至 Agent。派工时固定设置快照，runtime 会提供读写文件、列出文件、运行 argv command 的沙箱工具。

每个 Run 使用独立容器与有大小上限的内存 workspace；非 root、唯读系统文件、无网络、无主机目录、无 provider／工具／平台认证。内含 Python、Node.js 与 Git，可运行现有依赖的程序与测试。网络关闭，因此需要的套件应由操作者预先加入固定 job image，或由授权文件工具写入；本轮不提供任意 Git 网址 clone 或在线安装套件。

失败 command 会保留非零 exit code，超时及截断的输出会明确标记。文件只能使用相对 workspace 路径，拒绝 traversal 与 symlink escape。成果文件／测试输出需在 Run 结束前提交为证据；Run 结束、停止或整次运行超时会清理 workspace，运行器重启会清理自己拥有的孤儿工作。单一 command 超时会终止其 process group 并保留明确结果。这不是长期文件保存。

清理 API 未成功确认时，控制台会显示 sandbox failed 与清理未确认错误；重启后原临时工作区失联时显示 lost。模型成果与清理状态分开记录。操作者需检查／重启自己拥有的运行器完成孤儿清理；系统不把未确认删除标成成功，也不自动重跑模型副作用。

只有独立受信任的 `sandbox-api` 服务持有 Docker daemon socket；Work、runtime、浏览器与 job 均不持有。该服务的内网与服务凭证由部署操作者控制。Docker 隔离使用共用 kernel；要求 VM 边界的企业应另接 VM／microVM 运行器。

## 隔离验收 {#隔離驗收}

```powershell
# 埠 8092 僅供合成 QA；不啟動原企業 SSO fixture。
$env:ORDIVANT_WEB_PORT = '8092'
.\scripts\containers.ps1 -ProjectName ordivant-execution-qa -Seed -WithRuntime -WithSandbox -ExecutionQaFixture
uv --cache-dir .cache/uv run --project backend --no-sync python scripts/execution_acceptance.py --containers
uv --cache-dir .cache/uv run --project backend --no-sync python scripts/execution_cleanup_acceptance.py
.\scripts\containers.ps1 -ProjectName ordivant-execution-qa -Action down -WithRuntime -WithSandbox -ExecutionQaFixture
Remove-Item Env:ORDIVANT_WEB_PORT
```

脚本只允许自己的 Compose project 与 `127.0.0.1:8092`，使用既有授权的合成 QA 账号。MCP fixture 是带认证的本机合成服务；Docker probe 会真正读写文件、运行成功／失败 command、验证隔离及限制。报告位于 `.data/validation/`，不含凭证。验收结果与限制见 [运行功能验收](execution-validation.md)。

需要重现鼠标验收时，在 QA 仍启动且 API 验收已产生资源后运行以下指令；需已安装 Chrome。浏览器使用独立的 headless 工作阶段。

```powershell
npm install --prefix .cache/browser-qa --no-audit --no-fund --package-lock playwright
uv --cache-dir .cache/uv run --project backend --no-sync python scripts/execution_browser.py scripts/execution_ui.cjs
uv --cache-dir .cache/uv run --project backend --no-sync python scripts/execution_run_browser.py
```

Live 验收会真的调用你指定的 Provider，不包含在一般 CI 或脱机测试。请明确设置以下环境变量；endpoint/model 由你选择，key 只从指定的本机文件读取，不会自动读取或解密主环境的已存连接。

```powershell
# 仅设置非机密的连接信息与文件路径；不要把 key 值放入命令。
$env:ORDIVANT_TEST_PROVIDER_BASE = 'https://YOUR_PROVIDER_HOST/v1'
$env:ORDIVANT_TEST_PROVIDER_MODEL = 'YOUR_MODEL_ID'
$env:ORDIVANT_TEST_PROVIDER_PROJECT = 'ordivant-execution-qa'
$env:ORDIVANT_TEST_PROVIDER_KEY_FILE = '/path/to/private/provider.key'
# 可选：ORDIVANT_TEST_PROVIDER_ID，默认 acceptance-provider。
uv --cache-dir .cache/uv run --project backend --no-sync python scripts/execution_live_acceptance.py
# 將下列路徑替換成上一個命令產生的成功報告。
uv --cache-dir .cache/uv run --project backend --no-sync python scripts/execution_record_checks.py .data/validation/execution-EXAMPLE/live-report.json
uv --cache-dir .cache/uv run --project backend --no-sync python scripts/execution_browser.py scripts/execution_live_ui.cjs --report .data/validation/execution-EXAMPLE/live-report.json
```

请先依隔离验收步骤启动 8092 的 `ordivant-execution-qa` 并完成一般验收；Live 脚本会检查环境 ownership。脚本只设置 QA 的个别 Agent，组织 default 保持空值。其他 QA 工作仍是 DEMO。请使用支持 Responses/tool calling/reasoning 的实际模型并预留测试用量。

纪录检查会短暂停止自己的 QA runtime，在没有 Pi writer 的状态下只读检查当次 MCP tool result，再恢复服务；输出只有布尔与资源 ID。历史验收摘要见[运行功能验收](execution-validation.md)，原始 QA 数据与密钥不随公开仓库提供。
