param([switch]$SkipSeed, [switch]$WithGitea)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
foreach ($pythonProject in @('backend', 'products/knowledge/backend', 'products/code/backend', 'products/identity/backend')) {
    & uv sync --project $pythonProject --python 3.12 --extra dev
    if ($LASTEXITCODE -ne 0) { throw "$pythonProject dependencies failed" }
}
& uv sync --project sandbox --python 3.12 --group dev
if ($LASTEXITCODE -ne 0) { throw 'Sandbox dependencies failed' }
foreach ($component in @('frontend', 'runtime')) {
    Push-Location -LiteralPath (Join-Path $projectRoot $component)
    try {
        $packageCache = Join-Path $projectRoot ('.cache\npm\' + $component)
        if (Test-Path -LiteralPath 'package-lock.json') { & npm ci --cache $packageCache --no-audit --no-fund }
        else { & npm install --cache $packageCache --no-audit --no-fund }
        if ($LASTEXITCODE -ne 0) { throw "$component dependencies failed" }
        if ($component -eq 'frontend') { & npm run build:suite }
        else { & npm run build }
        if ($LASTEXITCODE -ne 0) { throw "$component build failed" }
    }
    finally { Pop-Location }
}
if (-not $SkipSeed) {
    foreach ($product in @(@('backend', 'ordivant'), @('products/knowledge/backend', 'ordivant_knowledge'), @('products/code/backend', 'ordivant_code'))) {
        & uv run --project $product[0] --no-sync python -m ($product[1] + '.seed')
        if ($LASTEXITCODE -ne 0) { throw "$($product[1]) demo seed failed" }
    }
}
if ($WithGitea) {
    & uv run --project backend --no-sync python scripts/gitea_local.py start
    if ($LASTEXITCODE -ne 0) { throw 'Local Gitea setup failed' }
}
Write-Output 'Setup complete. Start: uv run --project backend --no-sync python scripts/dev.py'
