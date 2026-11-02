#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"

node "$ROOT/src/build.mjs"

mkdir -p "$OPENCODE_DIR/agents" "$OPENCODE_DIR/plugins"
find "$OPENCODE_DIR/agents" -type l -lname "$ROOT/dist/*" ! -exec test -e {} \; -delete
for agent in "$ROOT"/dist/agents/*.md; do
  ln -sf "$agent" "$OPENCODE_DIR/agents/$(basename "$agent")"
done
ln -sf "$ROOT/dist/plugin/index.ts" "$OPENCODE_DIR/plugins/turbo-brilliance.ts"
echo "linked agents and plugin into $OPENCODE_DIR"
node "$ROOT/src/configure.mjs" "$OPENCODE_DIR" "$ROOT/dist/overlays.json"
