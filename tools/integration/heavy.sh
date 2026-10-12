#!/usr/bin/env bash
# heavy.sh <command...>: run one heavy command (whole-repository lint, typecheck, build, the
# security suite, journeys) at a time across every slice worktree on this machine. The lock is a
# folder in the home directory, so every worktree shares it. Waits for the lock, runs, releases,
# and exits with the command's exit code.
#
# Waiters are served in order: each takes a numbered ticket (a folder in the queue beside the
# lock, made with mkdir, which is atomic), and only the lowest live ticket tries for the lock. A
# ticket whose process is gone is removed and skipped. A lock older than 90 minutes is from a
# stopped agent and is cleared. A command started by an older heavy.sh (no ticket) still takes
# the lock whenever it finds it free.
#
# HEAVY_LOCK (the lock folder) and HEAVY_POLL (seconds between checks) exist for
# tools/integration/heavy-queue-test.sh.
LOCK="${HEAVY_LOCK:-$HOME/.shakti-heavy.lock}"
QUEUE="$LOCK.queue"
POLL="${HEAVY_POLL:-5}"
STALE_LOCK_SECONDS=5400
# A ticket whose process number is not written yet counts as gone after this long.
UNWRITTEN_TICKET_SECONDS=60

mkdir -p "$QUEUE"

age_of() { echo $(( $(date +%s) - $(stat -c %Y "$1" 2>/dev/null || date +%s) )); }

tickets() {
  local d
  for d in "$QUEUE"/*; do
    d=${d##*/}
    [[ $d =~ ^[0-9]+$ ]] && echo "$d"
  done | sort -n
}

# Take the next ticket: one above the highest one waiting, or the first free number after it.
take_ticket() {
  local n
  n=$(tickets | tail -n 1)
  n=$(( ${n:-0} + 1 ))
  until mkdir "$QUEUE/$n" 2>/dev/null; do n=$(( n + 1 )); done
  echo "$$" > "$QUEUE/$n/pid"
  TICKET=$n
}

# The lowest ticket whose process is alive; gone ones are removed on the way.
first_live_ticket() {
  local n pid
  for n in $(tickets); do
    pid=$(cat "$QUEUE/$n/pid" 2>/dev/null)
    if [ -z "$pid" ]; then
      if [ "$(age_of "$QUEUE/$n")" -gt "$UNWRITTEN_TICKET_SECONDS" ]; then rm -rf "${QUEUE:?}/$n"; continue; fi
    elif ! kill -0 "$pid" 2>/dev/null; then
      rm -rf "${QUEUE:?}/$n"; continue
    fi
    echo "$n"
    return
  done
}

TICKET=
HELD=
release() {
  if [ -n "$TICKET" ]; then rm -rf "${QUEUE:?}/$TICKET"; fi
  if [ -n "$HELD" ]; then rm -rf "$LOCK"; fi
}
trap release EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

take_ticket
while :; do
  if [ "$(first_live_ticket)" = "$TICKET" ]; then
    # A lock older than 90 minutes is from a stopped agent: clear it.
    if [ -d "$LOCK" ] && [ "$(age_of "$LOCK")" -gt "$STALE_LOCK_SECONDS" ]; then rm -rf "$LOCK"; fi
    if mkdir "$LOCK" 2>/dev/null; then
      HELD=1
      break
    fi
  fi
  sleep "$POLL"
done
echo "$$ $(pwd) $*" > "$LOCK/owner"
# Holding the lock: leave the queue, so the next ticket becomes the first.
rm -rf "${QUEUE:?}/$TICKET"
TICKET=
"$@"
