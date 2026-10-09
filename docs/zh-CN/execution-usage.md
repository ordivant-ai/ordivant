<span id="執行、範本、自動流程與工具環境"></span>
<span id="运行、模板、自动流程与工具环境"></span>

# 运行、模板、自动流程与工具环境 {#runs-templates-workflows-and-tool-environments}

Run 执行、Agent 模板、工作流程与工具连接由 **Work** 管理；Knowledge／Code 仍可独立使用，不需要启动沙箱。API 与权限规则见[架构与 API 索引](reference.md#work-api)。

第一次使用时，先登录 Work，由管理员在「模型连接」设置 API endpoint、密钥与预设模型；再创建需要的工具连接／沙箱与 Agent，最后手动派工或启动工作流程。已存在的组织模型设置可直接沿用。没有设置有效模型时，运行明确标示为 DEMO。

<span id="啟動"></span>
<span id="启动"></span>

## 启动 {#start}

开发环境与一般部署环境可使用以下 Compose 指令：

```powershell
# 開發模式：熱重載，啟動隔離執行器。
.\scripts\containers.ps1 -Development -WithRuntime -WithSandbox

# 部署用 images：本機 Nginx 與 PostgreSQL。
.\scripts\containers.ps1 -WithRuntime -WithSandbox
```

新建的示范环境加 `-Seed`；它会创建标示为 DEMO 的业务数据，管理员账号仍由用户在网页自行创建。若需要 Code 的本机版控，加 `-WithGitea`。两种模式各有自己的数据与账号。沙箱 API 不发布主机连接端口，只接受内部 runtime 调用。

<span id="run-執行控制台"></span>
<span id="run-运行控制台"></span>

## Run 运行控制台 {#run-console}

1. 选择项目，在任务中派发 Pi Agent。派工后会立刻出现 queued Run。
2. 打开「Run 运行」，查看任务、Agent、execution、状态及模型快照；选取 Run 可查看事件、工具结果及实际 token receipt。
3. 管理员／项目 manager 可以要求暂停、继续、停止或重跑。其他成员可以查看自己获授权的项目。

「暂停」会在下一个工具操作前等待；正在进行的模型或工具调用可以先结束。画面将要求暂停与确实进入 paused 分开显示。Pi 目前没有立即冻结模型请求的 pause API。等待期间仍续租，并计入整次 Run 的时间上限。「恢复」解除同一次运行的等待。重启时，服务仅重新交付仍有效的原 execution 租约；已过期或遗失 ownership 会失败并要求重新派工。无法确认是否完成的外部副作用不会自动重播。

「停止」立即撤销业务运行的写入资格，再终止模型／沙箱；任务回到 ready。已启动的外部工具若产生副作用，需要依其服务结果核对。终止 Run 不会自动删除证据。失败／停止的 Run 可重跑，会创建新的 Run 和 execution 并保留来源链接。已验收完成的任务不会被重跑按钮重新打开。

Run 的 done 代表模型运行与提交完成；任务仍要由独立审查者接受才是 done。DEMO 不调用付费模型；Live receipt 显示实际回传的模型与用量。未取得的 token 或美元费用显示未知。

<span id="agent-範本"></span>
<span id="agent-模板"></span>

## Agent 模板 {#agent-templates}

在「自动化 → Agent 模板」创建角色、能力、指令、模型、工具白名单、沙箱与运行限制。每次修改都发布新的不可变版本。添加或编辑 Agent 时选择确切版本，也能调整个别设置；设置保存后的下一次派工才生效。

旧版模板及已派工 Run 的快照保持可追溯。模板不授予新的项目权限；Agent 必须原本就被授予工具与沙箱所在项目。模型连接仍由组织管理员维护，模板不存放 API key。

<span id="自動工作流程"></span>
<span id="自动工作流程"></span>

## 自动工作流程 {#automated-workflows}

在「自动化 → 工作流程」创建步骤与前置依赖。每一步指定 Pi Agent，或指定必须具备的能力；可指定独立 reviewer。步骤可以平行，但依赖必须形成无环的图。

手动启动时提供整次流程的文字输入。系统创建每一步的任务，runtime 调度器会自动派发符合条件的工作。没有可用 Agent 时保留等待状态；已有前置任务待审时，也会等待。Reviewer 接受前置成果后，后续步骤会自动开始。所有步骤都通过独立验收，流程才会完成。

定时启动使用分钟间隔与最多启动次数；runtime 必须持续运行。同一调度的进行中流程会阻止重叠启动，不补发停机期间所有漏掉的周期。取消流程会停止尚未完成的任务与 Run；已验收成果保留。新版工作流程不会更改已经启动的版本。

<span id="外部-mcp-工具"></span>

## 外部 MCP 工具 {#external-mcp-tools}

部署操作者先允许受信任的 MCP 服务主机，再由 Work 管理员在「工具与沙箱」添加项目连接。第一版使用 MCP Streamable HTTP；不接受任意主机 stdio 命令。

```powershell
$env:ORDIVANT_TOOL_ALLOWED_HOSTS = 'mcp.company.example'
.\scripts\containers.ps1 -Development -WithRuntime -WithSandbox
```

填入 HTTPS MCP endpoint、write-only bearer token 与允许的 tool names，按「测试连接」取得真实 tools/list。HTTP 只用于明确指定的私有／本机测试服务，还需 `ORDIVANT_TOOL_HTTP_HOSTS`；解析至内网、loopback 或其他非公开地址时，各模式均需 `ORDIVANT_TOOL_PRIVATE_HOSTS`。HTTPS 私网服务也要正常的 TLS 凭证。预设没有允许的外部主机。URL 中不能含帐密，也不能透过 redirect 将认证送往其他服务。

连接密钥加密保存，不回填到表单；留白保留原密钥。变更有认证的 endpoint 时需明确重新输入密钥。Agent 绑定后只会取得该运行项目允许的工具，工具名称会加入命名空间。外部操作预设不自动重播；不确定的副作用不会被当成成功或自动重做。

目前提供 bearer 认证；尚未支持各厂商的交互式 MCP OAuth、stdio launcher 和远程 A2A。

<span id="沙箱"></span>

## 沙箱 {#sandboxes}

管理员添加项目沙箱设置，限制 command 时间、内存、CPU、process 数、输出 bytes 与 workspace 空间。将设置套用至 Agent。派工时固定设置快照，runtime 会提供读写文件、列出文件、运行 argv command 的沙箱工具。

每个 Run 使用独立容器与有大小上限的内存 workspace；程序以非 root 身份运行，系统文件唯读，且无网络、主机目录或 provider／工具／平台凭证。内含 Python、Node.js 与 Git，可运行映像中已有依赖的程序与测试。网络关闭，因此需要的套件应由部署者预先加入固定 job image，或由授权文件工具写入；目前不支援任意 Git 网址 clone 或在线安装套件。

失败 command 会保留非零 exit code，超时及截断的输出会明确标记。文件只能使用相对 workspace 路径，拒绝 traversal 与 symlink escape。成果文件／测试输出需在 Run 结束前提交为证据；Run 结束、停止或整次运行超时会清理 workspace，运行器重启会清理自己拥有的孤儿工作。单一 command 超时会终止其 process group 并保留明确结果。这不是长期文件保存。

清理 API 未成功确认时，控制台会显示 sandbox failed 与清理未确认错误；重启后原临时工作区失联时显示 lost。模型成果与清理状态分开记录。操作者需检查／重启自己拥有的运行器完成孤儿清理；系统不把未确认删除标成成功，也不自动重跑模型副作用。

只有独立受信任的 `sandbox-api` 服务持有 Docker daemon socket；Work、runtime、浏览器与 job 均不持有。该服务的内网与服务凭证由部署操作者控制。Docker 隔离使用共用 kernel；要求 VM 边界的企业应另接 VM／microVM 运行器。

<span id="隔離驗收"></span>

## 在项目中验证运行结果 {#isolated-acceptance}

可在自己的项目中执行低风险任务，确认 Run 从 queued 进入执行与提交状态，再由另一位具备权限的成员独立审核成果。DEMO 只验证产品流程，不代表已调用付费模型；使用已设置的模型连接时，请先确认供应商、模型与费用政策。

使用工具连接时，先通过「测试连接」确认可以取得允许的工具列表，再派发只读取数据或创建可安全清理的测试数据的任务。到上游服务核对实际副作用；停止 Run 不会撤销外部服务已完成的操作，也不会自动重播结果不明的操作。

如果 Agent 使用沙箱，请确认文件与命令结果在 Run 结束前已提交为证据，且 Run 结束后工作区会清理。沙箱 API 无法确认删除时，控制台会标示清理未确认；部署者应检查自己管理的执行器。Docker 隔离共用主机 kernel；需要 VM 边界时，请连接 VM 或 microVM 执行器。
