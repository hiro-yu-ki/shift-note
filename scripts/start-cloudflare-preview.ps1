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
$random.GetBytes($bytes)
$env:SHIFT_AUTH_SECRET = [Convert]::ToBase64String($bytes)
$random.GetBytes($bytes)
$env:SHIFT_SETUP_TOKEN = [Convert]::ToBase64String($bytes)
$random.Dispose()
$env:SHIFT_ALLOW_DEMO = '0'
$env:SHIFT_LOCAL_MAIL_SETTINGS = '1'
$tokenPath = Join-Path $previewDir 'setup-token.txt'
[IO.File]::WriteAllText($tokenPath, $env:SHIFT_SETUP_TOKEN, [Text.UTF8Encoding]::new($false))
& .\.venv64\Scripts\python.exe -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
Write-Host "Cloudflare preview: $PublicOrigin/admin"
Write-Host "Initial manager setup key is stored at: $tokenPath"
Write-Host 'The PC, this server, and cloudflared must stay running. Ctrl+C stops this server.'
& .\.venv64\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8002 --no-access-log --no-proxy-headers
