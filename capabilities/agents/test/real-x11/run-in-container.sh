#!/usr/bin/env bash
# Phase 58 manual harness: runs the production LinuxTerminalFocuser (wmctrl / xdotool) against real
# xterm windows under Xvfb + openbox in a throwaway ubuntu:24.04 container (image must already be
# present locally: this never pulls and builds no image). Usage (repo root, Node 22):
#   bash capabilities/agents/test/real-x11/run-in-container.sh [out-dir]
# Output: <out-dir>/raw.json (default /tmp/phoenix-real-x11-out). Nothing is asserted: read the output.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
OUT=${1:-/tmp/phoenix-real-x11-out}
NAME=phoenix-real-x11-$RANDOM
BUNDLE=$(mktemp -t phoenix-jump).mjs
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f "$BUNDLE"; }
trap cleanup EXIT
"$ROOT/node_modules/.bin/esbuild" "$HERE/jump-entry.ts" --bundle --platform=node --format=esm \
  --target=node22 --outfile="$BUNDLE" --log-level=warning
docker run -d --label phoenix-real-test=1 --rm --name "$NAME" ubuntu:24.04 sleep 3600 >/dev/null
docker exec "$NAME" mkdir -p /work
docker cp "$BUNDLE" "$NAME:/work/jump.mjs"
docker cp "$HERE/inner.sh" "$NAME:/work/inner.sh"
docker exec "$NAME" bash /work/inner.sh
rm -rf "$OUT"; mkdir -p "$OUT"
docker cp "$NAME:/work/out/." "$OUT/"
echo "results in $OUT"
