# Restores the database from a backup archive (*.sqlite.gz). Stops the app, restores, restarts it.
#   Docker:  .\scripts\restore.ps1 -Archive workspace-os-2026-01-01T00-00-00Z.sqlite.gz     (a file name inside the backups volume)
#   Local:   .\scripts\restore.ps1 -Archive C:\path\to\archive.sqlite.gz -Local
param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [switch]$Local,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not $Yes) {
  $a = Read-Host 'This REPLACES the current database (a rollback copy is kept). Type YES to continue'
  if ($a -ne 'YES') { Write-Host 'Cancelled.'; exit 1 }
}
if ($Local) {
  node --env-file=.env apps/server/dist/cli.js verify $Archive
  node --env-file=.env apps/server/dist/cli.js restore $Archive --yes
  exit $LASTEXITCODE
}
docker compose stop app
try {
  docker compose run --rm --no-deps app node dist/cli.js verify "/backups/$Archive"
  if ($LASTEXITCODE -ne 0) { throw 'Archive verification failed; database left untouched.' }
  docker compose run --rm --no-deps app node dist/cli.js restore "/backups/$Archive" --yes
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
} finally {
  docker compose up -d app
}
Write-Host 'Restore complete. Run scripts\smoke.mjs or open the app to verify.'
