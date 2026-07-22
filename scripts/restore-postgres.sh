#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then printf '%s\n' "Usage: $0 backups/prompt-notebook-YYYYMMDDTHHMMSSZ.sql.gz" >&2; exit 2; fi
if [ "${ALLOW_RESTORE:-}" != "1" ]; then printf '%s\n' "Refusing restore. Set ALLOW_RESTORE=1 only after selecting a disposable or approved target." >&2; exit 2; fi
BACKUP="$1"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/compose.production.yml}"
ENV_FILE="${ENV_FILE:-}"
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then PROJECT_NAME="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$ENV_FILE" | tail -n 1)"; else PROJECT_NAME=""; fi
PROJECT_NAME="${PROJECT_NAME:-prompt-notebook}"
test -f "$BACKUP"
test -f "$BACKUP.sha256"
(cd "$(dirname "$BACKUP")" && sha256sum -c "$(basename "$BACKUP").sha256")
gzip -t "$BACKUP"
printf '%s' "Type RESTORE to replace the Prompt Notebook database: "
read -r CONFIRM
test "$CONFIRM" = "RESTORE"
compose() {
  if [ -n "$ENV_FILE" ]; then docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  fi
}
compose exec -T postgres psql -U prompt_notebook -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS prompt_notebook WITH (FORCE);" -c "CREATE DATABASE prompt_notebook OWNER prompt_notebook;"
gzip -dc "$BACKUP" | compose exec -T postgres psql -U prompt_notebook -d prompt_notebook -v ON_ERROR_STOP=1
