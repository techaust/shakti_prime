#!/usr/bin/env bash
# Seats protocol v2. Usage: wait.sh <seat number> [<running lane ids, comma-separated>]
# Reads seats/seat-<n>.md on origin/ops/seats and prints, as soon as there is something to do:
#   NEW <lane id>        one line per lane that is ready to start: not running, its done_when
#                        subject not yet on its branch, its wait_for subject (if any) on its branch;
#                        followed by "---" and each such lane's block as the seat file has it
#   GONE <lane id>       a running lane the lead took out of the file (finish or stop it, then drop it)
#   DONE <lane id>       a running lane whose done_when subject is already on its branch
#   MAX <n>              the seat's max_agents (always printed with NEW, GONE or DONE)
# Prints WAIT after about 25 minutes with nothing to report; run it again at once.
# It reads only; it never writes, commits or pushes.
set -uo pipefail
seat="${1:?usage: wait.sh <seat> [<running ids>]}"; running=",${2:-},"
end=$(( $(date +%s) + 1500 ))

# lanes <file>: one record per lane, fields separated by \x1f: id role branch run_file wait_for done_when
lanes() {
  awk -v RS='' -v OFS='\037' '
    /(^|\n)lane:/ {
      id=role=branch=run=waitf=done=""
      n = split($0, L, "\n")
      for (i = 1; i <= n; i++) {
        line = L[i]; k = line; sub(/:.*/, "", k); v = line; sub(/^[^:]*: */, "", v)
        if (k == "lane") id = v; else if (k == "role") role = v; else if (k == "branch") branch = v
        else if (k == "run_file") run = v; else if (k == "wait_for") waitf = v; else if (k == "done_when") done = v
      }
      if (id != "") print id, role, branch, run, waitf, done
    }' <<<"$1"
}
block() { awk -v RS='' -v id="$2" '$0 ~ ("(^|\n)lane: *" id "(\n|$)")' <<<"$1"; }
has_subject() { # has_subject <branch> <subject>
  git log --format=%s "origin/$1" -400 2>/dev/null | grep -qxF "$2"
}

while [ "$(date +%s)" -lt "$end" ]; do
  git fetch -q origin ops/seats 2>/dev/null
  file="$(git show "origin/ops/seats:seats/seat-$seat.md" 2>/dev/null)"
  max="$(sed -n 's/^max_agents: *//p' <<<"$file" | head -1)"
  new=(); gone=(); done_ids=(); listed=","
  fetched=","
  while IFS=$'\037' read -r id role branch run waitf donew; do
    [ -n "$id" ] || continue
    listed="$listed$id,"
    if [[ "$fetched" != *",$branch,"* ]]; then git fetch -q origin "$branch" 2>/dev/null; fetched="$fetched$branch,"; fi
    if [ -n "$donew" ] && has_subject "$branch" "$donew"; then
      [[ "$running" == *",$id,"* ]] && done_ids+=("$id")
      continue
    fi
    [[ "$running" == *",$id,"* ]] && continue
    [ "$role" = idle ] && continue
    if [ -n "$waitf" ] && [ "$waitf" != none ] && ! has_subject "$branch" "$waitf"; then continue; fi
    new+=("$id")
  done < <(lanes "$file")
  IFS=',' read -r -a run_ids <<<"${2:-}"
  for r in "${run_ids[@]}"; do [ -n "$r" ] && [[ "$listed" != *",$r,"* ]] && gone+=("$r"); done
  if [ ${#new[@]} -gt 0 ] || [ ${#gone[@]} -gt 0 ] || [ ${#done_ids[@]} -gt 0 ]; then
    echo "MAX ${max:-3}"
    for g in "${gone[@]}"; do echo "GONE $g"; done
    for d in "${done_ids[@]}"; do echo "DONE $d"; done
    for n in "${new[@]}"; do echo "NEW $n"; done
    for n in "${new[@]}"; do echo "---"; block "$file" "$n"; done
    exit 0
  fi
  sleep 60
done
echo WAIT
