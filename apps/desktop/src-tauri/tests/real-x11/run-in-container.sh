#!/usr/bin/env bash
# Manual real-X11 harness for the dictation hotkey (XRecord) and paste (GTK clipboard + XTest).
# NOT part of CI. Run from anywhere:   bash apps/desktop/src-tauri/tests/real-x11/run-in-container.sh [out-dir]
#
# Needs a running Docker daemon and the rust:1-bookworm image already present (it never pulls).
# It starts ONE labelled container, `docker cp`s the REAL dictation_keys.rs / dictation_hotkey.rs /
# dictation_paste.rs plus the throwaway crate files in this directory into it (bind mounts of single
# files are unreliable on Colima), feeds inner.sh over stdin, writes the captured output to
# <out-dir>/real-x11-dictation.log and a JSON split of the sections to real-x11-dictation-raw.json,
# then removes the container. No image is built. The throwaway crate is only a build wrapper:
# harness-Cargo.toml.in + harness-main.rs.in (the driver; logs events and wraps the real Linux
# platform), nothing of the production logic is rewritten.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/../../src"
lock="$here/../../Cargo.lock"
out="${1:-$here/out}"
mkdir -p "$out"
name="phoenix-real-x11dict-$RANDOM"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --label phoenix-real-test=1 --name "$name" rust:1-bookworm sleep 3600 >/dev/null
docker exec "$name" mkdir -p /work/src
for f in dictation_keys.rs dictation_hotkey.rs dictation_paste.rs; do docker cp "$src/$f" "$name:/work/src/$f"; done
docker cp "$lock" "$name:/work/Cargo.lock"
docker cp "$here/harness-Cargo.toml.in" "$name:/work/Cargo.toml"
docker cp "$here/harness-main.rs.in" "$name:/work/src/main.rs"
docker cp "$here/paste-target.py" "$name:/work/paste-target.py"
docker cp "$here/xrecord-reference.c" "$name:/work/xrecord-reference.c"
docker exec -i "$name" bash -s < "$here/inner.sh" | tee "$out/real-x11-dictation.log"

python3 - "$out/real-x11-dictation.log" "$out/real-x11-dictation-raw.json" <<'PY'
import json, re, sys
sections, cur, done = {}, None, False
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    line = line.rstrip("\n")
    m = re.match(r"@@BEGIN (\S+)", line)
    if m:
        cur = m.group(1); sections[cur] = []; continue
    if line.startswith("@@END"):
        cur = None; continue
    if line.startswith("@@DONE"):
        done = True; continue
    if cur:
        sections[cur].append(line)
json.dump({"complete": done, "sections": sections}, open(sys.argv[2], "w"), indent=2)
PY
echo "wrote $out/real-x11-dictation.log and $out/real-x11-dictation-raw.json"
