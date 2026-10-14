# Restarts the Workspace OS server started by the "WorkspaceOS Server" scheduled task.
# Stopping the task alone leaves the node child running, so this also stops that process before starting the task again.
$ErrorActionPreference = 'Stop'
$name = 'WorkspaceOS Server'
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*apps/server/dist/index.js*' -or $_.CommandLine -like '*apps\server\dist\index.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $name
Write-Host "Restarted '$name'. Log: data/server.log"
