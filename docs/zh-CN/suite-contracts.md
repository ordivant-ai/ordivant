# Ordivant Suite 契约（修订日期：2026-10-06） {#ordivant-suite-contract-—-revised-2026-10-06}

重新阅读规划对话后确认的用户决策：Work、Knowledge 与 Code 是同一 monorepo 中各自独立的产品。每个产品都能单独部署、拥有自己的数据库，并提供 API + MCP。Code 是选配，使用开源 Gitea 作为独立 Git 服务。Work 必须能在 Code 未启动时运作，并接受企业现有版本控制系统的参照。Pi Durable 属于 Work。

## 代码责任与部署边界 {#code-ownership-and-deploy-boundaries}

- `backend/`：Ordivant Work FastAPI／SQLAlchemy／MCP（保留既有代码）。
- `runtime/`：Work 的 Pi Durable Runtime（保留既有代码）。
- `products/knowledge/backend/`：独立 uv 项目与 Python 套件 `ordivant_knowledge`，拥有自己的 SQLAlchemy engine／models／auth／seed 与 MCP。
- `products/code/backend/`：独立 uv 项目与 Python 套件 `ordivant_code`，拥有自己的 SQLAlchemy engine／models／auth／seed 与 MCP；Gitea adapter 仅能通过 HTTP API／webhook 通信。
- `frontend/`：共用 React 原代码；产品模块与可分开建置的 Work／Knowledge／Code 成品。可共用视觉组件，不可共用私有业务状态。
- `scripts/`、根目录设置与 `docs/` 由 PM 负责。未经 PM 核准，Worker 不可修改指派模块以外的文件。

不可导入其他产品的 ORM、session、业务套件或数据库。产品之间通过公开识别码、HTTP API 与明确参照链接。Code 或 Knowledge 服务无法使用时，不得阻止 Work 启动。

## 共用公开惯例 {#shared-public-conventions}

所有 API 都使用 `/api`、JSON 资源对象或数组、ISO-8601 UTC 时间戳记，以及 `docs/contracts.md` 中定义的领域错误格式。每个产品都有自己的 bearer 凭证，并各自强制检查 scope。`POST /api/auth/local-session` 只允许 loopback + 明确的 development 模式；`GET /api/me` 公开操作者中继数据。Token 以哈希形式保存；API 清单、稽核、缓存或 UI bundle 均不可包含 bearer 凭证。

Idempotency-Key 依实际路由 + 目前操作者 + 请求本文限定范围。本文不同会产生冲突。重播缓存回应时重新检查目前授权。业务状态与稽核／幂等记录以原子方式 commit。PostgreSQL URL 通过 psycopg 支持；SQLite 为快速入门模式。SQLite 写入串行化与 PostgreSQL row locking 用来保护版本／审查／并行转换。

Development seed 须明确运行且可重复；在各产品自己的数据目录创建 `bootstrap.json`。结构为 `{manager_token,writer_token,reader_token,manager_id,writer_id,reader_id,organization_id,primary_scope_id,isolated_scope_id}`；这些都是本机产生的凭证。Manager 拥有两个 Seed scope；writer 与 reader 只能看到主要 scope。Principal 为 `{id,name,kind,role,organization_id,scope_ids:string[]}`。之后可使用共用企业 issuer／subject 将身分对应至多个产品；但每个产品仍各自运行授权。

不处理人类密码，也不提示输入凭证。Gitea 测试凭证仅由服务为自有本机测试 instance 产生；用户提供的密码必须遵守用户的 tmux 规则。

## Knowledge API（连接端口 8010）{#knowledge-api-port-8010}

环境设置：`ORDIVANT_KNOWLEDGE_DATA_DIR` 默认为 repo `/.data/knowledge`；`ORDIVANT_KNOWLEDGE_DATABASE_URL` 为选填；`ORDIVANT_MODE` 严格限制为 development／production。进入点为 `python -m ordivant_knowledge.seed`、`uvicorn ordivant_knowledge.main:app` 与 `python -m ordivant_knowledge.mcp_server`。

`GET /api/health` -> `{status:"ok",product:"knowledge",database,mode}`。

`Space`: `{id,key,name,description,organization_id,created_at}`.
`Document`: `{id,space_id,title,summary,tags:string[],current_version:number,created_at,updated_at}`.
`Version`：`{id,document_id,version:number,title,body,change_summary,author_id,content_sha256,source_refs:Reference[],created_at,uri}`。已持久化的版本不可变。`DocumentContext`：`{document,version,history:Version[],decisions:Decision[]}`。
`Reference`：`{product:"work"|"knowledge"|"code"|"external",kind:"task"|"document_version"|"pull_request"|"test_report"|"url",uri,title}`。链接代表参照，不代表已授权访问目的地。
`Decision`: `{id,space_id,document_id:string|null,title,body,source_refs:Reference[],actor_id,created_at}`.

- `GET/POST /api/spaces`；只有 manager 可用 `{key,name,description?}` 创建 space。
- `GET /api/spaces/{id}` 会强制检查 scope。
- `GET /api/documents?space_id=&q=&tag=` 会依范围提供中继数据／搜索。搜索标题／本文；结果指出版本与引用 URI（允许回传 `snippet?`、`uri?`、`version?` 等额外中继数据）。
- `POST /api/documents` `{space_id,title,summary?,body,tags?:[],change_summary?,source_refs?:[]}` 会以原子方式创建 document + 不可变的 version 1，并回传 DocumentContext。只有 scope 内的 manager／writer 可操作。
- `GET /api/documents/{id}` -> 最新版本的 DocumentContext。
- `GET /api/documents/{id}/versions` -> Version[]；`GET /api/documents/{id}/versions/{n}` -> 精确 Version。
- `POST /api/documents/{id}/versions` `{expected_version,title?,body,change_summary,source_refs?:[]}` 使用 compare-and-swap 比对目前版本，并回传新建的 Version；expected_version 过期时回传 409。本文不可为空白。更新后旧版本必须完全不变。
- `GET/POST /api/decisions?space_id=`；创建本文 `{space_id,document_id?,title,body,source_refs?:[]}`。Document 必须属于同一个已授权 space。
- `GET /api/events?space_id=` 回传范围内的稽核清单。

标准引用为 `ordivant://knowledge/spaces/{space_id}/documents/{document_id}/versions/{n}`。本试行版不提供假 embeddings／RAG：使用实际持久化文本搜索，并明确标示为文本搜索。

MCP 环境变量为 `ORDIVANT_KNOWLEDGE_API_URL`、`ORDIVANT_KNOWLEDGE_API_TOKEN`。官方 SDK stdio bridge 工具：`list_spaces`、`search_knowledge`、`create_document`、`get_document_context`、`get_document_version`、`publish_document_version`、`record_decision`、`list_decisions`；变更操作可选择提供 request_id，并对应为 Idempotency-Key。提供精确版本 resources 与 context citation prompt。工具不接受调用端提供操作者身分。

Knowledge 验收：writer 创建 v1；并行发布 v2 时只有一个成功，另一个回传 409；v1 本文／hash 维持不变；重复发布不会创建 v3；文本搜索回传目前内容 + 精确引用；reader 不可写入；隔离 space 访问会遭拒；保留 task／PR 来源脉络；进程重新启动后数据仍持久化；实际运行 SDK 往返流程。

## Code API（连接端口 8020）{#code-api-port-8020}

环境设置：`ORDIVANT_CODE_DATA_DIR` 默认为 repo `/.data/code`；`ORDIVANT_CODE_DATABASE_URL` 为选填；可设置 `ORDIVANT_CODE_GITEA_URL`、`ORDIVANT_CODE_GITEA_TOKEN`、`ORDIVANT_CODE_WEBHOOK_SECRET`，或使用被忽略的 JSON `ORDIVANT_CODE_GITEA_CONFIG`，内容为 `{url,token,webhook_secret}`。进入点为 `python -m ordivant_code.seed`、`uvicorn ordivant_code.main:app`、`python -m ordivant_code.mcp_server`。

`GET /api/health` -> `{status:"ok",product:"code",database,mode,gitea_configured:boolean}`。Health 不发出网络调用，也不含凭证。未设置 Gitea 时仍可读取既有中继数据；需要 Gitea 的操作回传 503 `gitea_not_configured`。

`CodeProject`: `{id,key,name,description,organization_id,created_at}`.
`Repository`: `{id,project_id,provider:"gitea",owner,name,default_branch,web_url,clone_url,created_at}`.
`PullRequest`：`{id,repository_id,number,title,body,state:"open"|"closed",head,base,web_url,head_sha,source_refs:Reference[],created_at,updated_at}`。Git／PR 状态以 Gitea 为准。平台只保存范围内的参照与收据，不会另外实作一套 Git。
`Check`：`{id,repository_id,commit_sha,context,state:"pending"|"success"|"failure"|"error",description,target_url:string|null,source:"agent_reported"|"gitea_webhook",actor_id,created_at}`。Agent 回报会明确标示来源；不可暗示 CI runner 实际运行过测试。

- `GET/POST /api/projects` 与 `GET /api/projects/{id}` 会强制检查 scope；创建仅限 manager。
- `GET /api/repositories?project_id=` -> 本机授权范围内的 repository 清单。
- `POST /api/repositories` `{project_id,name,description?,private?:true}` 使用已设置的 Gitea service account 创建 repo、自动初始化 README 与 main branch，接着保存 binding。回应遗失后重试时，必须以确定的 owner／name 查找并调和；除非明确的 manager binding 操作已验证权限，否则拒绝接管未记录的既有 repository。全域账号权限不能扩大 Code 项目权限。
- `POST /api/repositories/{id}/branches` `{name,from_branch?:"main"}` 会创建实际 Gitea branch。验证 branch／path 输入与 manager／writer scope。同一请求具幂等性；回传 `{name,commit_sha}`。
- `POST /api/repositories/{id}/files` `{branch,path,content,commit_message,expected_sha?:string}` 调用实际的 Gitea Contents API，content 由 UTF-8 转为 base64；创建／更新操作以现有 sha 防护。回传 `{path,branch,commit_sha,file_sha}`。回应遗失后重试时，须调和预期内容／commit 或保存持久化意图；相同 Idempotency-Key 绝不可默默产生重复 commit。
- `GET /api/repositories/{id}/pulls` -> PullRequest[]（若已设置 Gitea，会刷新）；`POST /api/repositories/{id}/pulls` `{head,base?:"main",title,body?,source_refs?:[]}` 调用实际 Gitea PR，并回传范围内的 PullRequest。创建前以稳定的 head／base 调和重复请求／回应遗失后重试。
- `GET /api/repositories/{id}/pulls/{number}` -> PR，并附上 `checks:Check[]` 与 source_refs。
- `POST /api/repositories/{id}/checks` `{commit_sha,context,state,description?,target_url?}` 回报实际 Gitea commit status，并持久化明确标示为 agent_reported 的收据。Reader 不能写入，references 不能扩大访问权。
- `POST /api/webhooks/gitea` 接受原始 JSON；在解析 JSON 前，以原始 bytes 与设置 secret 验证 `X-Gitea-Signature` HMAC-SHA256；依 `X-Gitea-Delivery` 去重，且本文变更时拒绝重播。只更新 owner／name 完全相符的已绑定 repository。受信任 webhook 可同步 push／pull request 收据中继数据；绝不可核准 Work task 或合并 PR。
- `GET /api/events?project_id=` 回传范围内的稽核数据。

此试行版本不提供 merge／delete 操作。写入 API 只操作明确选取且受 scope 限制的 binding。Service account 的 Gitea token 绝不回传给用户端。Gitea API 仍会强制运行其实际权限；不可宣称单一本机试行账号已实现最终企业级逐 Agent ACL 同步。

MCP 环境变量为 `ORDIVANT_CODE_API_URL`、`ORDIVANT_CODE_API_TOKEN`。官方 SDK stdio bridge 工具：`list_code_projects`、`list_repositories`、`create_repository`、`create_branch`、`commit_file`、`create_pull_request`、`get_pull_request`、`report_check`、`get_code_events`；变更操作中的 request_id -> Idempotency-Key。提供 PR context resources。

Code 验收：使用自有本机开源 Gitea instance；创建 private repo、branch、实际文件 commit、PR 与 status，再读取同一个 PR；重复调用不会创建额外对象／commit；拒绝伪造 webhook，并对已签署 delivery 去重；拒绝 reader／隔离项目的访问；缺少 Gitea 不妨碍启动；回应／稽核／缓存不含原始上游 token／secret；实际运行 SDK 往返流程。不可将 CI 收据描述成真的 CI 测试运行结果。

## Frontend 模块与独立性 {#frontend-modules-and-independence}

添加清楚的 Work／Knowledge／Code 产品切换器；Work 品牌名称显示 Ordivant Work。保留已完成的 Work 接口。`/`、`/work` -> Work；`/knowledge` -> Knowledge 工作区；`/code` -> Code 工作区。每个产品只初始化自己的 session／API，即使其他产品停止也能运作。Vite 将 Work `/api`、Knowledge `/knowledge-api` -> port 8010 `/api`、Code `/code-api` -> port 8020 `/api`（target 可设置）。独立的 `work`、`knowledge`、`code` build mode 可输出不同成品；standalone mode 可在 `/` 选定产品，并设置自己的 API prefix。

Knowledge 接口：space 选择器、搜索／列出文档、精确版本选择器、安全且易读的 Markdown／本文、创建／发布（附 expected version 与冲突错误）、不可变版本历程、决策／来源脉络。Code 接口：项目／repository、明确显示已设置／未设置状态、创建 repository／branch／commit／PR、读取 PR／checks，并明确标示回报的 status 为自我回报。提供各自独立的 local-session 与手动 token fallback。不可内嵌服务凭证。采清晰克制且一致的设计、支持响应式版面并显示真实 API 错误；除非有助于操作，否则产品 UI 不提内部实作细节。

## 集成验收与范围 {#integrated-acceptance-and-scope}

Knowledge v1 -> 带有精确版本 artifact／reference 的 Work task -> Agent A 委派给 B -> Code 创建自有本机 Git branch／commit／PR，并引用 Work + Knowledge -> 记录测试证据／status -> 独立 reviewer 接受 Work 证据 -> Knowledge 发布引用 task／PR 的 v2。每个产品都提供自己的 MCP。另须在两个 peer 都停止时测试 Work，并参照既有 GitHub／GitLab／通用 VCS；此时仍必须完成一般工作流程。即时企业 VCS 凭证／SSO 与付费模型须作为另外设置的验收项目，不得捏造测试结果。
