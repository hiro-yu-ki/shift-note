<#
Register this PC's public app and private tunnel to restart when the owner signs in.
Run once in a normal PowerShell session. The existing secret files are reused.
#>
param(
    [string]$PublicOrigin = 'https://shift-note.yuki-nova.workers.dev'
)
$ErrorActionPreference = 'Stop'
$root = (Split-Path $PSScriptRoot -Parent)
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$tokenFile = Join-Path $env:LOCALAPPDATA 'ShiftNote\cloudflare-preview\tunnel-token.txt'
$cloudflared = Join-Path $root 'tools\cloudflared-windows-amd64.exe'
$serverScript = Join-Path $PSScriptRoot 'start-cloudflare-preview.ps1'
foreach ($path in @($tokenFile, $cloudflared, $serverScript)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file is missing: $path" }
}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$appAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$serverScript`" -PublicOrigin $PublicOrigin" -WorkingDirectory $root
$tunnelAction = New-ScheduledTaskAction -Execute $cloudflared -Argument "tunnel --no-autoupdate run --token-file `"$tokenFile`"" -WorkingDirectory $root
Register-ScheduledTask -TaskName 'ShiftNote Public App' -Action $appAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName 'ShiftNote Cloudflare Tunnel' -Action $tunnelAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'ShiftNote Public App'
Start-ScheduledTask -TaskName 'ShiftNote Cloudflare Tunnel'
Write-Host 'Registered and started the app and Tunnel for sign-in autostart.'
Write-Host 'The PC must remain awake and the owner must sign in after a restart.'
