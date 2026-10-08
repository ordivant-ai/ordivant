# Ordivant development rules

Ordivant is an enterprise project management and collaboration platform for agents.

## Scope and ownership

- Stack: uv-managed Python/FastAPI, React/TypeScript/Ant Design, PostgreSQL, Node.js/Pi Durable.
- The PM owns architectural decisions, shared contracts, root tooling, integration, and final acceptance.
- Workers must read `docs/contracts.md` and `docs/project-plan.md` before implementation.
- Workers only edit the files explicitly assigned to them. Do not revert others' work. Raise contract changes to the PM before changing them.
- Deliver working code with meaningful acceptance checks. Report changed files, commands and outcomes, and blockers.
- Work locally. Publication, pushing, deployment and messaging outside this agent team need explicit user authorization.
- User passwords must be entered by the user in an interactive tmux session, preferably WSL on Windows. Never request or handle passwords in chat, code, environment variables, files or logs.

## Engineering

- All business authorization belongs in the Python service. REST and MCP share the same service methods.
- A task and an execution are different records. A completion requires evidence and an authorized independent review.
- Claims use atomic conditional writes; leases use fencing tokens. Check dependencies and prevent cycles.
- Mutating agent operations accept idempotency keys; outbox and business state commit in the same transaction.
- Pi owns execution transcripts, not business task state. One process owns each Pi storage file.
- Never present demo execution or self-reported cost as a verified paid model run.
- No fabricated data fallback when an API request fails. Demo seed data must be clearly marked.
- User-facing copy is Traditional Chinese with useful English identifiers retained.
- Python commands use `uv`. Put uv/npm caches under `.cache/` when default caches are inaccessible.
- Tests should cover risks: concurrent claims, expiry, cross-project access, dependency cycles, idempotency, review separation, restart recovery, and the collaboration round trip.
