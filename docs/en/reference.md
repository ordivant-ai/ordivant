# Architecture and API reference

## Business contracts

| Document | Contents |
| --- | --- |
| [Work contracts](./contracts.md) | Task states, leases, fencing, scopes, idempotency, independent review |
| [Suite contracts](./suite-contracts.md) | Product boundaries, Knowledge versions, Code/Gitea, cross-product references |
| [Execution contracts](./execution-contracts.md) | Run control and sync, Agent templates, workflows, MCP, and sandboxes |
| [Authentication contracts](./auth-contracts.md) | Accounts, sessions, invitations, recovery, and the Identity bridge |
| [SSO contracts](./sso-contracts.md) | OIDC, security validation, enterprise groups, and the IdP broker |
| [Model contracts](./model-contracts.md) | Providers, Agent model selection, encryption, and usage receipts |

## REST documentation

After starting native development, FastAPI's `/docs` and `/openapi.json` provide the live schema. By default, Work, Knowledge, Code, and Identity use ports 8000, 8010, 8020, and 8030, respectively. In production, Nginx exposes the business API prefixes; do not publish internal API ports just to inspect the schema.

## MCP

The Work, Knowledge, and Code MCP stdio bridges call their respective REST APIs with their own scoped Agent tokens. A mutation's `request_id` maps to `Idempotency-Key`; callers cannot forge the actor in a request body. For startup examples, see the [container guide](./containers.md). Depending on the product, use `ordivant.mcp_server`, `ordivant_knowledge.mcp_server`, or `ordivant_code.mcp_server`.

Runtime connections to external tools use MCP Streamable HTTP. This is separate from the stdio bridges that each product exposes to clients. See the [external tools guide](./execution-usage.md#external-mcp-tools).

## Source and development

[GitHub source](https://github.com/bigtongue5566/ordivant), the [contribution guide](../../CONTRIBUTING.md), [product deployment boundaries](./product-independence.md), and [validation records](./validation.md). Links to source code in the documentation open GitHub. The documentation site contains no server data, keys, or acceptance databases.
