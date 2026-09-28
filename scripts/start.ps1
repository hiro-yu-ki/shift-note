$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path '.venv64\Scripts\python.exe') -or -not (Test-Path 'frontend\dist\index.html')) {
    & "$PSScriptRoot\setup.ps1"
}
& .\.venv64\Scripts\python.exe -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
Write-Host 'Open http://127.0.0.1:8000 - Ctrl+C to stop.'
& .\.venv64\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --no-access-log
