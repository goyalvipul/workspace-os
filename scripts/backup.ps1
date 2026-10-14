# Creates a verified backup. Uses the running Docker container when present, otherwise the local server build.
param([switch]$Local)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$running = $false
if (-not $Local -and (Get-Command docker -ErrorAction SilentlyContinue)) {
  $names = docker ps --filter "name=workspace-os" --format "{{.Names}}" 2>$null
  $running = [bool]$names
}
if ($running) {
  docker compose exec -T app node dist/cli.js backup
} else {
  if (-not (Test-Path 'apps/server/dist/cli.js')) { throw 'Server is not built. Run: pnpm build' }
  node --env-file=.env apps/server/dist/cli.js backup
}
