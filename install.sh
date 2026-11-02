#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_LINK="$OPENCODE_DIR/plugins/turbo-brilliance.ts"

uninstall() {
  if [ -d "$OPENCODE_DIR/agents" ]; then
    find "$OPENCODE_DIR/agents" -type l -lname "$ROOT/dist/*" -delete
  fi
  if [ "$(readlink "$PLUGIN_LINK" 2>/dev/null)" = "$ROOT/dist/plugin/index.ts" ]; then
    rm "$PLUGIN_LINK"
  fi
  node "$ROOT/src/configure.mjs" --uninstall "$OPENCODE_DIR"
  echo "removed agents, plugin and config entries from $OPENCODE_DIR"
}

install() {
  node "$ROOT/src/build.mjs"
  mkdir -p "$OPENCODE_DIR/agents" "$OPENCODE_DIR/plugins"
  find "$OPENCODE_DIR/agents" -type l -lname "$ROOT/dist/*" ! -exec test -e {} \; -delete
  for agent in "$ROOT"/dist/agents/*.md; do
    ln -sf "$agent" "$OPENCODE_DIR/agents/$(basename "$agent")"
  done
  ln -sf "$ROOT/dist/plugin/index.ts" "$PLUGIN_LINK"
  echo "linked agents and plugin into $OPENCODE_DIR"
  node "$ROOT/src/configure.mjs" "$OPENCODE_DIR" "$ROOT/dist/overlays.json"
}

case "${1:-}" in
  --uninstall) uninstall ;;
  "") install ;;
  *) echo "usage: $0 [--uninstall]" >&2; exit 1 ;;
esac
