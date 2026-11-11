#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Phoenix contributors
#
# MANUAL harness (not run by vitest or CI). Phases 63 and 72: exercises the PRODUCTION Linux code for
#   A. the Secret Service: KeychainSecretStore("linux") -> real `secret-tool` -> gnome-keyring, and
#   B. the keep-awake hold: SessionController + createInhibitor(realEnv()) -> real `systemd-inhibit`
#      under a real systemd (logind) running as PID 1 of a privileged container.
# Needs: Docker (Colima is fine) with the local image ubuntu:24.04 (NEVER pulled here: `docker run`
# of a local image does not pull; apt inside the container reaches the network), and the repo's
# Node 22 + node_modules (esbuild bundles the production TypeScript on the host).
#
#   core/persistence/test/real-linux/run-in-container.sh [OUT_DIR]      (default /tmp/phoenix-real-linux)
#
# Safety: every container is labelled phoenix-real-test=1, started with --rm, and removed by the EXIT
# trap (only containers carrying that label are touched). Nothing is bind-mounted (a /tmp file does
# not mount under Colima): files go in with `docker cp`, scripts on stdin. Container B uses
# --privileged because systemd needs it; under Colima that is the Linux VM, not macOS, and the
# docker socket and host paths are never mounted. Fake secret values are made at run time from
# random bytes; reports carry lengths and SHA-256 prefixes only. The container keyring is headless
# and unlocked with the throwaway password "pw": it says nothing about a desktop session's prompt.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
OUT="${1:-/tmp/phoenix-real-linux}"
IMAGE="${PHOENIX_LINUX_IMAGE:-ubuntu:24.04}"
NODE22="${NODE22:-/Users/bluephoenix/.nvm/versions/node/v22.19.0/bin}"
A=phx-real-linux-secret
B=phx-real-linux-systemd
mkdir -p "$OUT"
export PATH="$NODE22:$PATH"

cleanup() {
  local ids
  ids="$(docker ps -aq --filter label=phoenix-real-test=1 || true)"
  if [ -n "$ids" ]; then docker rm -f $ids >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

echo "== images/containers before: $(docker images -q | wc -l | tr -d ' ') images, $(docker ps -aq | wc -l | tr -d ' ') containers"

# Bundle the production code. node:sqlite (pulled in through the persistence barrel, unused here) is
# stubbed; Promise.withResolvers (Node 22) is polyfilled because Ubuntu 24.04 apt ships Node 18.
cd "$ROOT"
./node_modules/.bin/esbuild core/persistence/test/real-linux/entry.ts --bundle --platform=node \
  --target=node18 --format=cjs --outfile="$OUT/store.cjs" --log-level=warning \
  --banner:js="const __M=require('module');const __o=__M._load;__M._load=function(r,...a){return r==='node:sqlite'?{}:__o.call(this,r,...a)};"
./node_modules/.bin/esbuild capabilities/awake/test/support/real-linux-awake-child.ts --bundle \
  --platform=node --target=node18 --format=cjs --outfile="$OUT/awake-child.cjs" --log-level=warning \
  --banner:js="if(!Promise.withResolvers){Promise.withResolvers=function(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}}"

# ---------------------------------------------------------------- PART A: Secret Service
docker run -d --rm --label phoenix-real-test=1 --name "$A" "$IMAGE" sleep 3000 >/dev/null
docker exec "$A" bash -c 'apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libsecret-tools gnome-keyring dbus-x11 nodejs >/dev/null 2>&1; mkdir -p /tmp/xdg; chmod 700 /tmp/xdg'
docker cp "$HERE/wrapper.sh" "$A:/usr/local/bin/secret-tool"
docker cp "$HERE/probe.cjs" "$A:/tmp/probe.cjs"
docker cp "$OUT/store.cjs" "$A:/tmp/store.cjs"
docker exec "$A" chmod +x /usr/local/bin/secret-tool
{
  echo "image: $IMAGE"; docker exec "$A" bash -c '. /etc/os-release; echo "$PRETTY_NAME"; uname -m; node --version; dpkg -l libsecret-tools gnome-keyring dbus | grep "^ii" | awk "{print \$2, \$3}"'
} > "$OUT/versions-secret.txt"

# The recipe: a private session bus, gnome-keyring started with --login (creates the unlocked
# "login" collection from a throwaway password). `--unlock` fails with "Object does not exist".
docker exec -i "$A" bash -s <<'SCRIPT'
cat > /tmp/inner.sh <<'EOF'
eval "$(printf 'pw\n' | gnome-keyring-daemon --login --components=secrets 2>/dev/null)"
export GNOME_KEYRING_CONTROL SSH_AUTH_SOCK
sleep 1
exec "$@"
EOF
cat > /tmp/inner-locked.sh <<'EOF'
exec "$@"
EOF
SCRIPT

run_in_a() { docker exec "$A" bash -c "export XDG_RUNTIME_DIR=/tmp/xdg PATH=/usr/local/bin:\$PATH; rm -f /tmp/wlog.jsonl; $1"; }
echo "== A1 session probe (production store, real secret-tool, unlocked keyring)"
run_in_a 'dbus-run-session -- bash /tmp/inner.sh node /tmp/probe.cjs session 2>/dev/null' > "$OUT/out-session.json"
echo "== A2 no D-Bus session at all"
run_in_a 'unset DBUS_SESSION_BUS_ADDRESS; timeout 120 node /tmp/probe.cjs nodbus 2>/dev/null' > "$OUT/out-nodbus.json"
echo "== A3 D-Bus session, keyring never unlocked"
run_in_a 'timeout 150 dbus-run-session -- bash /tmp/inner-locked.sh node /tmp/probe.cjs locked 2>/dev/null' > "$OUT/out-locked.json"
echo "== A4 raw secret-tool length boundary (no Phoenix code)"
docker exec -i "$A" bash -s > "$OUT/secret-tool-length-boundary.txt" 2>&1 <<'SCRIPT' || true
export XDG_RUNTIME_DIR=/tmp/xdg
cat > /tmp/b.sh <<'EOF'
for n in 8190 8191 8192 8193 9000 1048576; do
  head -c $n /dev/zero | tr '\0' a | /usr/bin/secret-tool store --label t service phoenix account c$n 2>/tmp/err; rc=$?
  echo "ascii bytes=$n store_exit=$rc stderr=[$(cat /tmp/err)] lookup_bytes=$(/usr/bin/secret-tool lookup service phoenix account c$n | wc -c)"
  /usr/bin/secret-tool clear service phoenix account c$n
done
for c in 4096 4097; do
  node -e "process.stdout.write('\u00e9'.repeat($c))" | /usr/bin/secret-tool store --label t service phoenix account m$c 2>/tmp/err; rc=$?
  echo "2-byte chars=$c bytes=$((c*2)) store_exit=$rc stderr=[$(cat /tmp/err)] lookup_bytes=$(/usr/bin/secret-tool lookup service phoenix account m$c | wc -c)"
  /usr/bin/secret-tool clear service phoenix account m$c
done
EOF
dbus-run-session -- bash /tmp/inner.sh bash /tmp/b.sh 2>/dev/null
SCRIPT
docker rm -f "$A" >/dev/null

# ---------------------------------------------------------------- PART B: systemd-inhibit
docker run -d --rm --privileged --cgroupns=host --label phoenix-real-test=1 --name "$B" "$IMAGE" \
  bash -c 'apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq systemd systemd-sysv dbus procps nodejs >/dev/null 2>&1; exec /sbin/init' >/dev/null
echo "== B waiting for systemd (up to 120 s)"
for _ in $(seq 1 60); do
  if docker exec "$B" bash -c 'test "$(ps -p 1 -o comm=)" = systemd && command -v node >/dev/null && systemctl is-system-running 2>/dev/null | grep -qE "^(running|degraded)$"'; then break; fi
  sleep 2
done
docker cp "$OUT/awake-child.cjs" "$B:/tmp/awake-child.cjs"
docker exec "$B" bash -c '. /etc/os-release; echo "$PRETTY_NAME"; node --version; systemd-inhibit --version | head -1; echo "pid1=$(ps -p 1 -o comm=) state=$(systemctl is-system-running)"' > "$OUT/versions-systemd.txt"
echo "== B0 plain container (no systemd) for contrast"
docker run --rm --label phoenix-real-test=1 "$IMAGE" bash -c 'apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq systemd >/dev/null 2>&1; systemd-inhibit --what=idle sleep 1; echo "exit=$?"' > "$OUT/systemd-inhibit-plain-container.txt" 2>&1 || true

docker exec -i "$B" bash -s > "$OUT/awake-hold.log" 2>&1 <<'SCRIPT' || true
cd /tmp
list() { systemd-inhibit --list --no-pager | grep Phoenix || echo "(no Phoenix inhibitor)"; }
host_of() { grep -o '"hostPid":[0-9]*' "$1" | cut -d: -f2; }
echo "### 1. hold appears (production SessionController -> createInhibitor -> systemd-inhibit)"
(setsid node awake-child.cjs plain < <(sleep 900) > /tmp/p.out 2>&1 &); sleep 2
cat /tmp/p.out; H=$(host_of /tmp/p.out)
ps -eo pid,ppid,args | grep -E "systemd-inhibit|sleep 60" | grep -v grep; list
echo "### 2. SIGKILL of the host (Core) at $(date +%T)"
kill -9 "$H"; K=$(date +%s)
ps -eo pid,ppid,args | grep -E "systemd-inhibit|sleep 60" | grep -v grep
for i in 1 2 3; do sleep 1; echo "+$(( $(date +%s)-K ))s: $(systemd-inhibit --list --no-pager | grep -c Phoenix) Phoenix inhibitor(s)"; done
echo "waiting for the hold's own sleep 60 to end it..."
for i in $(seq 1 70); do systemd-inhibit --list --no-pager | grep -q Phoenix || break; sleep 1; done
echo "hold gone $(( $(date +%s)-K )) s after the SIGKILL (the hold was a 60 s piece)"
echo "### 3. renewal: 60-minute session, timers x60 (15 min renewal -> 15 s)"
(setsid node awake-child.cjs renew < <(sleep 900) > /tmp/r.out 2>&1 &); sleep 2; HR=$(host_of /tmp/r.out)
for i in 1 2 3 4 5 6 7; do sleep 5; echo "t=$((i*5))s: $(systemd-inhibit --list --no-pager | grep Phoenix | awk '{print $4}' | tr '\n' ' ')"; done
cat /tmp/r.out
echo "SIGKILL host of the renewing session; the current 1800 s piece:"
kill -9 "$HR"; sleep 1
ps -eo pid,ppid,etimes,args | grep -E "sleep 1800" | grep -v grep; list
pkill -f "sleep 1800" || true; pkill -f "systemd-inhibit --what" || true; sleep 1; list
echo "### 4. SIGTERM of the host (no exit handler can run any code of ours beyond realSpawner's)"
(setsid node awake-child.cjs plain < <(sleep 900) > /tmp/t.out 2>&1 &); sleep 2; HT=$(host_of /tmp/t.out)
kill -TERM "$HT"; sleep 1; list
pkill -f "systemd-inhibit --what" || true; sleep 1
echo "### 5. clean end through the controller (stdin cancel)"
(setsid node awake-child.cjs plain < <(sleep 2; echo cancel; sleep 900) > /tmp/c.out 2>&1 &); sleep 4
cat /tmp/c.out | tr '\n' ' '; echo; list
pkill -f awake-child.cjs || true
SCRIPT
docker rm -f "$B" >/dev/null

echo "== images/containers after: $(docker images -q | wc -l | tr -d ' ') images, $(docker ps -aq | wc -l | tr -d ' ') containers"
echo "== leftover phoenix-real-test containers: $(docker ps -aq --filter label=phoenix-real-test=1 | wc -l | tr -d ' ')"
echo "Output in $OUT"
