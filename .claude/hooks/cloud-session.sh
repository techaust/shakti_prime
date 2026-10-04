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

[ -f .env ] || { cp .env.example .env && say ".env made from .env.example"; }

if [ ! -d node_modules ]; then
  pnpm install --offline --frozen-lockfile >/tmp/cloud-session-install.log 2>&1 ||
    pnpm install --frozen-lockfile >/tmp/cloud-session-install.log 2>&1 ||
    say "pnpm install failed (/tmp/cloud-session-install.log); run it before any check"
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
