# Runs the Workspace OS server in the foreground with a clean environment and appends its log to data/server.log.
# Used by the "WorkspaceOS Server" scheduled task (see scripts/install-startup.ps1). Reads .env itself; never prints it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Do not inherit settings from whatever shell launched this.
foreach ($n in 'PUBLIC_BASE_URL','TRUSTED_ORIGINS','DISABLE_SCHEDULER','DISABLE_RATE_LIMIT') {
  Remove-Item "Env:$n" -ErrorAction SilentlyContinue   # these come from .env
}
# Pin the host-side layout (the .env template is Docker-oriented, so paths are not taken from it).
$env:NODE_ENV = 'production'
$env:APP_HOST = '127.0.0.1'          # loopback only; `tailscale serve` publishes it to the tailnet over HTTPS
$env:APP_PORT = '4390'
$env:DATABASE_PATH = Join-Path $root 'data\workspace.sqlite'
$env:BACKUP_DIR = Join-Path $root 'backups'
$env:WEB_DIST_DIR = Join-Path $root 'apps\web\dist'

$node = (Get-Command node -ErrorAction Stop).Source
$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$log = Join-Path $dataDir 'server.log'
# Keep the log from growing without bound (1 file of history).
if ((Test-Path $log) -and (Get-Item $log).Length -gt 20MB) { Move-Item -Force $log "$log.1" }

& $node --env-file=.env apps/server/dist/index.js *>> $log
exit $LASTEXITCODE
