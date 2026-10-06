#!/usr/bin/env bash
# cloud-setup.sh: the setup script of the Claude Code cloud environment `shakti_prime`
# (docs/runbooks/hybrid.md §3). It runs as root on the session's Ubuntu VM before Claude starts,
# and what it leaves on disk is kept in the environment's snapshot. Linux only. Idempotent: each
# step checks before it acts, so running it again changes nothing that is already in place.
#   1. Node of .node-version (the image ships older ones) and the pnpm of package.json, from npm.
#   2. In parallel: the packages, then the Playwright Chromium the journeys use on the host
#      (apps/web/playwright.config.ts: Desktop Chrome and Pixel 7, both Chromium); and the Docker
#      images: Postgres (compose.yaml), gitleaks (CI's version; from Docker Hub when ghcr.io is
#      refused) and the Linux Playwright image of the screenshot baselines
#      (apps/web/e2e/setup/snap-in-linux.ts).
#   3. The Chromium builds of @playwright/test in $PLAYWRIGHT_BROWSERS_PATH, copied from that image.
# A step that fails prints a warning and the others go on; the script always ends with 0 so the
# session starts, and the session-start hook (.claude/hooks/cloud-session.sh) says what is missing.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 0
. tools/integration/lib.sh
say() { echo "[cloud-setup] $*"; }
warnings=0
warn() { say "WARNING: $*"; warnings=$((warnings + 1)); }

# 1. Node and pnpm.
want=$(cut -d. -f1 < .node-version | tr -dc '0-9')
have=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$have" -lt "$want" ]; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) arch=unknown ;; esac
  base="https://nodejs.org/dist/latest-v${want}.x"
  sums=$(curl -fsSL "$base/SHASUMS256.txt" || true)
  file=$(echo "$sums" | grep -oE "node-v[0-9.]+-linux-${arch}\.tar\.xz" | head -1)
  expected=$(echo "$sums" | grep " ${file}\$" | cut -d' ' -f1)
  # The archive is unpacked only when its SHA-256 matches the sum nodejs.org publishes for it.
  if [ -n "$file" ] && [ -n "$expected" ] && curl -fsSL -o "/tmp/$file" "$base/$file" &&
    [ "$(sha256sum "/tmp/$file" | cut -d' ' -f1)" = "$expected" ] &&
    tar -xJf "/tmp/$file" -C /usr/local --strip-components=1; then
    hash -r
    say "Node $(node --version) installed in /usr/local"
  else
    warn "Node $want could not be installed from nodejs.org"
  fi
else
  say "Node $(node --version) is in place"
fi
# corepack cannot start pnpm 12 (it looks for pnpm.cjs), so pnpm of package.json comes from npm.
export PATH="/usr/local/bin:$PATH"
want_pnpm=$(grep -m1 -oE '"packageManager": *"pnpm@[0-9.]+' package.json | grep -oE '[0-9.]+$')
if [ "$(pnpm --version 2>/dev/null)" != "$want_pnpm" ]; then
  corepack disable pnpm >/dev/null 2>&1 || true
  npm install -g "pnpm@$want_pnpm" >/tmp/cloud-setup-pnpm.log 2>&1 || warn "pnpm $want_pnpm did not install"
fi
pnpm --version >/dev/null 2>&1 || warn "pnpm (package.json packageManager) is not available"

# 2a. Packages, then the browser.
packages() {
  pnpm install --frozen-lockfile >/tmp/cloud-setup-install.log 2>&1 ||
    { echo "pnpm install failed (/tmp/cloud-setup-install.log)"; return 1; }
  pnpm --filter web exec playwright install --with-deps chromium >/tmp/cloud-setup-browser.log 2>&1 ||
    { echo "the Playwright Chromium did not install (/tmp/cloud-setup-browser.log)"; return 1; }
}

# 2b. Images, each pulled only when missing.
images() {
  ensure_docker || { echo "Docker did not start; no image pulled"; return 1; }
  local rc=0 image
  for image in "$(pg_image)" "$(playwright_image)"; do
    docker image inspect "$image" >/dev/null 2>&1 && continue
    docker pull -q "$image" >/dev/null 2>&1 || { echo "docker pull $image failed"; rc=1; }
  done
  ensure_gitleaks_image || { echo "the gitleaks image came from neither ghcr.io nor Docker Hub"; rc=1; }
  return $rc
}

packages >/tmp/cloud-setup-packages.out 2>&1 &
p1=$!
images >/tmp/cloud-setup-images.out 2>&1 &
p2=$!
wait $p1 && say "packages and the Playwright Chromium are in place" || warn "$(cat /tmp/cloud-setup-packages.out)"
wait $p2 && say "the Postgres, gitleaks and Playwright images are in place" || warn "$(cat /tmp/cloud-setup-images.out)"
# The image may point PLAYWRIGHT_BROWSERS_PATH at an older Chromium; the builds @playwright/test
# runs are copied from the Playwright image (both steps above are done by now).
ensure_playwright_browsers && say "the journeys' Chromium builds are in place" ||
  warn "the journeys' Chromium builds ($(playwright_chromium_dirs)) are missing"

say "done with $warnings warning(s)"
exit 0
