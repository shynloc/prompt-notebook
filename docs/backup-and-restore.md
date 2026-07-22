# Backup and restore

Prompt text, accounts, tags, image references, extension devices, and custom terms live in PostgreSQL. Image bytes live in the configured image host and must follow that service's own backup policy.

## Backup

Run from the deployment directory after loading the production `.env`:

```sh
BACKUP_DIR=/srv/backups/prompt-notebook RETENTION_DAYS=14 ./scripts/backup-postgres.sh
```

The script writes a private gzip dump and SHA-256 sidecar, validates the gzip stream before publishing it, and removes only Prompt Notebook dumps older than the selected retention window. Schedule it daily and copy at least one encrypted copy off-host.

## Restore drill

Restore into a disposable Compose project monthly before trusting a backup. The restore script verifies the checksum and requires typing `RESTORE` before replacing the selected database:

```sh
ALLOW_RESTORE=1 COMPOSE_FILE=deploy/compose.production.yml ./scripts/restore-postgres.sh backups/prompt-notebook-20260720T000000Z.sql.gz
```

The script refuses to run without the explicit `ALLOW_RESTORE=1` gate. After restore, run migrations, start the web service, verify `/health/ready`, sign in, search for a known prompt, and open its image preview. Never test a restore against production first.

## Release retention

Keep the running image, the immediately previous verified image, and one known-good rollback image. Delete only images whose exact tags and replacement status have been verified. Keep enough free disk for PostgreSQL WAL, one compressed backup, and one image build.
