# Ordivant implementation plan

Source: the user's planning chat, re-read after the user's scope change on 2026-10-06. Product: **Ordivant Suite**, with Work / Knowledge / Code in one monorepo and independent deployment boundaries. Code uses Gitea open-source as an optional service; Work operates with existing enterprise VCS and does not require Code. Stack: uv/Python, React, Pi Durable (Work only), PostgreSQL.

Status snapshot (2026-10-08): native accounts, organization/Agent model settings and enterprise SSO remain complete for the local Suite. This revision delivers the Work Run console, immutable Agent/workflow templates, durable interval workflows, bounded external MCP tools and per-run Docker sandboxes. Identity/Work/Knowledge/Code have 28/41/10/20 passing tests; Runtime has 25 and sandbox has 3. Actual acceptance includes 53 full container checks, 20 authorized gpt-6.1-sol checks, 16 receipt/credential checks, 9 terminal cleanup checks, 8 PostgreSQL concurrency checks, 67 Docker isolation checks plus 2 crash-recovery checks, and 65 desktop/mobile browser checks. Development `5173` and local production mode `8088` are ready, with 40 preservation/readiness checks and healthy databases/Gitea. Isolated execution and earlier SSO QA containers were removed with named volumes retained. The user creates their own first administrator; main accounts, SSO and existing model/provider settings were preserved. `docs/execution-contracts.md` governs this revision; `docs/sso-contracts.md` continues to govern enterprise identity. See their validation records and `docs/validation.md` for evidence and remaining customer-specific gates.

The original acceptance criteria below remain the Work module gates. The current product scope, endpoint contracts and integrated suite acceptance are defined in `docs/suite-contracts.md`, which takes precedence for the expanded product work.

## Delivery: v0.1 Suite local pilot

One organization, two teams and multiple agents, with scoped project access. Deliver runnable Work, Knowledge and Code modules, not static mockups. SQLite is an explicitly documented quick-start mode; PostgreSQL is supported through each product's SQLAlchemy layer. Products do not read each other's databases. Pi storage is isolated per Work runtime process. Shared Identity supports standard OIDC and an optional Keycloak SAML/LDAP/AD broker. Real Keycloak OIDC and signed SAML integration are verified; each customer's identity tenant, directory and existing enterprise VCS credentials require separate configuration and acceptance.

## Acceptance criteria

1. Create and inspect projects, structured tasks, dependencies, agents and evidence in a connected React workspace.
2. Two concurrent claim attempts have exactly one winner. Expired executions cannot change progress or submit results after a new claim.
3. Blocked dependencies cannot be claimed, cycles are rejected, accepted results unlock successors.
4. Agent A requests help from B, B receives and replies or executes a delegated task, A receives the response and continues, reviewer C accepts the result.
5. Duplicate mutations and deliveries do not duplicate tasks, executions, messages or artifacts.
6. REST and MCP enforce the same identity/project/role policies. Agents cannot impersonate others; executing agents cannot approve their own work.
7. Audit records and execution history survive backend restarts. Pi Durable persistence/resumption is exercised with deterministic fixtures; configured live-model tool execution, secret-free receipts and restart persistence are separately exercised with the user-authorized test provider.
8. UI shows errors/loading/empty states, works on a small viewport, and uses real API data. Users can create, inspect, collaborate and review.
9. Installation, startup, MCP connection, credentials, data backup and limitations are documented. Lockfiles, validation results and an updated task ledger accompany delivery.

## Task ledger

| ID | Owner | Deliverable | Status |
|---|---|---|---|
| ORD-001 | PM | Architecture, contracts, scope and acceptance plan | Done |
| ORD-002 | luna-backend | Work persistence, identity/RBAC, tasks, leases, collaboration, evidence, audit and MCP | Complete; 19 unit tests and REST/MCP/PostgreSQL acceptance passed |
| ORD-003 | luna-frontend | Work operator workspace, task board/inspector, agents, collaboration, evidence and reviews | Complete; typecheck/build, browser project/task creation and 390px spec editing passed; collaboration/review APIs passed |
| ORD-004 | luna-runtime | Pi Durable adapter, durable dispatch, scoped platform tools and recovery | Complete; 2 unit tests and actual Harness/outbox/restart validation passed |
| ORD-005 | PM | Local runner, seed workflow, environment/docs, integration and browser/API validation | Complete; native and container integration, production full flow and connected Work/Knowledge/Code browser checks passed |
| ORD-006 | luna-runtime | Independent Knowledge backend: immutable versions, search, decisions, provenance, API/MCP | Complete; 5 unit tests, integrated version/CAS flow and Knowledge-only container acceptance passed |
| ORD-007 | luna-backend | Independent Code backend: Gitea repositories/branches/commits/PR/checks, signed webhooks, API/MCP | Complete; 15 unit tests, real-Gitea integration and Code-only production acceptance passed |
| ORD-008 | luna-frontend | Suite navigation and independently buildable Knowledge / Code workspaces | Complete; all four builds, real product browser flows, public Gitea URLs, provenance selection and 390px form checks passed |
| ORD-009 | PM | Independent API/MCP startup and real-Gitea SQLite/PostgreSQL suite acceptance | Complete; both suite reports and standalone Work PostgreSQL report passed |
| ORD-010 | PM | Compose integration and development/production images for frontend, APIs and runtime | Complete; six application images including Identity, dev/prod full-flow, independent Knowledge/Code deployment and persistence checks passed |
| ORD-011 | luna-runtime | Container worker helper, runtime startup/readiness integration and operator documentation | Complete; both helpers start; all five source reload predicates and byte-exact restoration passed, including TypeScript polling on Windows bind mounts |
| ORD-012 | luna-backend | Backend container QA: dev proxy authentication, production access controls and 403 cases | Dev proxy authentication/direct 403 and production local 403/scoped reads passed |
| ORD-013 | luna-reload-qa | Reproducible five-source development hot-reload acceptance | Complete; all API worker PIDs, Pi compiled output/server PID, Vite source/HMR and restored SHA-256 checks passed |
| ORD-014 | luna-production-qa / PM | Production full-flow acceptance through Nginx with internal Pi runtime | Complete; Suite/Git/MCP/Pi, local-session 403, Work without peers and restart persistence passed |
| ORD-015 | luna-code-standalone / luna-identity-bridge | Code-only deployment without Gitea and scoped official MCP checks | Complete; Code API/PostgreSQL/web plus Identity API/PostgreSQL, explicit Gitea 503, nine MCP tools, scope and restart checks passed |
| ORD-016 | luna-identity | Independent Identity API/database: accounts, password login, invitations, recovery, sessions and admin controls | Complete; 11 security tests, lock/wheel/build checks and real HTTP lifecycle acceptance passed |
| ORD-017 | luna-identity-bridge | Shared human authentication with independent product principals, scope grants, CSRF/Origin and bearer compatibility | Complete; five bridge tests per product, 55-check dev/prod acceptance and five-service standalone deployments passed |
| ORD-018 | luna-login-ui / PM | Native login/setup, invitation/recovery, account/session management, admin permissions and mouse-operated dropdowns | Complete; four product builds, real mouse product/status/priority/scope selection and 390px account/logout checks passed |
| ORD-019 | PM | Identity Compose/native tooling, contract/docs, isolated authentication acceptance and business regression | Complete; dev/prod ready, 55 HTTP checks per mode, production REST/MCP/Git/Pi regression, user first-admin page and QA cleanup verified |
| ORD-020 | luna-model-backend | Organization model connections, encrypted credentials, Agent inheritance/override, fenced scoped runtime handoff | Complete; Work 31 tests, revision/RBAC/error redaction/key retention/null snapshot checks and isolated cookie HTTP acceptance passed |
| ORD-021 | luna-model-runtime | Configured Pi Responses provider, actual model/usage/tool receipts, two lease heartbeats and credential recovery | Complete; 5 tests with actual Pi adapter; real gpt-6.1-sol platform tool run, usage breakdown and completed receipt restart passed |
| ORD-022 | luna-model-ui | Administrator model settings and Agent create/edit model selection | Complete; four builds, actual mouse settings save/create/edit/reload and 390px popup/persistence passed |
| ORD-023 | PM | Model contracts/operator import, container integration, live endpoint/tool/review acceptance and documentation | Complete; development/live plus production DEMO regression, key/temporary-token record checks and isolated QA cleanup; details in model-validation.md |
| ORD-024 | luna-sso-backend | Enterprise OIDC, encrypted configuration, scoped provisioning/group grants, lifecycle revocation and audit | Complete; 28 security tests, lock/compile checks and real protocol/lifecycle acceptance passed |
| ORD-025 | luna-sso-ui | Shared enterprise login, provider templates, policy/linking and audit administration | Complete; six provider templates, TypeScript/four builds, actual desktop/390px mouse checks, immediate status refresh, SSO-only recovery and administrator-only scope creation passed |
| ORD-026 | luna-sso-qa / PM | Real Keycloak OIDC and SAML broker, isolated PostgreSQL/browser acceptance, container integration and operator docs | Complete; 136 real HTTP checks, 27 storage/log/restart checks, OIDC/SAML browser acceptance, main-environment readiness and isolated QA cleanup; see sso-validation.md |
| ORD-027 | luna-run-backend | Authorized Run projection/control, immutable Agent/workflow templates, durable scheduler and project tool/profile configuration | Complete; 41 business/security tests and 8 actual PostgreSQL concurrency checks; REST/MCP share business authorization |
| ORD-028 | luna-run-runtime | Actual Pi event/control gates, bounded external MCP tools and isolated Docker executor | Complete; 25 Runtime and 3 sandbox tests, real model/tool receipts, 67 actual executor checks, 2 crash-recovery checks and cleanup-before-terminal-sync regression |
| ORD-029 | luna-run-ui | Run inspector/controls, versioned automation editors and tool/sandbox administration | Complete; TypeScript/four product builds and 65 actual desktop/mobile mouse checks, including server reply-loss retry and actual receipt/stdout/exit 0/7 |
| ORD-030 | PM | Shared contracts, sandbox Compose/helpers and local API/container/mouse acceptance | Complete; full container 53, live 20, credential 16, final cleanup 9 and main preservation/readiness 40 checks passed; both local environments updated and owned QA removed; see execution-validation.md |

## Architecture decisions

- FastAPI service is the source of truth for business state. SQLAlchemy supports SQLite for local quick-start and PostgreSQL for pilot hosting.
- Public REST prefix `/api`. MCP served separately over stdio (client HTTP bridge with an agent credential); streamable HTTP can be added without duplicating business logic.
- Human authentication uses the independent Identity service: password login, invitation, recovery and server-managed cookie sessions in both modes. Agent REST/MCP uses independently issued opaque tokens hashed at rest. Configured Identity disables old local-session endpoints in both modes; see `auth-contracts.md`.
- Enterprise identity uses one configurable OIDC provider per organization environment, Authorization Code + PKCE, exact subject links, invited/JIT membership and explicit resource/group grants. SSO never derives an administrator role from provider claims. SAML and LDAP/AD use the optional Keycloak broker; see `sso-contracts.md`.
- All agent mutations record actor identity from authentication, never from an untrusted body field. All objects are filtered by allowed projects and organization.
- Leases have execution id plus an unguessable fencing token. Every executing mutation verifies both ownership and non-expiry.
- Workflow: `backlog`, `ready`, `in_progress`, `blocked`, `in_review`, `done`, `cancelled`.
- Accepted review is the only normal transition to done. Assignment does not grant project access.
- Outbox events are persisted atomically and claimable by a runtime worker. Runtime request ids equal outbox ids; callbacks are idempotent.
- A single runtime owns its Pi SQLite storage. Configured model/provider identity is explicit; deterministic demo mode is separate and visibly labeled.

## Interface design

Visual thesis: a calm, precise operational workspace with warm neutral surfaces, graphite navigation, violet actions and compact readable task information.
Content plan: project/task workspace is primary; navigation is secondary; task inspector shows structured spec, executions, collaboration and review evidence.
Interaction thesis: fast view transitions, restrained drawer/modal entrances, and clear hover/focus affordances; respect reduced motion.

## Expanded Suite gates

- Knowledge publishes immutable exact-version specifications and decisions; text retrieval returns traceable citations.
- Code calls real Gitea APIs for repository/branch/commit/PR/status and validates signed deduplicated webhooks.
- Each product has its own scoped identity, database, REST API and MCP entry point.
- Frontend product modes can be built/deployed separately, and Work operates with both peers stopped.
- Full provenance chain: Knowledge v1 -> Work task/delegation -> Code PR/evidence -> Work review -> Knowledge v2.

## Public release handoff (2026-10-08)

The public repository is `bigtongue5566/ordivant`, licensed under MIT. The VitePress documentation site includes installation, product guides, operations, troubleshooting and API contracts. Public CI checks the five Python projects, Runtime, four frontend modes and synthetic REST/MCP integration; Pages builds and validates local links. Paid acceptance requires explicit operator configuration and isolated QA; no private provider or automatic main-environment credential lookup ships as a default.

The release source was exported from the Git index into a clean directory and started with a new Compose project. All 12 services became healthy, and actual Knowledge/Work/Gitea/MCP/Pi DEMO, independent review, peer isolation and restart persistence passed. Gitleaks scanned the source export without detecting secrets. Historical ignored QA reports are not distributed. Remaining enterprise gates below are intentionally open; they do not block the declared v0.1 scope.

## Remaining enterprise gates

Feature candidates, current implementation boundaries and proposed priorities are recorded in [feature gap research](feature-gap-research.md). This research does not mark candidate features as implemented or add them to the completed task ledger.

- Customer-specific IdP tenant and LDAP/AD directory acceptance; SCIM 2.0 and automated offboarding. Native SAML endpoints are separate from the verified Keycloak SAML broker.
- Additional production provider/model combinations, verified rates/invoice integration and hard cost ceilings. The user-authorized 測試 Provider／gpt-6.1-sol synthetic live run and token receipts are recorded in `model-validation.md`; that does not establish general billing controls.
- Live existing GitHub/GitLab/Jira synchronization credentials, MCP gateway, external A2A, object storage and backup restore exercises.
- Scaled dispatch ownership/partitioning, load tests and operational monitoring.

Do not mark these gates complete merely because an interface or placeholder exists.

## Internationalization delivery (2026-10-08)

The application and public documentation now support Traditional Chinese (`zh-TW`), Simplified Chinese (`zh-CN`) and English (`en`). Shared navigation persists the browser preference across products and tabs. Application copy, Ant Design widgets, dates, numbers and API error projections follow the selected language; user-authored content and API identifiers are preserved. Open forms retain drafts, and existing validation errors are revalidated when the locale changes.

Acceptance: 1,247 catalog messages with parity/interpolation/source-copy checks and seven locale behavior checks; all four frontend build targets; 121 isolated browser checks across Identity, Work, Knowledge, Code and mobile layouts; 46 documentation browser checks; 109 generated HTML pages (36 articles per language plus 404), 5,030 checked local references, zero link errors. Browser reports remain in ignored `.data/validation/`. No paid model calls are needed for these interface checks. See [language and translation](i18n.md) for maintenance and repeatable commands.
