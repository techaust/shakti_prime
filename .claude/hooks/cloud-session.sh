#!/usr/bin/env bash
# SessionStart hook for Claude Code cloud sessions (docs/runbooks/hybrid.md). On the PC it exits at
# once. In a cloud session (CLAUDE_CODE_REMOTE=true) it makes `.env` from `.env.example` when there
# is none, installs the packages from the snapshot's store when the checkout has none, starts the
# Docker daemon and the local Postgres (compose.yaml), and prints one line. Migrating and seeding
# are left to the security suites and the journeys, which prepare the database themselves
# (prepareDatabase() in packages/db/src/testing); the dev server needs `pnpm db:migrate && pnpm db:seed`.
# Never fails the session: every problem is printed and the hook ends with 0.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
. tools/integration/lib.sh
say() { echo "[cloud-session] $*"; }

# The image puts its own Node (22) ahead of /usr/local/bin, where the setup script installs the Node
# of .node-version; and corepack cannot start pnpm 12 (it looks for pnpm.cjs, pnpm 12 ships pnpm.mjs).
# So /usr/local/bin goes first for this hook and, through CLAUDE_ENV_FILE, for every later command,
# and pnpm of package.json is installed with npm when it is missing or the wrong version.
export PATH="/usr/local/bin:$PATH"
[ -n "${CLAUDE_ENV_FILE:-}" ] && echo 'export PATH="/usr/local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
want_pnpm=$(grep -m1 -oE '"packageManager": *"pnpm@[0-9.]+' package.json | grep -oE '[0-9.]+$')
if [ -n "$want_pnpm" ] && [ "$(pnpm --version 2>/dev/null)" != "$want_pnpm" ]; then
  corepack disable pnpm >/dev/null 2>&1 || true
  npm install -g "pnpm@$want_pnpm" >/tmp/cloud-session-pnpm.log 2>&1 &&
    say "pnpm $want_pnpm installed with npm" || say "pnpm $want_pnpm did not install (/tmp/cloud-session-pnpm.log)"
fi
say "Node $(node --version 2>/dev/null), pnpm $(pnpm --version 2>/dev/null)"

[ -f .env ] || { cp .env.example .env && say ".env made from .env.example"; }
# The journeys run the app on E2E_BASE_URL's port (apps/web/playwright.config.ts, default 3031),
# and sign-in answers only on BETTER_AUTH_URL's, so the two agree here, as setup-worktree.sh makes them.
if ! grep -q '^E2E_BASE_URL=' .env; then
  echo "E2E_BASE_URL=$(grep -m1 '^BETTER_AUTH_URL=' .env | cut -d= -f2-)" >> .env
fi

if [ ! -d node_modules ]; then
  pnpm install --offline --frozen-lockfile >/tmp/cloud-session-install.log 2>&1 ||
    pnpm install --frozen-lockfile >/tmp/cloud-session-install.log 2>&1 ||
    say "pnpm install failed (/tmp/cloud-session-install.log); run it before any check"
fi

# The journeys' Chromium (apps/web/playwright.config.ts), installed in the background when missing,
# since the setup script's fallback leaves it to the session.
if ! ls "${HOME}/.cache/ms-playwright"/chromium-* >/dev/null 2>&1 && [ -d node_modules ]; then
  (pnpm --filter web exec playwright install --with-deps chromium >/tmp/cloud-session-browser.log 2>&1 ||
    pnpm --filter web exec playwright install chromium >>/tmp/cloud-session-browser.log 2>&1) &
  say "installing the journeys' Chromium in the background (/tmp/cloud-session-browser.log)"
fi

if ! ensure_docker 2>/dev/null; then
  say "Docker did not start, so the local Postgres is down (/tmp/dockerd.log); the unit tests still run"
  exit 0
fi
if docker compose up -d --wait >/tmp/cloud-session-db.log 2>&1; then
  say "Postgres is up on 127.0.0.1:54322; the suites migrate and seed it themselves"
else
  say "the local Postgres did not start (/tmp/cloud-session-db.log)"
fi
exit 0
