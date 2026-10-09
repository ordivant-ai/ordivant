<span id="路線圖與功能邊界"></span>
<span id="路线图与功能边界"></span>

# Roadmap and feature boundaries

This page describes v0.1 capabilities and future candidates; it does not promise delivery dates. Discuss requirements and implementation through [GitHub Issues](https://github.com/ordivant-ai/ordivant/issues).

<span id="v0-1-已交付"></span>

## Delivered in v0.1

- Work task collaboration, independent review, scope, leases, idempotency, Run events, and controls.
- Immutable Agent and workflow templates, DAG dependencies, and manual or minute-interval scheduling.
- MCP Streamable HTTP tools and Bearer authentication; Docker job sandboxes with networking disabled.
- Knowledge document versions, text search, decisions, and precise citations.
- Optional Code/Gitea and a restricted read adapter for existing Git providers.
- Native human sign-in, enterprise OIDC, and an optional Keycloak SAML / LDAP broker.

<span id="優先候選"></span>
<span id="优先候选"></span>

## Candidates for future work

| Area | Current boundary |
| --- | --- |
| Pre-execution approval | Independent review of results is available; there is no complete pre-approval policy for tool side effects. |
| Token and cost governance | Per-response output, turn, and timeout limits plus usage receipts are available; trusted rates and a hard total-cost budget are not. |
| Notifications and CI | Events and status receipts are available; notification integrations and a built-in external CI runner are not. |
| Enterprise lifecycle | OIDC groups and account disabling can revoke access; SCIM and validation against customer directories remain to be developed or configured. |
| Tool interoperability | Bearer MCP is available; interactive MCP OAuth, a stdio launcher, and A2A are not. |
| Knowledge ingestion | Text versions and retrieval are available; document parsing, embeddings/RAG, and batch source synchronization are not. |
| Isolation and scale | Docker uses a shared kernel, networking is disabled, and one Pi storage writer is supported; VM isolation, distributed dispatch, and large-scale load testing are not. |

See [feature gap research](./feature-gap-research.md) for more design context. Public CI verifies reproducible offline and synthetic tests. Acceptance against a paid provider requires explicit operator configuration and incurs usage on that provider.
