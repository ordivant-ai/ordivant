param(
    [ValidateSet('up', 'down', 'status', 'reimport')]
    [string]$Action = 'up',
    [switch]$Development,
    [string]$ProjectName = 'ordivant-sso-qa',
    [ValidateSet(8092)]
    [int]$WebPort = 8092,
    [ValidateSet(8093)]
    [int]$BrokerPort = 8093
)

$ErrorActionPreference = 'Stop'
$ssoRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]*-qa$') { throw 'SSO fixture runs require an isolated project ending in -qa.' }
if ($WebPort -lt 1024 -or $BrokerPort -lt 1024 -or $WebPort -eq $BrokerPort) { throw 'Choose distinct nonprivileged QA ports.' }
$fixtureDirectory = Join-Path $ssoRepoRoot ('.data/sso-fixture/' + $ProjectName + '/import')
$overrides = @{
    UV_CACHE_DIR = Join-Path $ssoRepoRoot '.cache/uv'
    ORDIVANT_SECRETS_DIR = (Join-Path $ssoRepoRoot ('.data/container-secrets/' + $ProjectName)).Replace('\', '/')
    ORDIVANT_WEB_PORT = [string]$WebPort
    ORDIVANT_DEV_WEB_PORT = [string]$WebPort
    ORDIVANT_BROKER_PORT = [string]$BrokerPort
    ORDIVANT_BROKER_PUBLIC_URL = "http://127.0.0.1:$BrokerPort"
    ORDIVANT_AUTH_ORIGINS = "http://127.0.0.1:$WebPort,http://localhost:$WebPort"
    ORDIVANT_AUTH_COOKIE_SECURE = 'false'
    ORDIVANT_SSO_PUBLIC_ORIGIN = "http://127.0.0.1:$WebPort"
    ORDIVANT_SSO_QA_IMPORT_DIR = $fixtureDirectory.Replace('\', '/')
    ORDIVANT_SSO_HTTP_HOSTS = 'identity-broker'
    ORDIVANT_SSO_BACKCHANNEL_OVERRIDES = ConvertTo-Json -Compress -InputObject @{ "http://127.0.0.1:$BrokerPort" = 'http://identity-broker:8080' }
    ORDIVANT_WORK_PORT = '18000'
    ORDIVANT_KNOWLEDGE_PORT = '18010'
    ORDIVANT_CODE_PORT = '18020'
    ORDIVANT_IDENTITY_PORT = '18030'
}
$previous = @{}
foreach ($entry in $overrides.GetEnumerator()) {
    $previous[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
}
Push-Location -LiteralPath $ssoRepoRoot
try {
    if ($Action -in @('up', 'reimport')) {
        & uv run --no-project python scripts/sso_fixture.py generate --output-dir $fixtureDirectory --public-origin "http://127.0.0.1:$BrokerPort" --app-origin "http://127.0.0.1:$WebPort"
        if ($LASTEXITCODE -ne 0) { throw 'SSO fixture generation failed.' }
    }
    if ($Action -eq 'reimport') {
        # Replace only the two generated synthetic realms, with the broker stopped.
        $composeArguments = @('compose', '-p', $ProjectName, '-f', 'compose.yaml', '-f', 'compose.identity-broker.yaml', '-f', 'compose.sso-qa.yaml', '--profile', 'identity-broker')
        & docker @composeArguments stop identity-broker
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop the isolated broker before fixture import.' }
        & docker @composeArguments run --rm --no-deps identity-broker import --dir /opt/keycloak/data/import --override true
        if ($LASTEXITCODE -ne 0) { throw 'Generated QA realm import failed.' }
        & docker @composeArguments up -d --wait identity-broker
        if ($LASTEXITCODE -ne 0) { throw 'QA broker restart failed after import.' }
        return
    }
    $parameters = @{ Action = $Action; ProjectName = $ProjectName; WithIdentityBroker = $true; SsoQaFixture = $true }
    if ($Development) { $parameters['Development'] = $true }
    if ($Action -eq 'up') { $parameters['Seed'] = $true }
    & (Join-Path $PSScriptRoot 'containers.ps1') @parameters
    if ($LASTEXITCODE -ne 0) { throw 'Isolated SSO container operation failed.' }
    if ($Action -eq 'up') { Write-Host 'SSO fixtures are synthetic QA identities only. No main-environment human account or SSO provider was configured.' }
}
finally {
    Pop-Location
    foreach ($entry in $previous.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }
}
