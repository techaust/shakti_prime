#!/usr/bin/env bash
# heavy.sh <command...>: run one heavy command (whole-repository lint, typecheck, build, the
# security suite, journeys) at a time across every slice worktree on this machine. The lock is a
# folder in the home directory, so every worktree shares it. Waits for the lock, runs, releases.
LOCK="$HOME/.shakti-heavy.lock"
while ! mkdir "$LOCK" 2>/dev/null; do
  # A lock older than 90 minutes is from a stopped agent: clear it.
  if [ -d "$LOCK" ] && [ $(( $(date +%s) - $(stat -c %Y "$LOCK") )) -gt 5400 ]; then rm -rf "$LOCK"; fi
  sleep 15
done
echo "$$ $(pwd) $*" > "$LOCK/owner"
trap 'rm -rf "$LOCK"' EXIT
"$@"
