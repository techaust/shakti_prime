#!/usr/bin/env bash
# setup-worktree.sh <slug> <branch> <db-port> <app-port>: a worktree for one slice with its own
# Postgres and a checked .env. The branch is reused when it exists, else made from origin/main.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
SLUG="$1"; BRANCH="$2"; PORT="$3"; APPPORT="$4"
MAIN="$(main_checkout)"; WT="$(wt_root)/$SLUG"
cd "$MAIN"
git fetch -q origin
if [ ! -d "$WT" ]; then
  if git show-ref --quiet "refs/heads/$BRANCH"; then
    git worktree add -q "$WT" "$BRANCH"
  elif git show-ref --quiet "refs/remotes/origin/$BRANCH"; then
    git worktree add -q -b "$BRANCH" "$WT" "origin/$BRANCH"
  else
    git worktree add -q -b "$BRANCH" "$WT" origin/main
  fi
fi

# .env from the main checkout's (or the example), every database URL moved to this slice's port.
SRC="$MAIN/.env"
[ -f "$SRC" ] || SRC="$MAIN/.env.example"
sed -E "s#@(localhost|127\.0\.0\.1):[0-9]+/#@127.0.0.1:${PORT}/#g" "$SRC" > "$WT/.env"
# The app runs on its own port; the journeys follow BETTER_AUTH_URL and E2E_BASE_URL there.
sed -i -E "s#^BETTER_AUTH_URL=.*#BETTER_AUTH_URL=http://localhost:${APPPORT}#" "$WT/.env"
if grep -q '^E2E_BASE_URL=' "$WT/.env"; then
  sed -i -E "s#^E2E_BASE_URL=.*#E2E_BASE_URL=http://localhost:${APPPORT}#" "$WT/.env"
else
  echo "E2E_BASE_URL=http://localhost:${APPPORT}" >> "$WT/.env"
fi

BAD=$(grep -E '^DATABASE_URL' "$WT/.env" | grep -v ":${PORT}/" || true)
if [ -n "$BAD" ]; then echo "ENV CHECK FAILED: a database URL does not use port $PORT"; exit 1; fi
if ! grep -q '^DATABASE_URL_READER=' "$WT/.env"; then echo "ENV CHECK FAILED: .env lacks DATABASE_URL_READER"; exit 1; fi

start_db "shakti-pg-$SLUG" "$PORT"
cd "$WT"
pnpm install --offline --frozen-lockfile >/dev/null 2>&1 || pnpm install --frozen-lockfile >/dev/null
echo "READY $SLUG at $WT branch=$BRANCH db=$PORT app=$APPPORT"
