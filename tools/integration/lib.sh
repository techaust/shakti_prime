#!/usr/bin/env bash
# Shared helpers for the integration scripts (docs/runbooks/slice-integration.md). Sourced, not run.
# Works in Git Bash on Windows and in bash on Linux (a cloud session).

# pnpm through corepack: on Windows the shims live in %LOCALAPPDATA%\corepack-shims.
if ! command -v pnpm >/dev/null 2>&1 && [ -n "${LOCALAPPDATA:-}" ] && command -v cygpath >/dev/null 2>&1; then
  PATH="$(cygpath "$LOCALAPPDATA")/corepack-shims:$PATH"
  export PATH
fi

# The main checkout (the parent of the shared .git), from any worktree of it.
main_checkout() { dirname "$(git rev-parse --path-format=absolute --git-common-dir)"; }

# Where slice worktrees live: $WT_ROOT, else a `shakti-wt` folder beside the main checkout.
wt_root() { echo "${WT_ROOT:-$(dirname "$(main_checkout)")/shakti-wt}"; }

# The Postgres image the local stack uses (compose.yaml), so every throwaway database matches it.
pg_image() { grep -m1 -oE 'supabase/postgres:[^[:space:]]+' "$(main_checkout)/compose.yaml"; }

# A docker volume path: Git Bash needs the Windows form of the folder.
docker_path() { (cd "$1" && pwd -W 2>/dev/null) || echo "$1"; }

# start_db <container> <port>: an empty Postgres of the local image, waited on until healthy.
start_db() {
  docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" -p "127.0.0.1:$2:5432" -e POSTGRES_PASSWORD=postgres_local \
    --health-cmd "pg_isready -U postgres" --health-interval 3s "$(pg_image)" >/dev/null
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$1")" = healthy ] && return 0
    sleep 3
  done
  echo "$1 did not become healthy" >&2
  return 1
}

# export_db_urls <port>: every DATABASE_URL* line of ./.env exported with its port moved to <port>.
export_db_urls() {
  local k v
  while IFS='=' read -r k v; do
    export "$k=$(echo "$v" | sed -E "s#@(localhost|127\.0\.0\.1):[0-9]+/#@127.0.0.1:$1/#")"
  done < <(grep -E '^DATABASE_URL' .env)
}
