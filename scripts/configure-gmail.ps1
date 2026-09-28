$ErrorActionPreference = 'Stop'
Write-Host 'Gmail SMTP setup for this Windows user. No email will be sent by this script.'
Write-Host 'Google 2-Step Verification must be ON before an App Password can be created.'
Write-Host 'Check https://myaccount.google.com/security with the SENDER account.'
Write-Host 'If it is OFF, enable it yourself, then open https://myaccount.google.com/apppasswords.'
$senderAddress = (Read-Host 'Sender Gmail address').Trim()
if ($senderAddress -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Invalid email address.' }
$mailPassword = Read-Host 'App Password (NOT the Google account password)' -AsSecureString
$settingsDir = Join-Path $env:LOCALAPPDATA 'ShiftNote'
New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
$mailSettings = [PSCustomObject]@{Host='smtp.gmail.com';Port=465;User=$senderAddress;From=$senderAddress;Password=$mailPassword}
$mailSettings | Export-Clixml -LiteralPath (Join-Path $settingsDir 'mail.xml')
Write-Host 'Saved using Windows user encryption. Reload the employee login page.'
Write-Host 'Register the receiving email under Staff > Employee login management before testing.'
