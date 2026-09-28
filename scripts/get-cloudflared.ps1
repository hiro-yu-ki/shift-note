$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $root 'tools\cloudflared-windows-amd64.exe'
$expected = 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2'
if (-not (Test-Path -LiteralPath $destination)) {
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-windows-amd64.exe' -OutFile $destination
}
$actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Cloudflared checksum does not match the official release.' }
& $destination --version
