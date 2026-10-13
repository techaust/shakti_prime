#!/usr/bin/env bash
# heavy-queue-test.sh [path to heavy.sh]: checks that heavy.sh serves waiters in the order they
# arrived, skips a ticket whose process is gone, and passes the command's exit code through. Runs
# on a lock folder of its own in a temporary folder, so it never touches the shared lock.
set -u
HEAVY="${1:-$(dirname "$0")/heavy.sh}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export HEAVY_LOCK="$WORK/lock" HEAVY_POLL=1
ORDER="$WORK/order"
fail=0

# A holder takes the lock first and keeps it while the waiters arrive.
bash "$HEAVY" sleep 6 &
holder=$!
sleep 1

# A ticket left by a process that is gone, ahead of every waiter.
mkdir -p "$HEAVY_LOCK.queue/2"
bash -c 'echo $$' > "$HEAVY_LOCK.queue/2/pid"

for name in first second third; do
  bash "$HEAVY" bash -c "echo $name >> '$ORDER'; sleep 1" &
  pids+=($!)
  sleep 1
done
wait "$holder" "${pids[@]}"

got=$(tr '\n' ' ' < "$ORDER")
if [ "$got" = "first second third " ]; then echo "order: $got- ok"; else echo "order: $got- expected first second third"; fail=1; fi
if [ -e "$HEAVY_LOCK" ]; then echo "the lock was left behind"; fail=1; fi
left=$(ls "$HEAVY_LOCK.queue")
if [ -n "$left" ]; then echo "tickets left behind: $left"; fail=1; fi

bash "$HEAVY" bash -c 'exit 7'
code=$?
if [ "$code" = 7 ]; then echo "exit code: 7 - ok"; else echo "exit code: $code, expected 7"; fail=1; fi

exit "$fail"
