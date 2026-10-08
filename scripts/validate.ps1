param([switch]$WithGitea, [switch]$WithPostgres, [switch]$WithExecutionQa)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
[void][System.IO.Directory]::CreateDirectory((Join-Path $projectRoot '.cache/pytest'))
foreach ($pythonProject in @('backend', 'products/knowledge/backend', 'products/code/backend', 'products/identity/backend', 'sandbox')) {
    $taskPytestDirectory = Join-Path $projectRoot ('.cache/pytest/' + $pythonProject.Replace('/', '-') + '-' + [guid]::NewGuid().ToString('N'))
    & uv run --project $pythonProject --no-sync python -m pytest ($pythonProject + '/tests') -q --basetemp $taskPytestDirectory
    if ($LASTEXITCODE -ne 0) { throw "$pythonProject acceptance tests failed" }
}
Push-Location -LiteralPath (Join-Path $projectRoot 'frontend')
try {
    foreach ($mode in @('suite', 'work', 'knowledge', 'code')) {
        & npm run ('build:' + $mode)
        if ($LASTEXITCODE -ne 0) { throw "$mode frontend build failed" }
    }
}
finally { Pop-Location }
Push-Location -LiteralPath (Join-Path $projectRoot 'runtime')
try {
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'Pi Durable acceptance tests failed' }
}
finally { Pop-Location }
& uv run --project backend --no-sync python scripts/integration.py
if ($LASTEXITCODE -ne 0) { throw 'REST/MCP/runtime integration failed' }
& uv run --project backend --no-sync python scripts/product_smoke.py
if ($LASTEXITCODE -ne 0) { throw 'Independent product smoke acceptance failed' }
if ($WithGitea) {
    & uv run --project backend --no-sync python scripts/gitea_local.py start
    if ($LASTEXITCODE -ne 0) { throw 'Owned local Gitea readiness failed' }
    & uv run --project backend --no-sync python scripts/suite_integration.py
    if ($LASTEXITCODE -ne 0) { throw 'Real Gitea Suite workflow failed' }
}
if ($WithPostgres) {
    if ($WithGitea) { & uv run --project backend --no-sync python scripts/postgres_acceptance.py --suite }
    else { & uv run --project backend --no-sync python scripts/postgres_acceptance.py }
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL acceptance failed' }
}
if ($WithExecutionQa) {
    & uv run --project backend --no-sync python scripts/execution_acceptance.py --containers
    if ($LASTEXITCODE -ne 0) { throw 'Owned execution QA API/automation/MCP/Docker acceptance failed' }
}
Write-Output 'Selected Ordivant Suite validation gates passed. Full Git/PostgreSQL gates require -WithGitea -WithPostgres.'
