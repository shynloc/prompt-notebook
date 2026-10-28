#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-deploy/compose.production.yml}"
ENV_FILE="${ENV_FILE:-}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  PROJECT_NAME="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$ENV_FILE" | tail -n 1)"
else
  PROJECT_NAME=""
fi
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${PROJECT_NAME:-prompt-notebook}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$BACKUP_DIR"
TARGET="$BACKUP_DIR/prompt-notebook-$STAMP.sql.gz"
TEMP_DIR="$(mktemp -d "$BACKUP_DIR/.prompt-notebook-$STAMP.XXXXXX")"
RAW="$TEMP_DIR/dump.sql"
PART="$TEMP_DIR/dump.sql.gz"
CHECKSUM="$TEMP_DIR/checksum"
PUBLISHED=0
CHECKSUM_PUBLISHED=0

compose() {
  if [ -n "$ENV_FILE" ]; then docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  fi
}

record_event() {
  STATUS="$1"
  DETAIL="$2"
  compose exec -T postgres psql -U prompt_notebook -d prompt_notebook -v ON_ERROR_STOP=1 \
    -c "insert into operational_events (event_type, status, details) values ('backup', '$STATUS', jsonb_build_object('detail', '$DETAIL'));" >/dev/null 2>&1 || true
}

failed() {
  STATUS_CODE=$?
  trap - INT TERM HUP EXIT
  rm -f "$RAW" "$PART" "$CHECKSUM"
  rmdir "$TEMP_DIR" 2>/dev/null || true
  if [ "$PUBLISHED" = 1 ] && [ "$CHECKSUM_PUBLISHED" = 0 ]; then rm -f "$TARGET"; fi
  record_event failed "backup command failed"
  exit "$STATUS_CODE"
}
trap failed EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# Check pg_dump itself, not only the final command in a shell pipeline.
compose exec -T postgres pg_dump -U prompt_notebook -d prompt_notebook --no-owner --no-acl > "$RAW"
test -s "$RAW"
gzip -9 -c "$RAW" > "$PART"
gzip -t "$PART"
# Hard-link publication is atomic and cannot replace a previous successful dump.
ln "$PART" "$TARGET"
PUBLISHED=1
(cd "$BACKUP_DIR" && sha256sum "$(basename "$TARGET")") > "$CHECKSUM"
ln "$CHECKSUM" "$TARGET.sha256"
CHECKSUM_PUBLISHED=1
rm -f "$RAW" "$PART" "$CHECKSUM"
rmdir "$TEMP_DIR"
find "$BACKUP_DIR" -type f -name 'prompt-notebook-*.sql.gz*' -mtime "+$RETENTION_DAYS" -delete
record_event success "$TARGET"
trap - INT TERM HUP EXIT
printf '%s\n' "$TARGET"
