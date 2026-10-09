<span id="開始使用-ordivant"></span>
<span id="开始使用-ordivant"></span>

# Getting started with Ordivant

This guide uses Docker Compose to create a local development environment. Work, Knowledge, Code, and Identity share one browser entry point; each product's data remains in its own database and volume.

<span id="準備環境"></span>
<span id="准备环境"></span>

## Prepare the environment

- Git.
- Docker Desktop (Windows/macOS with Linux containers) or Docker Engine on Linux.
- Docker Compose v2 plugin, with the `docker compose` command.
- PowerShell 7 (`pwsh`). `scripts/containers.ps1` uses the same parameters on Windows and Linux.

You do not need to install Python, Node.js, or `uv` on the host. The first startup builds application images and downloads required container images; the time required depends on network and host performance.

<span id="複製並啟動"></span>
<span id="拷贝并启动"></span>

## Clone and start

Run this in Windows PowerShell 7:

```powershell
git clone https://github.com/ordivant-ai/ordivant.git
Set-Location ordivant
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed
```

On Linux, use the same helper with a Unix-style path:

```bash
git clone https://github.com/ordivant-ai/ordivant.git
cd ordivant
pwsh -NoProfile -File ./scripts/containers.ps1 -Development -ProjectName ordivant-dev -Seed
```

The default selects all three products. Open `http://127.0.0.1:5173` and create your own administrator on the first-run setup page. There is no built-in human account or default password. The first administrator receives one-time recovery codes; store them securely. Do not paste passwords or recovery codes into chat, command lines, or logs. See [Accounts and sign-in](../human-login.md) for more about sign-in and invitations.

`-Seed` is an explicit demo-data initialization option. It creates business examples marked DEMO in selected products and creates local bootstrap credentials required by product APIs and Agents. It does not create an Identity human account, configure enterprise SSO, or connect a paid model. Do not add `.data` or container secrets to Git.

This minimal startup lets you explore all three products and the basic Work task flow, but it does not start the Pi Runtime, Gitea, or sandbox. To start the Agent Runtime, Code writes, and Docker sandbox in a new environment, use the full command:

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithGitea -WithRuntime -WithSandbox
```

On Linux, use the path `./scripts/containers.ps1`. If the minimal environment is already running, rerun the helper with the same `-Development` and `-ProjectName` values plus `-WithGitea -WithRuntime -WithSandbox`; do not add `-Seed` again. To add only Runtime to a new environment without Code writes or a sandbox, use `-WithRuntime`. `-WithSandbox` requires Work and Runtime to be enabled as well.

<span id="seed-與-runtime"></span>
<span id="seed-与-runtime"></span>

## Seed and Runtime

Seed and Runtime are separate steps. Seed creates `bootstrap.json` in Work's persistent data directory; Runtime uses it on startup to obtain initial connection data for the service. If you add `-WithRuntime` in a new environment before Work has a bootstrap file, the helper stops and asks you to use `-Seed`. It will not silently create demo data in the background. You can add Runtime to initialized data later under the same Compose project.

If Runtime has no usable model connection, execution uses an explicitly labeled DEMO fallback; this is not a paid-model run. An administrator configures model connections in Work and selects settings for each Agent. See the [execution and automation guide](../execution-usage.md).

<span id="檢查與停止"></span>
<span id="检查与停止"></span>

## Check and stop

Use the same project name to check service status, read logs, or stop containers:

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action status
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action logs -WithRuntime -WithGitea -WithSandbox
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action down
```

On Linux, change the script path to `./scripts/containers.ps1`. `down` stops only that Compose project and preserves named volumes; it does not erase data. To start again, use the same project name and feature options as before.

For PowerShell 7 on Linux, see the [container guide](../containers.md). For production, omit `-Development`; the default Web port is `8088`. Before exposing the service, configure a trusted HTTPS origin, secure cookies, the Identity service, and data backups. Do not treat local development settings as a production deployment.

<span id="接下來"></span>
<span id="接下来"></span>

## Next steps

- [Work: tasks and review](work.md)
- [Knowledge: documents, versions, and citations](knowledge.md)
- [Code: repositories and pull requests](code.md)
- [Administrators, roles, and SSO](administration.md)
- [Operations and backups](operations.md)
- [Troubleshooting](troubleshooting.md)
