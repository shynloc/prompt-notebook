# Backup and restore

Prompt text, accounts, tags, image references, extension devices, custom terms and model configuration live in PostgreSQL. Image bytes live in the instance-local media volume or the configured external image host. Keep a separate protected copy of the credential-encryption key ring: a database dump alone cannot decrypt saved credentials after key loss.

## Backup checks and their limits

The backup script first writes a private temporary SQL file, checks `pg_dump`'s exit status and verifies that the dump is nonempty, then compresses it. It validates gzip and publishes the dump/sidecar without overwriting an existing backup. The former unchecked `pg_dump | gzip` pipeline is no longer used. Temporary dump files are cleaned on failure, and failed dumps are not recorded as successful backups. The backup directory needs space for the uncompressed SQL plus its gzip and a filesystem supporting hard-link publication; unsupported targets fail rather than replacing an older backup.

- `gzip -t` checks that the compressed stream is readable.
- A SHA-256 sidecar checks that the bytes have not changed since the sidecar was created.
- Neither proves that `pg_dump` succeeded, that every expected table/row is present, or that an actual restore will work.

Successful command execution and byte checks are not a substitute for recovery testing. Keep an encrypted off-host copy, monitor backup failures and regularly restore into an isolated environment. Maintain an independent recovery copy rather than assuming a single automatic-update backup is sufficient.

## Bundled backup command

Run from the checkout root with an explicit private environment file and an external backup directory:

```sh
cd /opt/prompt-notebook/current
sudo env ENV_FILE=/opt/prompt-notebook/.env \
  BACKUP_DIR=/opt/prompt-notebook/backups RETENTION_DAYS=14 \
  ./scripts/backup-postgres.sh
```

These are example paths. Review `COMPOSE_PROJECT_NAME`, Compose configuration and the target database before executing any operation. The script writes a private gzip file and portable SHA-256 sidecar, validates the compressed stream and applies retention only to its named Prompt Notebook dumps. These checks do not establish logical completeness. Treat backups as private data and keep them outside Git and Docker build contexts.

Back up the `local_media_data` Docker volume as well when using instance-local images, or follow your external image host's backup policy. For a consistent full-instance snapshot, quiesce web/worker writes first, then back up the database, media volume and protected configuration; do not delete any volume to stop services. Local Docker installations use the separate `prompt-notebook-local` Compose project and `.env.local-docker`; select that project explicitly for backup operations.

## Restore drill

Test an independently verified backup in a **disposable deployment**, not against production. Use a separate environment file, Compose project name, volumes and ports. The restore script uses the environment's `COMPOSE_PROJECT_NAME`; accidentally pointing it at the production environment targets production data.

1. Prepare a disposable Compose project and start its PostgreSQL service.
2. Check the selected environment and project name again. Keep production web/worker services out of this project.
3. Verify backup provenance, inspect the database dump and confirm it was created by a successful backup job.
4. Run the guarded restore using the disposable environment. The example below intentionally uses a **different** environment path from production:

```sh
sudo env ALLOW_RESTORE=1 \
  ENV_FILE=/opt/prompt-notebook-restore/.env \
  COMPOSE_FILE=deploy/compose.production.yml \
  ./scripts/restore-postgres.sh \
  /srv/backups/prompt-notebook/prompt-notebook-YYYYMMDDTHHMMSSZ.sql.gz
```

Replace the sample backup filename and confirm that the restore environment names the disposable project before proceeding. The script checks the sidecar and gzip stream, requires `ALLOW_RESTORE=1`, and then asks you to type `RESTORE` before **dropping and replacing** the selected database. These gates prevent accidents only when the operator has correctly selected the target.

After restore, run migrations and start the disposable application with its own `APP_URL`. Verify readiness, accounts, a known note's full text, search, tags, image references and saved model settings. Confirm the separately restored image host and credential key ring work too. Repeat the drill regularly and after significant schema changes; never use production as the first restore test.

## Updates and rollback

The updater runs the bundled backup command before deploying. Its application rollback restores the previous Git/image revision when deployment fails; it does **not** reverse database migrations or restore the database. Schema changes are forward-only, so read release notes and preserve an independently verified database backup before updates.

Automatic updates are optional. Leave them disabled until backup monitoring, an off-host copy and a tested recovery procedure are in place. Adapt systemd paths and service users to your installation instead of copying them without review.

## Release retention

Keep the running image, the immediately previous verified image and one known-good rollback image. Delete only images whose exact tags and replacement status have been verified. Keep enough free disk for PostgreSQL WAL, a backup and an image build. Never prune database or Redis volumes as part of routine application-image cleanup.
