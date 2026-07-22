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
PROJECT_NAME="${PROJECT_NAME:-prompt-notebook}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$BACKUP_DIR"
TARGET="$BACKUP_DIR/prompt-notebook-$STAMP.sql.gz"
PART="$TARGET.part"

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
  rm -f "$PART"
  record_event failed "backup command failed"
}
trap failed INT TERM HUP EXIT

compose exec -T postgres pg_dump -U prompt_notebook -d prompt_notebook --no-owner --no-acl | gzip -9 > "$PART"
gzip -t "$PART"
mv "$PART" "$TARGET"
sha256sum "$TARGET" > "$TARGET.sha256"
find "$BACKUP_DIR" -type f -name 'prompt-notebook-*.sql.gz*' -mtime "+$RETENTION_DAYS" -delete
record_event success "$TARGET"
trap - INT TERM HUP EXIT
printf '%s\n' "$TARGET"
