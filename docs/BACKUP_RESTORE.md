# Backup and restore

## Automatic
The scheduler takes a backup about once a day (first one a minute after start if none exists). Each backup: SQLite online backup -> `PRAGMA integrity_check` -> gzip -> `.manifest.json` with sha256 -> retention (`BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY` = 7/4/3). Files are in `BACKUP_DIR` (`./backups` on the host with Docker).

## Manual
```powershell
scripts/backup.ps1                      # create one now
docker compose exec app node dist/cli.js list-backups
docker compose exec app node dist/cli.js verify <file>
```
Also in the UI: Settings, Backup (create, list, download with password re-entry).

## Restore
```powershell
scripts/restore.ps1 <backup-file-name>
```
It verifies the checksum and integrity, stops the app, keeps a rollback copy of the current DB, restores, restarts. A corrupt or tampered file is rejected before anything is changed.

## Off-machine copy
Copy `./backups` to another disk or cloud storage on a schedule. A backup on the same disk does not protect against disk loss.

## Workspace JSON
Settings, Data, Export gives a portable JSON (no secrets) which can be re-imported with "Restore workspace" (merge, id conflicts reported).
