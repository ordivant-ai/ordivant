# 容器开发与部署 {#container-workflow}

`scripts/containers.ps1` 会通过 Docker Compose 建置并运行选定的产品。主机需要 Docker Engine／Desktop 与 Docker Compose，不需要安装 `uv`、Python、Node.js 或 npm。

## 开发环境 {#development}

以下命令会启动完整开发套件，明确创建本机示范数据，并激活选配的 Gitea 与 Pi runtime 服务：

```powershell
.\scripts\containers.ps1 -Development -Seed -WithGitea -WithRuntime
```

辅助脚本会建置选定产品的开发映像，等待 API 与网页服务就绪；只有提供 `-Seed` 时才初始化选定 API 的数据，提供 `-WithGitea` 时才初始化本机 Gitea 服务帐号。Work 已有初始化档后，才会启动 runtime。已设置模型的 Work 派发会使用实际模型连接；尚未设置的派发会使用有明确示范标示、结果固定的备援模式。详见[模型设置](model-usage.md)。

开发模式会将产品原代码挂载到容器中，并提供与正式环境相同的完整帐号登录。无论选择哪一个产品，都会包含 Identity API `8030` 与其独立 PostgreSQL。缺省主机连接端口为 Work API `8000`、Knowledge API `8010`、Code API `8020`、网页 `5173`、runtime `8090`，以及 Gitea `3002`。若连接端口已被使用，可在 shell 中覆写 Compose 的连接端口变量。

若只要运行单一产品的独立前端与 API，而不启动其他产品：

```powershell
.\scripts\containers.ps1 -Development -Products knowledge -Seed
.\scripts\containers.ps1 -Development -Products code -Seed -WithGitea
```

选择单一产品时，脚本会将 `ORDIVANT_PRODUCT_MODE` 设为该产品，并将网页的 API 上游指向对应 API 容器。支持单一产品、全部三个产品，以及包含 Work 的两产品组合。只有 Knowledge＋Code 的组合会被拒绝，因为套件路由需要 Work 作为 `/api` 的上游。支持的多产品组合会使用套件模式，并将 `/api` 导向 `work-api`。

## 正式环境映像 {#production-targets}

首次启动时，网页会要求用户自行设置密码并创建初始管理员。平台没有缺省的人类帐号；`-Seed` 只会创建业务示范数据与 Agent 凭证。开发与正式环境使用不同的 Identity 数据卷，以及各自 Compose 项目的 Cookie 名称。邀请、权限、密码复原与撤销工作阶段的方式，请参阅[帐号与登录](human-login.md)。所有已设置的产品都会在两种模式中拒绝旧的本机工作阶段端点。

除非明确提供设置，脚本会依选定的网页主机连接端口推导精确的 `ORDIVANT_AUTH_ORIGINS`。远程 HTTPS 部署需设置公开来源，以及 `ORDIVANT_AUTH_COOKIE_SECURE=true`。只有明确使用 HTTP 回送地址的来源可使用非安全 Cookie。Identity 服务秘密与数据库连接档保存在各项目已被 Git 忽略的秘密文件夹中。

不加 `-Development`，即可建置并运行正式环境 Docker 映像。本机工作阶段验证仍保持停用：

```powershell
.\scripts\containers.ps1 -Action up
.\scripts\containers.ps1 -Action up -Products knowledge
```

选择完整套件时，会使用套件前端模式，并以 Work 作为 `/api` 上游。单独选择 Knowledge 或 Code 时，会建置该产品的独立前端。正式环境缺省网页连接端口为 `8088`。开发与正式环境的缺省 Compose 项目名称都包含保存库绝对路径的哈希，因此另一份 checkout 会取得独立的项目与秘密文件夹。可使用 `-ProjectName` 指定固定的运行个体名称。

若要同时运行开发与正式环境，请使用不同的 Compose 项目名称及不冲突的主机连接端口。以下范例让开发环境 Gitea 使用 `3003`，正式环境 Gitea 使用缺省的 `3002`：

```powershell
$env:ORDIVANT_DEV_WEB_PORT = '5173'
$env:ORDIVANT_WEB_PORT = '8088'
$env:ORDIVANT_GITEA_PORT = '3003'
.\scripts\containers.ps1 -Development -ProjectName ordivant-dev-local -Seed -WithGitea -WithRuntime
Remove-Item Env:ORDIVANT_GITEA_PORT
.\scripts\containers.ps1 -ProjectName ordivant-prod-local -WithGitea
```

这两次运行会使用各 Compose 项目独立的数据卷，以及 `.data/container-secrets/<ProjectName>/` 文件夹。正式环境的命令不会创建示范数据。

## 操作与数据保存 {#actions-and-data}

`-Action` 支持 `up`（缺省）、`down`、`status` 与 `logs`。操作同一项目时，请使用相同的 `-Development` 与 `-ProjectName` 值。例如：

```powershell
.\scripts\containers.ps1 -Development -Action status
.\scripts\containers.ps1 -Development -Action logs -WithGitea -WithRuntime
.\scripts\containers.ps1 -Development -Action down
```

`down` 只会停止选定的 Compose 项目，并保留其具名数据库、产品、runtime 与 Gitea 数据卷。脚本不会使用 `down -v`，也不会删除秘密或数据。

必须明确提供 `-Seed` 才会在各选定产品的 API 容器内运行数据初始化模块。初始化数据及产生的 Bearer token 都是本机示范数据，不会设置企业 SSO。若使用 `-WithRuntime` 却没有提供 `-Seed`，脚本会要求该 Compose 项目的永久数据卷中已存在 Work `/data/bootstrap.json`；文件不存在时会失败，不会自行创建。

使用 `-WithRuntime` 时，`-Products` 必须包含 `work`。`-WithGitea` 会启动 `gitea` profile，缺省将 Gitea 公开于回送连接端口 `3002`。自动产生的 `ordivant-local` 服务帐号使用随机密码，该密码不会被保存或输出；具有限定权限的服务 token 与 webhook 秘密会保存在本机供 Code 使用。重复运行时，脚本会验证并保留既有凭证。若无法验证已保存的凭证，脚本会停止，不会悄悄更换凭证。

`-WithSandbox` 另外要求 Work 与 `-WithRuntime`。它会加入 `compose.sandbox.yaml`、建置固定的沙箱工作映像，并在 runtime 之前启动内部受信任的运行器。只有 `sandbox-api` 持有 Docker daemon socket；工作容器、runtime 与网页都不持有。沙箱工作以非 root 身分运行，采唯读、禁止网络及资源限制设置，每次运行使用独立且容量受限的 tmpfs 工作空间。产生的 `sandbox_service_token` 保存在项目秘密文件夹。运行控制、范本、工作流程调度、端点主机政策，以及选配的 8092 专属 `-ExecutionQaFixture`，请参阅[运行功能操作指南](execution-usage.md)。沙箱工作空间内容是暂存数据，不包含在数据卷备份中。

每个 Compose 项目会将产生的服务凭证保存在 `.data/container-secrets/<ProjectName>/`。文件夹包含 64 位十六进位数据库密码、PostgreSQL URL 文件、内部 Identity 服务 token、开发代理 token，以及 `gitea.json`（初始内容为 `{}`）。包含 Identity 在内的数据库数据卷也依 Compose 项目区分。这些文件已被 Git 忽略；请保留于本机，不要输出或发布。若要持续使用对应数据库数据卷，请安全地备份这些文件。脚本不会产生人类用户的密码。

正式环境建置使用 `ORDIVANT_MODE=production`，不提供本机工作阶段验证。明确使用 `-Seed` 仍会写入示范身分与本机 Bearer 凭证，因此只有需要示范数据时才应使用。

Docker Compose 操作失败时，脚本会附上最后 15 行输出，并屏蔽已知项目秘密、长十六进位凭证、含密码的行及 URL 中的用户信息。它不会输出完整 Docker 命令或秘密文件内容。

## Gitea 网址 {#gitea-urls}

Code 在 Compose 网络中连接至 `http://gitea:3000`。浏览器与 clone 网址使用 Gitea 设置的 `ROOT_URL`；`PUBLIC_URL_DETECTION=never` 可避免内部 API 请求将这些链接改为 `gitea:3000`。部署到其他主机时，请将 `ORDIVANT_GITEA_PUBLIC_URL` 设为预定公开的 Gitea 网址。缺省仍使用 `ORDIVANT_GITEA_PORT` 的回送网址。详见 [Gitea 官方服务器设置](https://docs.gitea.com/administration/config-cheat-sheet/#server-server)。

Work 使用各项目自己的 `/data/vcs.json` 访问既有 VCS。其 Compose 设置明确允许私人 HTTP 主机 `gitea`；其他 HTTP 主机必须加入操作者设置的 `ORDIVANT_VCS_HTTP_HOSTS` 允许清单。调用者不能通过任务或工具请求指定服务器网址。

## 企业身分代理 {#enterprise-identity-broker}

共用 Identity 服务支持直接 OIDC 连接，不需额外容器。请在「帐号与安全」中设置身分服务；每个 Compose 项目保有自己的加密设置与身分纪录。备份 Identity 数据库时，也必须保留 `identity_data/sso.key`。管理员需从精确信任的验证来源中选择正式的 `ORDIVANT_SSO_PUBLIC_ORIGIN`。

如需 SAML 或 LDAP／AD 身分联邦，可加入选配的 Keycloak 26.8.0 代理与其独立 PostgreSQL：

```powershell
.\scripts\containers.ps1 -Development -WithIdentityBroker
.\scripts\containers.ps1 -Development -Action status -WithIdentityBroker
```

代理绑定回送连接端口 `8093`；需要调整时，请在启动前覆写 `ORDIVANT_BROKER_PORT` 与 `ORDIVANT_BROKER_PUBLIC_URL`。代理没有缺省的人类管理员。请依[企业 SSO](enterprise-sso.md)的交互式 WSL tmux 步骤初始化管理员。`-WithIdentityBroker` 会设置明确的内部反向信道路由；外部 IdP 使用经验证的 HTTPS。企业私人 CA 凭证组合可挂载至容器，并通过 `ORDIVANT_SSO_CA_BUNDLE` 指定。

隔离的协定测试环境须明确启动，且不会在主要环境中初始化人类帐号：

```powershell
.\scripts\sso-containers.ps1 -Action up
uv --cache-dir .cache/uv run --project products/identity/backend --no-sync python scripts/sso_acceptance.py
uv --cache-dir .cache/uv run --project products/identity/backend --no-sync python scripts/sso_storage_acceptance.py
.\scripts\sso-containers.ps1 -Action down
```

此环境使用项目 `ordivant-sso-qa`、应用连接端口 `8092`、代理连接端口 `8093`、独立数据卷与秘密，以及两个合成 realm。产生测试数据时需要主机安装 `uv`。若这些连接端口已有服务，必须先通过该服务所属的项目辅助脚本停止。`-Action reimport` 只会在代理停止时替换产生的 QA realm，不用于实际组织身分。报告只包含检查结果与资源识别字，不包含凭证。详见 [SSO 验收](sso-validation.md)。

## 无需主机 Python 的 MCP {#mcp-without-host-python}

每个 API 映像都包含自己的 stdio MCP 服务器。设置 MCP 用户端时，使用对应项目的 Compose 文件与限定权限的 token 环境变量来运行 `docker`。主机不需要 Python 环境或 Pi runtime。例如，以下命令会转送已在用户端进程环境中设置的 token，其值不会出现在命令参数中：

```powershell
$env:ORDIVANT_SECRETS_DIR = Join-Path (Get-Location) '.data/container-secrets/ordivant-dev'
docker compose -p ordivant-dev -f compose.yaml -f compose.dev.yaml exec -T -e ORDIVANT_KNOWLEDGE_API_TOKEN knowledge-api python -m ordivant_knowledge.mcp_server
```

外部 MCP 用户端的设置需使用实际项目名称与 Compose 文件绝对路径。Work 使用 `ORDIVANT_API_TOKEN` 与 `python -m ordivant.mcp_server`；Code 使用 `ORDIVANT_CODE_API_TOKEN` 与 `python -m ordivant_code.mcp_server`。每个 Agent 应取得其产品限定权限的凭证；不要将 Gitea 服务 token 当成 Ordivant Bearer token。Knowledge 独立容器验收会完全在自己的 API 容器中使用官方 MCP SDK 与服务器。

可重现的容器检查方式，请参阅[套件容器验收](container-validation.md)、[Knowledge 独立容器验收](standalone-container-validation.md)、[Code 独立容器验收](code-standalone-validation.md)与[热重载验收](hot-reload-validation.md)。已完成的本机结果记录于[验收纪录](validation.md)。

交付时，本机开发套件使用 `5173`，其 Gitea 使用 `3002`；正式环境映像的 QA 套件使用 `8088`，其 Gitea 使用 `3003`。暂时启动的 Knowledge／Code 独立 QA 容器已在验收后停止，数据卷、秘密与报告仍予保留。这两套环境都没有部署至远程。
