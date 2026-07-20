#!/bin/zsh
# Double-click this file in Finder to launch the AI Music IDE macOS development app.

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
cd "$PROJECT_DIR"

fail() {
  print -u2 -- "\nAI Music IDE could not start: $1"
  print -u2 -- "See README.md or README_zh.md for macOS prerequisites."
  exit 1
}

if (( ! $+commands[node] )); then
  fail "Node.js 24–25 is required."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 24 || NODE_MAJOR >= 26 )); then
  fail "Node.js 24–25 is required; found $(node --version)."
fi

if (( ! $+commands[cargo] )); then
  fail "Rust/Cargo is required by the Tauri desktop application."
fi

if (( $+commands[pnpm] )); then
  PNPM=(pnpm)
elif (( $+commands[corepack] )); then
  PNPM=(corepack pnpm)
else
  fail "pnpm (or Corepack) is required."
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  print -- "macOS launcher checks passed."
  print -- "Project: $PROJECT_DIR"
  print -- "Command: ${PNPM[*]} tauri dev"
  exit 0
fi

if [[ ! -x node_modules/.bin/tauri ]]; then
  print -- "Installing locked JavaScript dependencies (first run only)…"
  "${PNPM[@]}" install --frozen-lockfile || fail "Dependency installation failed."
fi

print -- "\nStarting AI Music IDE…"
print -- "Close this Terminal window or press Control-C to stop the development app.\n"

# `tauri dev` normally starts Vite itself. If another local Vite server is already
# running on the documented development port, reuse it and launch just the native app.
if lsof -nP -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
  print -- "Using the existing local WebView server on port 1420."
  exec cargo run --no-default-features --manifest-path "$PROJECT_DIR/src-tauri/Cargo.toml"
else
  exec "${PNPM[@]}" tauri dev
fi
