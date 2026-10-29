#!/usr/bin/env bash
# cloud-capacity.sh --agents <n> --browser-agents <n> [--browser]: may the lead start one more agent
# in this cloud VM (docs/runbooks/models-and-usage.md §3, hybrid.md §5)? The lead passes how many
# agents it has running and how many of them drive a browser (journeys, e2e:snap); --browser asks
# for an agent that will drive one. Exits 0 and prints "yes" when every rule holds, or exits 1 and
# names each rule that does not:
#   - at least 3 GB of memory available (MemAvailable of /proc/meminfo, as free -m shows it)
#   - the 1-minute load average below the processor count (nproc)
#   - fewer than five agents running
#   - with --browser, fewer than two of them driving a browser
# It also prints the slots' Postgres containers and the Playwright runs it can see, so a count the
# lead passes can be checked against them. Linux only; on the PC the rule is two agents, one browser.
set -uo pipefail
MIN_AVAILABLE_MB=3072
MAX_AGENTS=5
MAX_BROWSER_AGENTS=2

usage() { echo "usage: $0 --agents <n> --browser-agents <n> [--browser]" >&2; exit 2; }
count() { case "$1" in ''|*[!0-9]*) usage ;; esac; }
agents='' browser_agents='' browser=0
while [ $# -gt 0 ]; do
  case "$1" in
    --agents) [ $# -ge 2 ] || usage; agents="$2"; shift 2 ;;
    --browser-agents) [ $# -ge 2 ] || usage; browser_agents="$2"; shift 2 ;;
    --browser) browser=1; shift ;;
    *) usage ;;
  esac
done
count "$agents"
count "$browser_agents"
if [ "$(uname -s)" != Linux ]; then
  echo "cloud-capacity.sh runs only in a cloud session (Linux); on the PC the rule is two agents, one browser" >&2
  exit 2
fi

available_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
cpus=$(nproc)
load=$(cut -d' ' -f1 /proc/loadavg)
slots=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c '^shakti-pg-' || true)
playwright_runs=$(pgrep -fc 'playwright test' 2>/dev/null || true)
playwright_runs=${playwright_runs:-0}

echo "memory available ${available_mb} MB, load ${load}/${cpus}, agents ${agents} (browser ${browser_agents}); seen: ${slots} slot database(s), ${playwright_runs} Playwright run(s)"

refused=0
no() { echo "no: $*"; refused=1; }
[ "$available_mb" -ge "$MIN_AVAILABLE_MB" ] || no "${available_mb} MB available, under $MIN_AVAILABLE_MB MB"
awk -v l="$load" -v c="$cpus" 'BEGIN { exit !(l < c) }' || no "load $load is not below $cpus processors"
[ "$agents" -lt "$MAX_AGENTS" ] || no "$agents agents running, the most is $MAX_AGENTS"
if [ "$browser" = 1 ] && [ "$browser_agents" -ge "$MAX_BROWSER_AGENTS" ]; then
  no "$browser_agents agents drive a browser, the most is $MAX_BROWSER_AGENTS"
fi
[ "$refused" = 0 ] && echo "yes"
exit "$refused"
