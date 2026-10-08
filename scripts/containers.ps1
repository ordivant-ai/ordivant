param(
    [ValidateSet('up', 'down', 'status', 'logs')]
    [string]$Action = 'up',
    [switch]$Development,
    [switch]$Seed,
    [switch]$WithGitea,
    [switch]$WithRuntime,
    [switch]$WithSandbox,
    [switch]$WithIdentityBroker,
    [switch]$SsoQaFixture,
    [switch]$ExecutionQaFixture,
    [ValidateSet('work', 'knowledge', 'code')]
    [string[]]$Products = @('work', 'knowledge', 'code'),
    [string]$ProjectName
)

$ErrorActionPreference = 'Stop'
$script:RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:KnownSecrets = [System.Collections.Generic.List[string]]::new()

function Register-DiagnosticSecret {
    param([string]$Value)
    if (-not [string]::IsNullOrWhiteSpace($Value) -and $Value.Length -ge 8 -and -not $script:KnownSecrets.Contains($Value)) {
        $script:KnownSecrets.Add($Value)
    }
}

function New-HexSecret {
    $bytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($bytes)
    }
    finally {
        $random.Dispose()
    }
    return ([System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
}

function Write-TextIfMissing {
    param([string]$Path, [string]$Value)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        [System.IO.File]::WriteAllText($Path, $Value, $script:Utf8NoBom)
    }
}

function Read-HexSecret {
    param([string]$Path, [string]$Name)
    Write-TextIfMissing -Path $Path -Value (New-HexSecret)
    $value = [System.IO.File]::ReadAllText($Path).Trim()
    if ($value -notmatch '^[a-fA-F0-9]{64}$') {
        throw "Stored service secret '$Name' is invalid; refusing to replace it."
    }
    Register-DiagnosticSecret -Value $value
    return $value
}

function Ensure-ComposeSecrets {
    param([string]$Directory)
    [System.IO.Directory]::CreateDirectory($Directory) | Out-Null

    foreach ($product in @('work', 'knowledge', 'code', 'identity')) {
        $passwordPath = Join-Path $Directory ($product + '_db_password')
        $password = Read-HexSecret -Path $passwordPath -Name ($product + '_db_password')
        $urlPath = Join-Path $Directory ($product + '_database_url')
        $expectedUrl = "postgresql+psycopg://ordivant:${password}@${product}-db:5432/ordivant"
        Write-TextIfMissing -Path $urlPath -Value $expectedUrl
        $storedUrl = [System.IO.File]::ReadAllText($urlPath).Trim()
        if ($storedUrl -cne $expectedUrl) {
            throw "Stored database URL '$($product)_database_url' does not match its service password; refusing to overwrite it."
        }
        Register-DiagnosticSecret -Value $storedUrl
    }

    $proxyPath = Join-Path $Directory 'dev_proxy_token'
    [void](Read-HexSecret -Path $proxyPath -Name 'dev_proxy_token')
    [void](Read-HexSecret -Path (Join-Path $Directory 'identity_service_token') -Name 'identity_service_token')
    [void](Read-HexSecret -Path (Join-Path $Directory 'identity_broker_db_password') -Name 'identity_broker_db_password')
    [void](Read-HexSecret -Path (Join-Path $Directory 'sandbox_service_token') -Name 'sandbox_service_token')

    $giteaPath = Join-Path $Directory 'gitea.json'
    Write-TextIfMissing -Path $giteaPath -Value "{}`n"
}

function Get-SafeDockerFailure {
    param([object[]]$Output)
    $lines = @($Output | ForEach-Object { $_.ToString() })
    if ($lines.Count -gt 15) {
        $lines = @($lines | Select-Object -Last 15)
    }
    foreach ($line in $lines) {
        if ($line -match '(?i)\b(password|passwd|passphrase)\b') {
            '[credential output redacted]'
            continue
        }
        $safe = $line -replace '(?i)(\b[a-z][a-z0-9+.-]*://)[^\s/@]+@', '$1[REDACTED]@'
        $safe = $safe -replace '(?i)(?<![a-f0-9])[a-f0-9]{40,128}(?![a-f0-9])', '[REDACTED]'
        foreach ($secret in ($script:KnownSecrets | Sort-Object Length -Descending -Unique)) {
            $safe = $safe -replace [regex]::Escape($secret), '[REDACTED]'
        }
        $safe
    }
}

function Invoke-DockerCaptured {
    param([string[]]$Arguments, [string]$Operation)
    # Windows PowerShell treats native stderr progress as ErrorRecord even on success.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& docker @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    if ($exitCode -ne 0) {
        $details = @(Get-SafeDockerFailure -Output $output)
        $message = "Docker operation '$Operation' failed (exit code $exitCode)."
        if ($details.Count -gt 0) {
            $message += [System.Environment]::NewLine + ($details -join [System.Environment]::NewLine)
        }
        throw $message
    }
    return ,$output
}

function Invoke-DockerVisible {
    param([string[]]$Arguments, [string]$Operation)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker operation '$Operation' failed (exit code $LASTEXITCODE)."
    }
}

function Get-ProjectName {
    param([string]$RequestedName, [bool]$IsDevelopment)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($script:RepoRoot.ToLowerInvariant())
        $hash = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant().Substring(0, 8)
    }
    finally {
        $sha.Dispose()
    }

    if ($RequestedName) {
        $name = $RequestedName.Trim().ToLowerInvariant()
    }
    elseif ($IsDevelopment) {
        $name = 'ordivant-dev-' + $hash
    }
    else {
        $name = 'ordivant-prod-' + $hash
    }
    if ($name -notmatch '^[a-z0-9][a-z0-9_-]*$') {
        throw 'ProjectName must contain only lowercase letters, numbers, underscores, and hyphens, and start with a letter or number.'
    }
    return $name
}

function Get-ProductSettings {
    param([string[]]$SelectedProducts)
    if ($SelectedProducts.Count -eq 1) {
        $mode = $SelectedProducts[0]
    }
    else {
        $mode = 'suite'
    }

    if ($SelectedProducts -contains 'work') {
        $api = 'http://work-api:8000'
    }
    else {
        $first = $SelectedProducts[0]
        $port = if ($first -eq 'knowledge') { 8010 } else { 8020 }
        $api = "http://${first}-api:${port}"
    }
    return @{ Mode = $mode; ApiUpstream = $api }
}

function New-ComposePrefix {
    param([string]$ComposeProject, [bool]$UseDevelopment, [bool]$UseGitea, [bool]$UseRuntime, [bool]$UseIdentityBroker, [bool]$UseSsoQa, [bool]$UseSandbox, [bool]$UseExecutionQa)
    $arguments = @(
        'compose',
        '--project-directory', $script:RepoRoot,
        '-p', $ComposeProject,
        '-f', (Join-Path $script:RepoRoot 'compose.yaml')
    )
    if ($UseDevelopment) {
        $arguments += @('-f', (Join-Path $script:RepoRoot 'compose.dev.yaml'))
    }
    if ($UseSandbox) {
        $arguments += @('-f', (Join-Path $script:RepoRoot 'compose.sandbox.yaml'), '--profile', 'sandbox')
    }
    if ($UseIdentityBroker) {
        $arguments += @('-f', (Join-Path $script:RepoRoot 'compose.identity-broker.yaml'), '--profile', 'identity-broker')
    }
    if ($UseSsoQa) {
        $arguments += @('-f', (Join-Path $script:RepoRoot 'compose.sso-qa.yaml'))
    }
    if ($UseExecutionQa) {
        $arguments += @('-f', (Join-Path $script:RepoRoot 'compose.execution-qa.yaml'))
    }
    if ($UseGitea) { $arguments += @('--profile', 'gitea') }
    if ($UseRuntime) { $arguments += @('--profile', 'runtime') }
    return ,$arguments
}

function Invoke-ComposeCaptured {
    param([string[]]$Arguments, [string]$Operation)
    $fullArguments = @($script:ComposePrefix) + @($Arguments)
    return Invoke-DockerCaptured -Arguments $fullArguments -Operation $Operation
}

function Get-GiteaHostBaseUrl {
    $published = Invoke-ComposeCaptured -Arguments @('port', 'gitea', '3000') -Operation 'read Gitea port'
    $portText = @($published | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })[-1]
    if ($portText -notmatch ':(\d+)$') {
        throw 'Could not determine the published Gitea port.'
    }
    return 'http://127.0.0.1:' + $Matches[1]
}

function Test-GiteaToken {
    param([string]$BaseUrl, [string]$Token)
    try {
        $response = Invoke-RestMethod -Method Get -Uri ($BaseUrl + '/api/v1/user') -Headers @{ Authorization = 'token ' + $Token } -TimeoutSec 5
        return ($response.login -eq 'ordivant-local')
    }
    catch {
        return $false
    }
}

function Write-GiteaConfiguration {
    param([string]$Path, [string]$Token, [string]$WebhookSecret)
    $configuration = @{
        url = 'http://gitea:3000'
        token = $Token
        webhook_secret = $WebhookSecret
        scopes = @('write:repository', 'write:user')
    }
    $temporaryPath = $Path + '.tmp'
    $json = ConvertTo-Json -InputObject $configuration -Depth 5
    [System.IO.File]::WriteAllText($temporaryPath, $json + "`n", $script:Utf8NoBom)
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Initialize-GiteaCredential {
    param([string]$ConfigPath)
    $internalUrl = 'http://gitea:3000'
    $scopes = @('write:repository', 'write:user')
    try {
        $stored = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($ConfigPath))
    }
    catch {
        throw 'Stored Gitea configuration is invalid; refusing to rotate its credential.'
    }

    if ($stored.token -is [string]) { Register-DiagnosticSecret -Value $stored.token }
    if ($stored.webhook_secret -is [string]) { Register-DiagnosticSecret -Value $stored.webhook_secret }
    $hasConfiguration = $stored.url -or $stored.token -or $stored.webhook_secret -or $stored.scopes
    if ($hasConfiguration) {
        $storedScopes = @($stored.scopes)
        if ($stored.url -cne $internalUrl -or
            $stored.token -notmatch '^[a-fA-F0-9]{40,128}$' -or
            $stored.webhook_secret -notmatch '^[a-fA-F0-9]{64}$' -or
            ($storedScopes -join ',') -cne ($scopes -join ',')) {
            throw 'Stored Gitea configuration is incomplete or belongs to another configuration; refusing to rotate it.'
        }
        $hostBase = Get-GiteaHostBaseUrl
        if (-not (Test-GiteaToken -BaseUrl $hostBase -Token $stored.token)) {
            throw 'Stored Gitea credential could not be verified against this Compose project; refusing to rotate it.'
        }
        return $false
    }

    $cliPrefix = @('exec', '-T', '--user', 'git', 'gitea', 'gitea', '--config', '/data/gitea/conf/app.ini')
    $users = Invoke-ComposeCaptured -Arguments ($cliPrefix + @('admin', 'user', 'list')) -Operation 'inspect Gitea users'
    $userListing = ($users | ForEach-Object { $_.ToString() }) -join "`n"
    if ($userListing -notmatch '\bordivant-local\b') {
        [void](Invoke-ComposeCaptured -Arguments ($cliPrefix + @(
            'admin', 'user', 'create', '--username', 'ordivant-local',
            '--email', 'ordivant-local@example.invalid', '--admin', '--random-password',
            '--random-password-length', '40', '--must-change-password=false'
        )) -Operation 'create the local Gitea service account')
    }

    $tokenOutput = Invoke-ComposeCaptured -Arguments ($cliPrefix + @(
        'admin', 'user', 'generate-access-token', '--username', 'ordivant-local',
        '--token-name', ('ordivant-code-' + (New-HexSecret).Substring(0, 8)),
        '--scopes', ($scopes -join ','), '--raw'
    )) -Operation 'generate the local Gitea service token'
    $tokenLines = @($tokenOutput | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -match '^[a-fA-F0-9]{40,128}$' })
    if ($tokenLines.Count -ne 1) {
        throw 'Gitea did not return exactly one service token; credential output was suppressed.'
    }

    $webhookSecret = New-HexSecret
    Register-DiagnosticSecret -Value $tokenLines[0]
    Register-DiagnosticSecret -Value $webhookSecret
    $hostBaseUrl = Get-GiteaHostBaseUrl
    if (-not (Test-GiteaToken -BaseUrl $hostBaseUrl -Token $tokenLines[0])) {
        throw 'Generated Gitea credential failed verification; credential output was suppressed.'
    }
    Write-GiteaConfiguration -Path $ConfigPath -Token $tokenLines[0] -WebhookSecret $webhookSecret
    return $true
}

function Set-ProcessEnvironment {
    param([hashtable]$Values)
    $previous = @{}
    foreach ($entry in $Values.GetEnumerator()) {
        $previous[$entry.Key] = [System.Environment]::GetEnvironmentVariable($entry.Key, 'Process')
        [System.Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
    }
    return $previous
}

function Restore-ProcessEnvironment {
    param([hashtable]$Previous)
    foreach ($entry in $Previous.GetEnumerator()) {
        [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
}

try {
    $selected = @()
    foreach ($product in $Products) {
        $normalized = $product.Trim().ToLowerInvariant()
        if ($normalized -notin @('work', 'knowledge', 'code')) {
            throw "Unsupported product '$normalized'."
        }
        if ($selected -contains $normalized) {
            throw "Product '$normalized' was selected more than once."
        }
        $selected += $normalized
    }
    if ($selected.Count -eq 0) { throw 'Select at least one product.' }
    if ($selected.Count -eq 2 -and $selected -notcontains 'work') {
        throw 'Products=knowledge,code is unsupported: select one product, a pair that includes work, or all three products.'
    }
    if ($Action -eq 'up' -and $WithRuntime -and $selected -notcontains 'work') {
        throw '-WithRuntime requires the Work API in -Products.'
    }
    if ($Action -eq 'up' -and $WithSandbox -and (-not $WithRuntime -or $selected -notcontains 'work')) {
        throw '-WithSandbox requires -WithRuntime and the Work API in -Products.'
    }
    if ($Action -ne 'up' -and $Seed) { throw '-Seed is only valid with -Action up.' }

    $project = Get-ProjectName -RequestedName $ProjectName -IsDevelopment ([bool]$Development)
    if ($SsoQaFixture -and (-not $WithIdentityBroker -or $project -notmatch '-qa$')) {
        throw '-SsoQaFixture requires -WithIdentityBroker and an explicit isolated ProjectName ending in -qa.'
    }
    if ($ExecutionQaFixture -and ($project -notmatch '-qa$' -or -not $WithSandbox -or -not $WithRuntime)) {
        throw '-ExecutionQaFixture requires an explicit isolated ProjectName ending in -qa plus -WithRuntime -WithSandbox.'
    }
    $secretsDirectory = Join-Path (Join-Path $script:RepoRoot '.data/container-secrets') $project
    Ensure-ComposeSecrets -Directory $secretsDirectory

    $settings = Get-ProductSettings -SelectedProducts $selected
    $webPortVariable = if ($Development) { 'ORDIVANT_DEV_WEB_PORT' } else { 'ORDIVANT_WEB_PORT' }
    $browserPort = [System.Environment]::GetEnvironmentVariable($webPortVariable, 'Process')
    if (-not $browserPort) { $browserPort = if ($Development) { '5173' } else { '8088' } }
    $authOrigins = [System.Environment]::GetEnvironmentVariable('ORDIVANT_AUTH_ORIGINS', 'Process')
    if (-not $authOrigins) { $authOrigins = "http://127.0.0.1:$browserPort,http://localhost:$browserPort" }
    $environmentValues = @{
        ORDIVANT_SECRETS_DIR = $secretsDirectory.Replace('\', '/')
        ORDIVANT_IMAGE_PREFIX = $project
        ORDIVANT_PRODUCT_MODE = $settings.Mode
        ORDIVANT_WEB_API_UPSTREAM = $settings.ApiUpstream
        ORDIVANT_RUNTIME_MODE = 'demo'
        ORDIVANT_AUTH_COOKIE_NAME = 'ordivant_' + $project.Replace('-', '_') + '_session'
        ORDIVANT_AUTH_ORIGINS = $authOrigins
    }
    if ($WithIdentityBroker) {
        $brokerPort = [System.Environment]::GetEnvironmentVariable('ORDIVANT_BROKER_PORT', 'Process')
        if (-not $brokerPort) { $brokerPort = '8093' }
        $brokerOrigin = [System.Environment]::GetEnvironmentVariable('ORDIVANT_BROKER_PUBLIC_URL', 'Process')
        if (-not $brokerOrigin) { $brokerOrigin = "http://127.0.0.1:$brokerPort" }
        $environmentValues['ORDIVANT_BROKER_PUBLIC_URL'] = $brokerOrigin
        if (-not [System.Environment]::GetEnvironmentVariable('ORDIVANT_SSO_HTTP_HOSTS', 'Process')) {
            $environmentValues['ORDIVANT_SSO_HTTP_HOSTS'] = 'identity-broker'
        }
        if (-not [System.Environment]::GetEnvironmentVariable('ORDIVANT_SSO_BACKCHANNEL_OVERRIDES', 'Process')) {
            $environmentValues['ORDIVANT_SSO_BACKCHANNEL_OVERRIDES'] = ConvertTo-Json -Compress -InputObject @{ $brokerOrigin.TrimEnd('/') = 'http://identity-broker:8080' }
        }
    }
    $oldEnvironment = Set-ProcessEnvironment -Values $environmentValues

    $includeGiteaProfile = [bool]$WithGitea -or $Action -eq 'down'
    $includeRuntimeProfile = [bool]$WithRuntime -or $Action -eq 'down'
    $includeBrokerProfile = [bool]$WithIdentityBroker -or $Action -eq 'down'
    $includeSandboxProfile = [bool]$WithSandbox -or $Action -eq 'down'
    $script:ComposePrefix = New-ComposePrefix -ComposeProject $project -UseDevelopment ([bool]$Development) -UseGitea $includeGiteaProfile -UseRuntime $includeRuntimeProfile -UseIdentityBroker $includeBrokerProfile -UseSsoQa ([bool]$SsoQaFixture) -UseSandbox $includeSandboxProfile -UseExecutionQa ([bool]$ExecutionQaFixture)

    switch ($Action) {
        'status' {
            $serviceStatus = Invoke-DockerCaptured -Arguments ($script:ComposePrefix + @('ps')) -Operation 'show service status'
            $serviceStatus | ForEach-Object { Write-Host $_ }
        }
        'logs' {
            $logServices = @($selected | ForEach-Object { $_ + '-api' }) + @('identity-api', 'web')
            if ($WithGitea) { $logServices += 'gitea' }
            if ($WithRuntime) { $logServices += 'runtime' }
            if ($WithSandbox) { $logServices += 'sandbox-api' }
            if ($ExecutionQaFixture) { $logServices += 'mcp-fixture' }
            if ($WithIdentityBroker) { $logServices += 'identity-broker' }
            Invoke-DockerVisible -Arguments ($script:ComposePrefix + @('logs', '--tail', '100', '--follow') + $logServices) -Operation 'follow service logs'
        }
        'down' {
            Invoke-DockerCaptured -Arguments ($script:ComposePrefix + @('down')) -Operation 'stop this Compose project' | Out-Null
            Write-Host "Stopped Compose project '$project'. Named data volumes were retained."
        }
        'up' {
            $services = @($selected | ForEach-Object { $_ + '-api' }) + @('identity-api', 'web')
            if ($WithGitea) { $services += 'gitea' }
            if ($WithIdentityBroker) { $services += 'identity-broker' }
            Invoke-ComposeCaptured -Arguments (@('up', '-d', '--build', '--wait') + $services) -Operation 'build and start selected services' | Out-Null

            if ($Seed) {
                $packages = @{
                    work = 'ordivant'
                    knowledge = 'ordivant_knowledge'
                    code = 'ordivant_code'
                }
                foreach ($product in $selected) {
                    [void](Invoke-ComposeCaptured -Arguments @('exec', '-T', ($product + '-api'), 'python', '-m', ($packages[$product] + '.seed')) -Operation ("seed $product demo data"))
                }
            }

            $giteaChanged = $false
            if ($WithGitea) {
                $giteaChanged = Initialize-GiteaCredential -ConfigPath (Join-Path $secretsDirectory 'gitea.json')
                if ($giteaChanged -and $selected -contains 'code') {
                    Invoke-ComposeCaptured -Arguments @('up', '-d', '--no-deps', '--force-recreate', '--wait', 'code-api') -Operation 'reload Code API with Gitea credentials' | Out-Null
                }
            }

            if ($WithRuntime) {
                if ($ExecutionQaFixture) {
                    Invoke-ComposeCaptured -Arguments @('up', '-d', '--wait', 'mcp-fixture') -Operation 'start the isolated synthetic MCP fixture' | Out-Null
                }
                if ($WithSandbox) {
                    Invoke-ComposeCaptured -Arguments @('build', 'sandbox-job-image') -Operation 'build the fixed sandbox job image' | Out-Null
                    Invoke-ComposeCaptured -Arguments @('up', '-d', '--build', '--wait', 'sandbox-api') -Operation 'build and start the trusted sandbox executor' | Out-Null
                }
                if (-not $Seed) {
                    $bootstrapArguments = @($script:ComposePrefix) + @('exec', '-T', 'work-api', 'sh', '-c', 'test -s /data/bootstrap.json')
                    $bootstrapCheck = @(& docker @bootstrapArguments 2>&1)
                    if ($LASTEXITCODE -ne 0) {
                        throw 'Runtime startup needs an existing Work bootstrap file; pass -Seed to explicitly create local DEMO data.'
                    }
                }
                Invoke-ComposeCaptured -Arguments @('up', '-d', '--build', '--wait', 'runtime') -Operation 'build and start the Work runtime' | Out-Null
            }

            $webContainerPort = if ($Development) { '5173' } else { '80' }
            $publishedWeb = Invoke-ComposeCaptured -Arguments @('port', 'web', $webContainerPort) -Operation 'read web port'
            $webBinding = @($publishedWeb | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })[-1]
            if ($webBinding -notmatch ':(\d+)$') { throw 'Could not determine the published web port.' }
            $webPort = $Matches[1]
            Write-Host "Compose project '$project' is ready. Web: http://127.0.0.1:$webPort"
            if ($WithGitea) { Write-Host "Gitea: $(Get-GiteaHostBaseUrl) (service credentials remain in the project secret directory)." }
            if ($WithRuntime) { Write-Host 'Pi runtime is ready. Configured Agent dispatches use live models; unconfigured dispatches use the demo fallback.' }
            if ($WithSandbox) { Write-Host 'Per-run sandbox executor is ready on the internal control network; jobs have no host mounts or network access.' }
            if ($WithIdentityBroker) { Write-Host "Identity broker: $brokerOrigin (bootstrap its administrator interactively; see docs/enterprise-sso.md)." }
        }
    }
}
finally {
    if ($oldEnvironment) { Restore-ProcessEnvironment -Previous $oldEnvironment }
}
