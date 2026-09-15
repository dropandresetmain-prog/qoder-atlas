#!/usr/bin/env bash
# Cloud Agent install step for Northstar (qoder-atlas).
#
# Prepares a fresh Cloud Agent VM to build, run and test the project:
#   * ensures Node 24 (package.json requires Node >=24; `npm run dev` relies on
#     Node's native TypeScript stripping, which is only on by default in 23.6+),
#   * installs pinned npm dependencies from the lockfile,
#   * installs the Chromium build the Playwright e2e suite drives.
#
# Idempotent: safe to run repeatedly against cached or partial state.
set -euo pipefail

# Resolve repo root regardless of the directory this script is invoked from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- Node 24 via nvm --------------------------------------------------------
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  # Cloud Agent base images normally ship nvm; install it if it is missing so
  # this script also works on a bare image.
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

nvm install 24
nvm alias default 24

# The runtime injects /exec-daemon early in PATH with an older node, so prepend
# the Node 24 bin directory explicitly for the rest of this script.
NODE24_BIN="$(dirname "$(nvm which 24)")"
export PATH="$NODE24_BIN:$PATH"

echo "using node $(node --version) / npm $(npm --version)"

# --- Project dependencies ---------------------------------------------------
npm ci

# --- Playwright browser for the e2e test suite ------------------------------
# test/e2e/*.test.ts drive Chromium via Playwright. Browser system libraries
# need apt (sudo); fall back to a browser-only install if that is unavailable.
if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  npx --yes playwright install --with-deps chromium || npx --yes playwright install chromium
else
  npx --yes playwright install chromium
fi

echo "install complete"
