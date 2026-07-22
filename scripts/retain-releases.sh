#!/usr/bin/env sh
set -eu

if [ -z "${KEEP_TAGS:-}" ]; then printf '%s\n' "Set KEEP_TAGS to a comma-separated list of exact Prompt Notebook image tags." >&2; exit 2; fi
APPLY=false
if [ "${1:-}" = "--apply" ]; then APPLY=true; fi

docker image ls --format '{{.Repository}}:{{.Tag}}' 'prompt-notebook' | while IFS= read -r IMAGE; do
  TAG="${IMAGE#prompt-notebook:}"
  case ",$KEEP_TAGS," in
    *",$TAG,"*) printf 'keep   %s\n' "$IMAGE" ;;
    *)
      if [ "$APPLY" = true ]; then docker image rm "$IMAGE"; else printf 'remove %s (dry run)\n' "$IMAGE"; fi
      ;;
  esac
done
