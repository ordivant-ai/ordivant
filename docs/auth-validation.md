# Native account acceptance

Use an isolated local Compose project. The fixture only accepts `http://127.0.0.1:8092`; do not use that port or project for real user data. It creates synthetic accounts and business resources, changes synthetic passwords/permissions, and restarts or temporarily stops only the labeled QA services.

```powershell
$env:ORDIVANT_WEB_PORT = '8092'
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa -Seed
$env:UV_CACHE_DIR = Join-Path (Get-Location) '.cache/uv'
uv run --project backend --no-sync python scripts/auth_acceptance.py --containers
.\scripts\containers.ps1 -ProjectName ordivant-auth-qa -Action down
Remove-Item Env:ORDIVANT_WEB_PORT
```

For development, select `-Development`, set `ORDIVANT_DEV_WEB_PORT=8092`, and choose unused Work/Knowledge/Code/Identity host API ports through the corresponding `ORDIVANT_*_PORT` variables. Stop the production QA project before changing its mode. The acceptance command itself is unchanged. The main suites on `5173` and `8088` retain separate databases and credentials.

The HTTP checks cover initial setup closure, cookie flags, private introspection, shared human identity with product-local principals, concurrent bindings, explicit member scopes, no scope expansion, invalid Bearer precedence, Origin/CSRF validation, one-time invitation/recovery, password and session revocation, disabled accounts, throttling, restart persistence, fail-closed Identity outage, and independent agent bearer access during that outage. Reports contain check results and business resource IDs, with no passwords, session handles, CSRF values, invitation or recovery codes.

Identity unit tests use temporary databases and synthetic credentials:

```powershell
Push-Location products/identity/backend
uv run --no-sync python -m pytest tests -q
Pop-Location
```

Browser acceptance uses normal sign-in with an existing synthetic account in the same isolated project. Verify real mouse selections, not only ARIA expansion or keyboard navigation: product project/Space selectors, Work status filters, task priority in a Modal, and permission scope selectors above a Drawer/Modal. At 390×844, verify popup bounds, document width, visible account controls and logout. Password creation/change/recovery tests run via the HTTP fixture; the user enters their actual credentials themselves.

The product/account contracts are in [auth-contracts.md](auth-contracts.md), operator instructions in [human-login.md](human-login.md), and the completed evidence in [validation.md](validation.md).
