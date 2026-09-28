param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://[a-z0-9.-]+$')]
    [string]$PublicOrigin
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$previewDir = Join-Path $env:LOCALAPPDATA 'ShiftNote\cloudflare-preview'
New-Item -ItemType Directory -Path $previewDir -Force | Out-Null
$dbFile = Join-Path $previewDir 'shift.db'
$env:SHIFT_ENV = 'production'
$env:SHIFT_PUBLIC_ORIGIN = $PublicOrigin
$env:SHIFT_DB = 'sqlite:///' + $dbFile.Replace('\', '/')
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$secretPath = Join-Path $previewDir 'auth-secret.txt'
$tokenPath = Join-Path $previewDir 'setup-token.txt'
foreach ($secretFile in @($secretPath, $tokenPath)) {
    if (-not (Test-Path -LiteralPath $secretFile)) {
        $random.GetBytes($bytes)
        [IO.File]::WriteAllText($secretFile, [Convert]::ToBase64String($bytes), [Text.UTF8Encoding]::new($false))
    }
    icacls $secretFile /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
}
$env:SHIFT_AUTH_SECRET = [IO.File]::ReadAllText($secretPath).Trim()
$env:SHIFT_SETUP_TOKEN = [IO.File]::ReadAllText($tokenPath).Trim()
$random.Dispose()
$env:SHIFT_ALLOW_DEMO = '0'
$env:SHIFT_LOCAL_MAIL_SETTINGS = '1'
& .\.venv64\Scripts\python.exe -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
Write-Host "Cloudflare preview: $PublicOrigin/admin"
Write-Host "Initial manager setup key is stored at: $tokenPath"
Write-Host 'The PC, this server, and cloudflared must stay running. Ctrl+C stops this server.'
& .\.venv64\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8002 --no-access-log --no-proxy-headers
