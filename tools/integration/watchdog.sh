#!/usr/bin/env bash
# watchdog.sh: every 5 minutes, one line per slice worktree idle for 20 minutes (no commit, no
# file change, no running node process and no shell waiting for the heavy-command lock). Run it
# under a monitor. Slugs listed one per line in $WT_ROOT/.done are skipped.
. "$(dirname "$0")/lib.sh"
ROOT="$(wt_root)"

node_procs() {
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe' or name='bash.exe'\" | ForEach-Object { \$_.CommandLine }" 2>/dev/null
  else
    ps -eo args 2>/dev/null | grep -E '(^|/)node |heavy\.sh'
  fi
}

while true; do
  now=$(date +%s)
  procs=$(node_procs)
  for wt in "$ROOT"/*/; do
    slug=$(basename "$wt")
    grep -qx "$slug" "$ROOT/.done" 2>/dev/null && continue
    [ -e "$wt/.git" ] || continue
    last_commit=$(git -C "$wt" log -1 --format=%ct 2>/dev/null || echo 0)
    last_file=$(find "$wt" -path "$wt/node_modules" -prune -o -path "*/.turbo" -prune -o -type f -newermt "-20 minutes" -print -quit 2>/dev/null)
    running=$(printf '%s\n' "$procs" | grep -c "$(basename "$ROOT")[\\/]$slug")
    if [ $((now - last_commit)) -gt 1200 ] && [ -z "$last_file" ] && [ "$running" -eq 0 ]; then
      echo "IDLE $slug: no commit for $(((now - last_commit) / 60)) min, no file change in 20 min, no running process"
    fi
  done
  sleep 300
done
