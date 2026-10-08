# Compose Container Acceptance

`scripts/container_acceptance.py` checks a Compose project already started by `scripts/containers.ps1`. It does not run `up` or `down`, or delete volumes. Development acceptance briefly stops the Knowledge and Code APIs in that project to verify that Work's connection to an existing VCS does not depend on either peer. It restarts them in a `finally` block, then restarts all three APIs and confirms that their data remains readable.

## Start development mode

In PowerShell:

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
./scripts/containers.ps1 -Action up -Development -Seed -WithGitea -WithRuntime -ProjectName ordivant-dev
```

Wait until the helper reports that the project is ready, then run:

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-dev --development
```

Development mode checks Web on `5173`, Work on `8000`, Knowledge on `8010`, Code on `8020`, and the Pi runtime on `8090` by default. Compose supplies the Gitea loopback host port. Override these values with `--web-port`, `--work-port`, `--knowledge-port`, `--code-port`, `--runtime-port`, or `--gitea-port`, or the corresponding helper environment variables.

The script reads Gitea configuration from `.data/container-secrets/<project>/gitea.json` and verifies that its URL points to the Compose network address `gitea:3000`. It then captures each product's `/data/bootstrap.json` through `docker compose exec -T <product>-api python -c ...`. Credentials stay in the acceptance process memory and are passed to the existing `scripts/suite_integration.py` flow. Bootstrap data, Gitea tokens, and webhook secrets are never printed.

Development checks verify that all three APIs use PostgreSQL and development mode; Identity is connected and each product's `local-session` returns `403` through the Vite proxy and by direct API access; Knowledge immutable versions/CAS; Work delegation/review; real Gitea repository, branch, commit, pull request, status, and webhook operations in Code; the three product MCP SDKs; and Pi dispatch acceptance when Runtime is running. The script then writes the project-scoped `/data/vcs.json` to Work's data volume over standard input through `docker compose exec -T ... python -c ...`, stops the Knowledge and Code APIs, and verifies Work REST, MCP, and independent task review while the peers are stopped. The isolated environment in [sign-in acceptance](auth-validation.md) checks the full human account lifecycle.

All three APIs are restarted afterward. The script confirms that Work's accepted task, Knowledge's published version, and Code's PR binding remain available. If Runtime was not started with `-WithRuntime`, the report explicitly marks it as skipped. Start Runtime with that option to include the full runtime gate.

## Check production mode

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
./scripts/containers.ps1 -Action up -Seed -WithGitea -ProjectName ordivant-prod
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-prod
```

Production acceptance checks `/api`, `/knowledge-api`, and `/code-api` health through Web on `8088` (or `ORDIVANT_WEB_PORT`) and verifies PostgreSQL. All three `local-session` endpoints must return `403`. The script restarts the APIs, waits for proxy health to recover, and uses each product's bootstrap token to verify that the Work seed project, Knowledge primary space, and Code project remain readable. Production Compose does not expose API or Pi runtime ports by default, so this mode does not claim to cover the full cross-product flow, peer-stop, or runtime acceptance from development mode.

For full production acceptance, start the existing project with `-WithRuntime` and add `--full-flow`:

```powershell
./scripts/containers.ps1 -Action up -Seed -WithGitea -WithRuntime -ProjectName ordivant-prod
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-prod --full-flow
```

`--full-flow` checks only an already running production project; it does not run Compose `up` or `down`. It retains production health, `local-session` 403, and scoped seed reads, then runs the existing `suite_integration.py` REST/MCP/real Gitea flow through the Web proxy. It stops the Knowledge and Code APIs to verify Work REST, MCP, and existing VCS workflows without those peers. Pi Durable acceptance runs inside `work-api` in the same project: the script copies only the credential-free `scripts/integration.py` to `/tmp/ordivant-validation/` in that container. Python in the container reads bootstrap data from `/data/bootstrap.json` and connects to `http://work-api:8000` and `http://runtime:8090`; no API or runtime host port needs to be published. Finally, peer APIs are restored, all three APIs are restarted, and the script verifies that the Work task is `done`, the Knowledge document has reached at least v3, and the Code PR binding and seed data remain readable. Gitea and Pi runtime services must already be running in the project.

## Reports and recovery

Each run writes credential-free results to `.data/validation/containers-<project>-<timestamp>-<id>/report.json`. Development peer APIs are restored in `finally`. If `peer_restore` is not `passed`, run `scripts/containers.ps1 -Action status -Development -WithGitea -WithRuntime -ProjectName <project>` for that project only. Check its status, then use the helper's `up` action to restore stopped services. Do not operate on another Compose project or use `down -v`.
