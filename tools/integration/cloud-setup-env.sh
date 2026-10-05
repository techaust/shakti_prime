#!/usr/bin/env bash
# cloud-setup-env.sh: the text pasted into the Setup script box of the cloud environment
# `shakti_prime` (docs/runbooks/hybrid.md §3). The box runs before the checkout is in the session's
# working directory, so it looks for the repository's tools/integration/cloud-setup.sh and runs it;
# when the checkout is not on disk yet it installs Node 24 and pnpm, and the session-start hook
# (.claude/hooks/cloud-session.sh) installs the packages, the test browser, Docker and Postgres.
# Always ends with 0, so the session starts.
set -uo pipefail
f=$(find / -maxdepth 6 -path '*/tools/integration/cloud-setup.sh' -not -path '*/node_modules/*' 2>/dev/null | head -1)
if [ -n "$f" ]; then
  echo "[cloud-setup] running $f"
  bash "$f"
  exit 0
fi
echo "[cloud-setup] checkout not found yet; installing Node 24 and pnpm only"
want=24
have=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$have" -lt "$want" ]; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) arch=unknown ;; esac
  base="https://nodejs.org/dist/latest-v${want}.x"
  sums=$(curl -fsSL "$base/SHASUMS256.txt" || true)
  file=$(echo "$sums" | grep -oE "node-v[0-9.]+-linux-${arch}\.tar\.xz" | head -1)
  expected=$(echo "$sums" | grep " ${file}\$" | cut -d' ' -f1)
  if [ -n "$file" ] && [ -n "$expected" ] && curl -fsSL -o "/tmp/$file" "$base/$file" &&
    [ "$(sha256sum "/tmp/$file" | cut -d' ' -f1)" = "$expected" ] &&
    tar -xJf "/tmp/$file" -C /usr/local --strip-components=1; then
    echo "[cloud-setup] Node $(/usr/local/bin/node --version) installed"
  else
    echo "[cloud-setup] WARNING: Node $want could not be installed"
  fi
fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable >/dev/null 2>&1 || echo "[cloud-setup] WARNING: corepack enable failed"
echo "[cloud-setup] done"
exit 0
