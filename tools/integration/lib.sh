#!/usr/bin/env bash
# Shared helpers for the integration scripts (docs/runbooks/slice-integration.md). Sourced, not run.
# Works in Git Bash on Windows and in bash on Linux (a cloud session).

# pnpm through corepack: on Windows the shims live in %LOCALAPPDATA%\corepack-shims.
if ! command -v pnpm >/dev/null 2>&1 && [ -n "${LOCALAPPDATA:-}" ] && command -v cygpath >/dev/null 2>&1; then
  PATH="$(cygpath "$LOCALAPPDATA")/corepack-shims:$PATH"
  export PATH
fi

# In a cloud session the image's Node comes before /usr/local/bin, where the setup script installs the
# Node of .node-version and the pnpm of package.json; put /usr/local/bin first when its Node is there.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ -x /usr/local/bin/node ]; then
  case ":$PATH:" in /usr/local/bin:*) ;; *) PATH="/usr/local/bin:$PATH"; export PATH ;; esac
fi

# `python3` everywhere: Git Bash on the PC may have only `python` (its `python3` can be the
# Microsoft Store stub, which runs nothing), so `python3` falls back to `python` there.
if ! python3 -c '' >/dev/null 2>&1 && command -v python >/dev/null 2>&1; then
  python3() { python "$@"; }
fi

# The main checkout (the parent of the shared .git), from any worktree of it.
main_checkout() { dirname "$(git rev-parse --path-format=absolute --git-common-dir)"; }

# Where slice worktrees live: $WT_ROOT, else a `shakti-wt` folder beside the main checkout.
wt_root() { echo "${WT_ROOT:-$(dirname "$(main_checkout)")/shakti-wt}"; }

# The Postgres image the local stack uses (compose.yaml), so every throwaway database matches it.
pg_image() { grep -m1 -oE 'supabase/postgres:[^[:space:]]+' "$(main_checkout)/compose.yaml"; }

# The secret scan's image (CI's version) and the Linux Playwright image the screenshot baselines
# are made in (apps/web/e2e/setup/snap-in-linux.ts).
GITLEAKS_IMAGE=ghcr.io/gitleaks/gitleaks:v8.24.3
playwright_image() { grep -m1 -oE 'mcr\.microsoft\.com/playwright:[^'"'"'"[:space:]]+' "$(main_checkout)/apps/web/e2e/setup/snap-in-linux.ts"; }

# ensure_gitleaks_image: the scan's image is on hand. A cloud session's proxy refuses ghcr.io's
# blob host, so the same release comes from Docker Hub (the project's own copy there) and is
# tagged with the ghcr name that integrate.sh runs.
ensure_gitleaks_image() {
  docker image inspect "$GITLEAKS_IMAGE" >/dev/null 2>&1 && return 0
  docker pull -q "$GITLEAKS_IMAGE" >/dev/null 2>&1 && return 0
  local hub="docker.io/zricethezav/gitleaks:${GITLEAKS_IMAGE##*:}"
  docker pull -q "$hub" >/dev/null 2>&1 && docker tag "$hub" "$GITLEAKS_IMAGE"
}

# The Chromium builds the installed @playwright/test runs (the journeys on the host and the app's
# print renderer), as folder names: chromium-<rev> and chromium_headless_shell-<rev>.
playwright_chromium_dirs() {
  (cd "$(main_checkout)/apps/web" && node -e "
const path = require('path'), fs = require('fs');
const t = path.dirname(require.resolve('@playwright/test/package.json'));
const c = path.dirname(require.resolve('playwright-core/package.json', { paths: [t] }));
const b = JSON.parse(fs.readFileSync(path.join(c, 'browsers.json'), 'utf8')).browsers;
console.log(b.filter((x) => x.name === 'chromium' || x.name === 'chromium-headless-shell')
  .map((x) => x.name.replace(/-/g, '_') + '-' + x.revision).join(' '));" 2>/dev/null)
}

# ensure_playwright_browsers: those builds are in the browsers folder ($PLAYWRIGHT_BROWSERS_PATH,
# which a cloud image may point at a folder holding an older build). A missing build is copied from
# the Linux Playwright image when Docker has it (same version, no download), else installed.
ensure_playwright_browsers() {
  local dest="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" dirs d missing="" cid
  dirs=$(playwright_chromium_dirs) || return 1
  [ -n "$dirs" ] || return 1
  for d in $dirs; do [ -d "$dest/$d" ] || missing="$missing $d"; done
  [ -z "$missing" ] && return 0
  mkdir -p "$dest"
  if docker image inspect "$(playwright_image)" >/dev/null 2>&1 &&
    cid=$(docker create "$(playwright_image)" 2>/dev/null); then
    for d in $missing; do docker cp "$cid:/ms-playwright/$d" "$dest/" >/dev/null 2>&1; done
    docker rm "$cid" >/dev/null 2>&1
  fi
  missing=""
  for d in $dirs; do [ -d "$dest/$d" ] || missing="$missing $d"; done
  [ -z "$missing" ] && return 0
  (cd "$(main_checkout)/apps/web" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= pnpm exec playwright install chromium chromium-headless-shell >/dev/null 2>&1)
  for d in $dirs; do [ -d "$dest/$d" ] || return 1; done
}

# A docker volume path: Git Bash needs the Windows form of the folder; on Linux it is the path.
docker_path() { (cd "$1" && pwd -W 2>/dev/null) || echo "$1"; }

# ensure_docker: the Docker daemon answers, starting it if needed. A cloud session's VM has Docker
# installed but not running; on the PC, Docker Desktop is started by hand.
ensure_docker() {
  docker info >/dev/null 2>&1 && return 0
  local sudo=""
  [ "$(id -u)" -eq 0 ] || sudo="sudo -n"
  $sudo service docker start >/dev/null 2>&1 || ($sudo dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "the Docker daemon did not start (see /tmp/dockerd.log)" >&2
  return 1
}

# start_db <container> <port>: an empty Postgres of the local image, waited on until healthy.
start_db() {
  docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" -p "127.0.0.1:$2:5432" -e POSTGRES_PASSWORD=postgres_local \
    --health-cmd "pg_isready -U postgres" --health-interval 3s "$(pg_image)" >/dev/null
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$1")" = healthy ] && break
    sleep 3
  done
  # pg_isready answers while the image is still starting (SQLSTATE 57P03): wait for real queries.
  local ok=0
  for _ in $(seq 1 60); do
    if docker exec "$1" psql -U postgres -tAc 'select 1' >/dev/null 2>&1; then ok=$((ok + 1)); else ok=0; fi
    [ "$ok" -ge 5 ] && return 0
    sleep 2
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
