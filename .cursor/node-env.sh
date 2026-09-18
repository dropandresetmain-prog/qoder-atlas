# Put Node 24 on PATH ahead of the Cloud Agent runtime's injected node.
#
# The Cloud Agent VM injects /exec-daemon early in PATH with its own (older)
# Node. `nvm use` alone does not reliably win that ordering, so we resolve the
# Node 24 bin directory and prepend it explicitly. Source this file (do not
# execute it) from any shell that needs to run the project's `node`/`npm`.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if command -v nvm >/dev/null 2>&1; then
  _northstar_node24="$(nvm which 24 2>/dev/null || true)"
  if [ -n "$_northstar_node24" ]; then
    export PATH="$(dirname "$_northstar_node24"):$PATH"
  fi
  unset _northstar_node24
fi
