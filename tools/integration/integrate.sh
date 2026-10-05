#!/usr/bin/env bash
# integrate.sh <worktree> <log>: every CI check on a fresh Postgres on port 54340, then the
# end-to-end journeys on the host (no screenshot comparison: that is e2e:snap in the Linux image).
# Lighthouse is not run; CI runs it on the pull request. Summary lines go to <log>, each step's
# output to <log>.<step>; the last line of <log> is the verdict, INTEGRATION PASSED or
# INTEGRATION FAILED. It runs for about 30 to 60 minutes, so start it in the background.
# INTEGRATE_STEPS="lint format" runs only the named steps (a cloud session keeps each command under
# its 30-minute limit); the verdict is then INTEGRATION PARTIAL unless a step failed. A step that reads
# the database runs with the one that migrates it: "security dbverify" together; e2e seeds for itself.
set -u
. "$(dirname "$0")/lib.sh"
WT="$1"; LOG="$2"; : > "$LOG"
cd "$WT" || exit 1
step() {
  local n="$1"; shift
  if [ -n "${INTEGRATE_STEPS:-}" ] && [[ " $INTEGRATE_STEPS " != *" $n "* ]]; then
    echo "=== $n skipped" >>"$LOG"
    return 0
  fi
  echo "=== $n start $(date +%T)" >>"$LOG"
  "$@" >>"$LOG.$n" 2>&1
  local rc=$?
  echo "=== $n rc=$rc $(date +%T)" >>"$LOG"
}

if ! start_db shakti-pg-int 54340; then echo "=== INTEGRATION FAILED (database)" >>"$LOG"; exit 1; fi
export_db_urls 54340
env | grep -E '^DATABASE_URL' | grep -vc ':54340/' | sed 's/^/urls_not_on_54340=/' >>"$LOG"

step install bash -c 'pnpm install --offline --frozen-lockfile || pnpm install --frozen-lockfile'
step lint pnpm lint
step format pnpm format:check
step copylint pnpm copy-lint
step generated bash -c 'pnpm --filter @shakti/tokens build && pnpm db:generate && git diff --exit-code -- packages/tokens apps/web/src/app/icon.svg packages/db/migrations'
step typecheck pnpm exec turbo run typecheck --force
step unit pnpm exec turbo run test --force
step security pnpm test:security
step dbverify pnpm db:verify
step audit pnpm audit --audit-level=moderate

# The build must pass with no .env and no database settings.
unset DATABASE_URL DATABASE_URL_MIGRATOR DATABASE_URL_AUTH DATABASE_URL_OUTBOX DATABASE_URL_READER
mv .env "$LOG.env-aside"
step build pnpm exec turbo run build --force
mv "$LOG.env-aside" .env
step jsbudget pnpm --filter web js-budget

# A worktree's .git points outside its folder, so the scan mounts the main checkout and reads only
# this branch's own commits.
BR=$(git branch --show-current)
MAIN="$(main_checkout)"
step gitleaks env MSYS_NO_PATHCONV=1 docker run --rm -v "$(docker_path "$MAIN"):/repo" \
  "$GITLEAKS_IMAGE" git /repo --redact --exit-code 1 "--log-opts=origin/main..$BR"

# The journeys get the fresh database back.
export_db_urls 54340
step e2e pnpm --filter web e2e

docker rm -f shakti-pg-int >/dev/null 2>&1
if grep -qE "rc=[1-9]" "$LOG"; then
  echo "=== INTEGRATION FAILED" >>"$LOG"
elif grep -q " skipped$" "$LOG"; then
  echo "=== INTEGRATION PARTIAL ($INTEGRATE_STEPS)" >>"$LOG"
else
  echo "=== INTEGRATION PASSED" >>"$LOG"
fi
tail -1 "$LOG"
