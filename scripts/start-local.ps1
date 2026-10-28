[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 5488,
    [switch]$ConfigureOnly
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$environmentFile = Join-Path $repositoryRoot '.env.local-docker'

function New-RandomHex([int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Set-PrivatePermissions([string]$Path) {
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        # Native DACL-only updates work without SeSecurityPrivilege elevation.
        & icacls $Path '/inheritance:r' '/grant:r' "*$($identity):(F)" '*S-1-5-18:(F)' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not secure the local environment file.' }
        $fileInfo = New-Object IO.FileInfo($Path)
        $accessControl = if ($fileInfo.PSObject.Methods.Name -contains 'GetAccessControl') {
            $fileInfo.GetAccessControl()
        } else {
            [IO.FileSystemAclExtensions]::GetAccessControl($fileInfo)
        }
        $unexpected = $accessControl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
            $_.IdentityReference.Value
        } | Where-Object { $_ -notin @($identity, 'S-1-5-18') } | Select-Object -Unique
        foreach ($sid in $unexpected) {
            & icacls $Path '/remove' "*$sid" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Could not remove a public local-configuration permission.' }
        }
    } else {
        & chmod 600 $Path
        if ($LASTEXITCODE -ne 0) { throw 'Could not secure the local environment file.' }
    }
}

if (Test-Path -LiteralPath $environmentFile) {
    $existing = Get-Item -LiteralPath $environmentFile -Force
    if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing a non-regular local environment file.'
    }
    Write-Host 'Reusing the existing private local configuration; no keys changed.'
} else {
    $temporaryFile = Join-Path $repositoryRoot ('.env.local-docker.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $reservation = [IO.File]::Open($temporaryFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $reservation.Dispose()
        Set-PrivatePermissions $temporaryFile
        $contents = @(
            '# Private local configuration; generated once. Do not commit or share.'
            "APP_PORT=$Port"
            "POSTGRES_PASSWORD=$(New-RandomHex 24)"
            "BETTER_AUTH_SECRET=$(New-RandomHex 32)"
            "CREDENTIAL_ENCRYPTION_KEYS=local:$(New-RandomHex 32)"
            'LOCAL_MEDIA_QUOTA_BYTES=1073741824'
            'LOCAL_MEDIA_MIN_FREE_BYTES=268435456'
            'AI_IMAGE_TIMEOUT_MS=600000'
        ) -join "`n"
        $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($contents + "`n")
        $stream = [IO.File]::Open($temporaryFile, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        try {
            # Same-directory move is atomic and refuses to replace another writer.
            [IO.File]::Move($temporaryFile, $environmentFile)
            Write-Host 'Created a private local configuration with independent random credentials.'
        } catch [IO.IOException] {
            if (-not [IO.File]::Exists($environmentFile)) { throw }
            Write-Host 'Reusing a concurrently created local configuration; no keys changed.'
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force }
    }
}
$published = Get-Item -LiteralPath $environmentFile -Force
if ($published.PSIsContainer -or ($published.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Refusing a non-regular local environment file.'
}
Set-PrivatePermissions $environmentFile

$configuration = @{}
foreach ($line in Get-Content -LiteralPath $environmentFile) {
    $entry = [regex]::Match($line, '^([A-Z_]+)=(.*)$')
    if ($entry.Success) {
        $key = $entry.Groups[1].Value
        if ($configuration.ContainsKey($key)) { throw 'The existing local configuration contains duplicate settings.' }
        $configuration[$key] = $entry.Groups[2].Value
    }
}
if ($configuration['POSTGRES_PASSWORD'] -notmatch '^[A-Za-z0-9_-]{16,128}$' -or
    ([string]$configuration['BETTER_AUTH_SECRET']).Length -lt 32 -or
    $configuration['CREDENTIAL_ENCRYPTION_KEYS'] -notmatch '^local:[a-fA-F0-9]{64}$') {
    throw 'The existing local configuration is incomplete or invalid. It was not overwritten; restore your original configuration before continuing.'
}

$portLine = Get-Content -LiteralPath $environmentFile | Where-Object { $_ -match '^APP_PORT=' } | Select-Object -Last 1
$portMatch = [regex]::Match([string]$portLine, '^APP_PORT=([1-9][0-9]{0,4})$')
if (-not $portMatch.Success -or [int]$portMatch.Groups[1].Value -gt 65535) {
    throw 'The existing configuration has an invalid APP_PORT.'
}
$localPort = [int]$portMatch.Groups[1].Value
if ($ConfigureOnly) { Write-Host "Configuration ready for http://127.0.0.1:$localPort"; return }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install Docker Desktop, then rerun this script.' }
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop, then rerun this script.' }
$composeArguments = @('compose', '--project-name', 'prompt-notebook-local', '--env-file', $environmentFile, '-f', (Join-Path $repositoryRoot 'deploy/compose.local.yml'))

function Invoke-LocalCompose([string[]]$CommandArguments) {
    & docker @composeArguments @CommandArguments
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose failed. Existing configuration and data volumes were preserved.' }
}

Invoke-LocalCompose -CommandArguments @('config', '--quiet')
Invoke-LocalCompose -CommandArguments @('build', 'web')
Invoke-LocalCompose -CommandArguments @('up', '-d', 'postgres', 'redis')
Invoke-LocalCompose -CommandArguments @('run', '--rm', 'migrate')
Invoke-LocalCompose -CommandArguments @('up', '-d', '--no-deps', 'web', 'generation-worker')

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$localPort/health/ready" -TimeoutSec 3
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) { throw 'The local app did not become ready. Check Docker logs; do not remove volumes.' }
Write-Host "Prompt Notebook is ready: http://127.0.0.1:$localPort"
Write-Host 'Register locally; SMTP is not needed. Keep Docker volumes and .env.local-docker to preserve your data.'
