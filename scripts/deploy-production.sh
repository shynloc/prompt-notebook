#!/usr/bin/env sh
set -eu

REPOSITORY_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
ENV_FILE="${ENV_FILE:-$REPOSITORY_ROOT/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPOSITORY_ROOT/deploy/compose.production.yml}"

if [ ! -f "$ENV_FILE" ]; then
  printf '%s\n' "Missing $ENV_FILE. Copy deploy/.env.production.example to .env and configure it first." >&2
  exit 2
fi

if command -v git >/dev/null 2>&1 && git -C "$REPOSITORY_ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
  IMAGE_TAG="${IMAGE_TAG:-$(git -C "$REPOSITORY_ROOT" rev-parse --short=12 HEAD)}"
else
  IMAGE_TAG="${IMAGE_TAG:-latest}"
fi
export IMAGE_TAG
PROJECT_NAME="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$ENV_FILE" | tail -n 1)"
PROJECT_NAME="${PROJECT_NAME:-prompt-notebook}"

compose() {
  docker compose --project-name "$PROJECT_NAME" --project-directory "$REPOSITORY_ROOT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose config --quiet
compose build web
compose up -d postgres redis
compose run --rm migrate
compose up -d --no-deps web generation-worker

APP_PORT="$(sed -n 's/^APP_PORT=//p' "$ENV_FILE" | tail -n 1)"
APP_PORT="${APP_PORT:-5488}"
attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:$APP_PORT/health/ready" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    printf '%s\n' "Prompt Notebook did not become ready" >&2
    compose logs --tail=120 web >&2
    exit 1
  fi
  sleep 2
done

printf '%s\n' "Prompt Notebook $IMAGE_TAG is ready on 127.0.0.1:$APP_PORT"
