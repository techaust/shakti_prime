#!/usr/bin/env bash
# fresh-db.sh <container> <port>: replace a worktree's Postgres with an empty one. Linux
# screenshot baselines are made only on such a database, never on one the security suite used.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
start_db "$1" "$2" && echo "$1 healthy on $2"
