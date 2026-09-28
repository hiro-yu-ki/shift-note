$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& .\.venv64\Scripts\python.exe -m ruff check backend
if ($LASTEXITCODE -ne 0) { throw 'Backend lint failed.' }
& .\.venv64\Scripts\python.exe -m pytest -q
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
Push-Location frontend
try {
    npm run lint
    if ($LASTEXITCODE -ne 0) { throw 'Frontend lint failed.' }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    npx playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw 'Browser installation failed.' }
    npm run e2e
    if ($LASTEXITCODE -ne 0) { throw 'E2E failed.' }
} finally { Pop-Location }
