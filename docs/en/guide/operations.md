<span id="維運與備份"></span>
<span id="运维与备份"></span>

# Operations and backups

The lifecycle of local and container services is managed by `scripts/containers.ps1`. Use a stable `-ProjectName` from the first run; the helper uses it to isolate the Compose project, named volumes, and `.data/container-secrets/<ProjectName>`. When starting from another clone, specify the same name to find the existing data.

<span id="服務狀態與更新"></span>
<span id="服务状态与更新"></span>

## Service status and updates

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action status
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action logs -WithRuntime -WithGitea -WithSandbox
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev
```

Always call the helper with the same development/production mode and project name. When using `logs`, include any optional profile flags for the services you want to inspect. `down` includes optional profiles and stops that Compose project. It preserves volumes and secret files; it is not a backup. Removing the Compose project volumes permanently deletes that project's data.

The development Web service binds to loopback port `5173` by default, and Gitea uses `3002`. Set `ORDIVANT_DEV_WEB_PORT` and `ORDIVANT_GITEA_PORT`, respectively, to avoid host port conflicts. The development helper also binds API ports to loopback by default. Production Web uses `8088`; configure an HTTPS reverse proxy, canonical origin, and secure cookies before exposing it.

<span id="需要備份的資料"></span>
<span id="需要备份的数据"></span>

## Data to back up

For backups, use the Compose project label to find every volume for the environment. Preserve each product's database and data volume as a set. A typical full set includes:

| Area | Compose volumes / host files | Contents |
|---|---|---|
| Identity | `identity_postgres`, `identity_data` | People, sessions, SSO settings, and `sso.key` |
| Work | `work_postgres`, `work_data` | Work tasks, Agents, Runs, Runtime state, and `model-settings.key` |
| Knowledge | `knowledge_postgres`, `knowledge_data` | Spaces, document versions, decisions, and scope data |
| Code | `code_postgres`, `code_data` | Code scopes, repository bindings, PRs, and status receipts |
| Gitea (if enabled) | `gitea_data` | Actual Git data for repositories, branches, commits, and PRs |
| Keycloak broker (if enabled) | `identity_broker_postgres` | Broker realm and connection settings |
| Compose secrets | `.data/container-secrets/<ProjectName>/` | Database password/URL, internal service tokens, Gitea, and other service settings |

The actual volume list depends on the enabled products and profiles. Work's `model-settings.key` decrypts model and MCP tool-connection settings; Identity's `sso.key` decrypts enterprise IdP settings. Back up encryption keys with their corresponding databases and data volumes. Do not replace a key by itself, or existing ciphertext cannot be decrypted. Pi Runtime state is in the Work data volume. A sandbox workspace is temporary and is not a place to store results.

Use the project label with Docker Desktop or Docker CLI to find the actual volume names created for this environment:

```powershell
docker volume ls --filter "label=com.docker.compose.project=ordivant-dev"
```

Include every listed product, Identity, and enabled-profile volume in the backup. Use the command output as the authoritative list; do not guess from the example names.

<span id="一致性與還原"></span>
<span id="一致性与还原"></span>

## Consistency and restoration

1. Confirm that the backup target is the correct Compose project name. Stop the environment with `-Action down` so files and PostgreSQL volumes are consistent; this does not delete data.
2. Use your organization's approved Docker volume snapshot or backup tool to back up every required volume under that project label. Also preserve the ignored `container-secrets` directory for the same project.
3. Encrypt backups and the host secrets directory, restrict access, and test restoration regularly. Do not upload `.data`, bootstrap tokens, or Gitea/service credentials to public issues, chats, or Git.
4. To restore, first recover the Compose volumes under their original names and the original secrets, then start the original products/profiles with the same project name. Do not mix encryption keys and databases from different environments.

For a single-product or partial-product deployment, back up every volume created by that mode along with the shared Identity volumes. Knowledge citations and Code PR provenance do not replace backups of the referenced product data; preserve the source product and actual Gitea data as well.

<span id="執行與排程"></span>
<span id="运行与调度"></span>

## Execution and scheduling

Interval workflows require the Work Runtime to keep running. Schedules missed while it is stopped are not all backfilled; an active workflow prevents the same schedule from overlapping. Each sandbox workspace is bounded and cleaned up when its Run ends, so it must not be used for persistent file storage. Save Runs, artifacts, and Knowledge documents through their respective products.

See the [execution guide](../execution-usage.md) for execution controls, allowed tool hosts, and sandbox limits. Runtime uses a DEMO fallback when no valid model is configured; DEMO is not a paid model run or a rate estimate.
