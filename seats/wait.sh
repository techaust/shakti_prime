#!/usr/bin/env bash
# Usage: wait.sh <seat number> <last assignment done>. Prints NEW and the seat file when the seat's
# assignment is higher than the last one done and its wait_for commit (if any) is on its branch;
# prints WAIT after about 25 minutes otherwise.
seat="$1"; last="${2:-0}"; end=$(( $(date +%s) + 1500 ))
while [ "$(date +%s)" -lt "$end" ]; do
  git fetch -q origin ops/seats 2>/dev/null
  file="$(git show "origin/ops/seats:seats/seat-$seat.md" 2>/dev/null)"
  n="$(printf '%s\n' "$file" | sed -n 's/^assignment: *//p' | head -1)"
  if [ -n "$n" ] && [ "$n" -gt "$last" ]; then
    branch="$(printf '%s\n' "$file" | sed -n 's/^branch: *//p' | head -1)"
    waitfor="$(printf '%s\n' "$file" | sed -n 's/^wait_for: *//p' | head -1)"
    ready=1
    if [ -n "$waitfor" ] && [ "$waitfor" != "none" ]; then
      git fetch -q origin "$branch" 2>/dev/null
      git log --format=%s "origin/$branch" -200 2>/dev/null | grep -qxF "$waitfor" || ready=0
    fi
    if [ "$ready" = 1 ]; then echo NEW; printf '%s\n' "$file"; exit 0; fi
  fi
  sleep 60
done
echo WAIT
