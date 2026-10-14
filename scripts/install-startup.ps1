# Registers (or removes with -Remove) a per-user scheduled task that starts the server at logon and restarts it if it crashes.
# No administrator rights needed. Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts/install-startup.ps1
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'WorkspaceOS Server'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task '$name'."
  return
}
$script = Join-Path $PSScriptRoot 'run-server.ps1'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$me = (whoami).Trim()   # e.g. MACHINE\user; $env:USERDOMAIN can be wrong on workgroup PCs
$logon = New-ScheduledTaskTrigger -AtLogOn -User $me
# Watchdog: every 5 minutes try to start it. With MultipleInstances=IgnoreNew this does nothing while the server is running,
# and brings it back within 5 minutes if the process was killed (for example when a session ends).
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$trigger = @($logon, $watchdog)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered scheduled task '$name' (starts at logon, restarts on failure). Log: data/server.log"
