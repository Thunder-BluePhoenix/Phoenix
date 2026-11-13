#!/usr/bin/env bash
# Runs INSIDE the ubuntu:24.04 container (copied in and run by run-in-container.sh).
# Starts Xvfb + openbox + xterm windows, then runs the production LinuxTerminalFocuser bundle
# (/work/jump.mjs) against them and records every outcome as JSON lines in /work/out/raw.jsonl,
# verified independently with xdotool getactivewindow / xprop. Observation only: no pass/fail.
set -u
export DEBIAN_FRONTEND=noninteractive
mkdir -p /work/out && RAW=/work/out/raw.jsonl && : > "$RAW"
NODE_VERSION=${NODE_VERSION:-v22.19.0}

apt-get update -qq </dev/null >/dev/null 2>&1
apt-get install -y -qq --no-install-recommends xvfb x11-utils x11-xserver-utils wmctrl xdotool \
  openbox xterm jq curl xz-utils ca-certificates xauth fonts-dejavu-core </dev/null >/work/out/apt.log 2>&1 \
  || { echo "apt install failed"; tail -5 /work/out/apt.log; exit 1; }
curl -sSfL -m 120 "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-arm64.tar.xz" \
  | tar -xJ -C /opt && export PATH=/opt/node-$NODE_VERSION-linux-arm64/bin:$PATH
{
  echo "os: $(. /etc/os-release; echo "$PRETTY_NAME") $(uname -m)"
  echo "node: $(node -v)"
  for p in xvfb wmctrl xdotool openbox xterm x11-utils; do echo "$p: $(dpkg-query -W -f='${Version}' $p)"; done
} > /work/out/versions.txt
cat /work/out/versions.txt

export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 >/work/out/xvfb.log 2>&1 &
for i in $(seq 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.2; done
openbox >/work/out/openbox.log 2>&1 &
for i in $(seq 50); do xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id' && break; sleep 0.2; done
echo "wm: $(wmctrl -m | tr '\n' ' ')"
xprop -root _NET_SUPPORTED | grep -o '_NET_ACTIVE_WINDOW' | head -1
echo "desktops: $(wmctrl -d | wc -l)"

waitwin() { for i in $(seq 50); do wmctrl -l | grep -Fq -- "$1" && return 0; sleep 0.2; done; echo "WINDOW NOT SEEN: $1"; }
mkwin() { xterm -T "$1" -n "$1" -e sleep 3600 >/dev/null 2>&1 & waitwin "$1"; }
wid() { xdotool search --name "^$(printf '%s' "$1" | sed 's/[][\.*^$+?(){}|/]/\\&/g')\$" | head -1; }

mkwin baseline-xterm
mkwin proj-extra            # created before `proj`: substring decoy
mkwin proj
mkwin phoenix-test-A
mkwin phoenix-test-B
mkwin phoenix-test-C
mkwin dup-one
mkwin dup-two
mkwin 'my project'
mkwin -dash
mkwin 'aXXb'                # regex decoy for the project "a.*b" (no literal window exists)
mkwin 'cXXd'                # regex decoy created before the literal one
mkwin 'c.*d'
mkwin 'x+y'                 # literal exists; the regex x+y does not match it
mkwin 'foo('                # unbalanced paren: an invalid regex
mkwin '$(id>pwned)'
mkwin ';id>pwned2'
mkwin phoenix-min
mkwin phoenix-desk
BASE=$(wid baseline-xterm)
{ echo "--- wmctrl -l"; wmctrl -l; } > /work/out/windows.txt
cat /work/out/windows.txt

active_name() { xdotool getactivewindow getwindowname 2>/dev/null || echo "(none)"; }
JENV=""
jump() { # label project [pre-command]
  local label=$1 project=$2 pre=${3:-}
  xdotool set_desktop 0; xdotool windowmap "$(wid phoenix-min)" 2>/dev/null; xdotool windowactivate "$BASE"; sleep 0.4
  local before; before=$(active_name)
  [ -n "$pre" ] && eval "$pre"
  sleep 0.2
  local out; out=$(cd /work && env $JENV node /work/jump.mjs "$project" 2>/work/out/stderr.txt)
  [ -n "$out" ] || out=$(jq -cn --arg e "$(cat /work/out/stderr.txt)" '{ok:false,error:("node produced no output: "+$e)}')
  sleep 0.4
  local after root desk
  after=$(active_name); root=$(xprop -root _NET_ACTIVE_WINDOW | tr -d '\n'); desk=$(xdotool get_desktop)
  jq -cn --arg label "$label" --arg project "$project" --arg before "$before" --arg after "$after" \
    --arg root "$root" --arg desk "$desk" --argjson r "$out" \
    '{label:$label,project:$project,activeBefore:$before,activeAfter:$after,rootActive:$root,currentDesktop:$desk,result:$r}' >> "$RAW"
  tail -1 "$RAW" | jq -r '"\(.label): ok=\(.result.ok) method=\(.result.method // "-") ms=\(.result.ms) activeAfter=[\(.activeAfter)] desk=\(.currentDesktop) err=\(.result.error // "-")"'
  xdotool set_desktop_for_window "$(wid phoenix-desk)" 0 2>/dev/null
}

suite() { # tag
  local t=$1
  jump "$t/title A" /work/phoenix-test-A
  jump "$t/title B" /work/phoenix-test-B
  jump "$t/title C" /work/phoenix-test-C
  jump "$t/title A again" /work/phoenix-test-A
  jump "$t/no match" /work/nomatch-zzz
  jump "$t/substring 'phoenix-test' (3 windows)" /work/phoenix-test
  jump "$t/substring 'dup-' (2 windows)" /work/dup-
  jump "$t/'proj' vs 'proj-extra' created first" /work/proj
  jump "$t/upper-case title" /work/PHOENIX-TEST-A
  jump "$t/title with space" '/work/my project'
  jump "$t/leading dash" /work/-dash
  jump "$t/leading double dash, no such window" /work/--help
  jump "$t/regex 'a.*b', only decoy aXXb exists" '/work/a.*b'
  jump "$t/regex 'c.*d', decoy cXXd and literal c.*d" '/work/c.*d'
  jump "$t/regex 'x+y', literal window x+y exists" '/work/x+y'
  jump "$t/invalid regex 'foo(', literal window exists" '/work/foo('
  jump "$t/command substitution title" '/work/$(id>pwned)'
  jump "$t/semicolon title" '/work/;id>pwned2'
  jump "$t/minimised window" /work/phoenix-min 'xdotool windowminimize "$(wid phoenix-min)"'
  jump "$t/window on another desktop" /work/phoenix-desk 'xdotool set_desktop_for_window "$(wid phoenix-desk)" 1'
}

echo "=== phase 1: wmctrl + xdotool installed"
suite both
echo "=== no X: DISPLAY unset / wayland-style / dead DISPLAY"
JENV="-u DISPLAY";                                            jump "env/DISPLAY unset" /work/phoenix-test-A
JENV="-u DISPLAY WAYLAND_DISPLAY=wayland-0 XDG_SESSION_TYPE=wayland"; jump "env/wayland-style (WAYLAND_DISPLAY set, no DISPLAY)" /work/phoenix-test-A
JENV="DISPLAY=:98";                                           jump "env/DISPLAY=:98 (no server)" /work/phoenix-test-A
JENV=""
echo "=== phase 2: wmctrl removed (xdotool path)"
mv "$(command -v wmctrl)" /usr/bin/wmctrl.off
suite xdotool
echo "=== phase 3: both removed"
mv "$(command -v xdotool)" /usr/bin/xdotool.off
wmctrl() { /usr/bin/wmctrl.off "$@"; }
jump "none/title A" /work/phoenix-test-A
jump "none/no match" /work/nomatch-zzz
mv /usr/bin/xdotool.off /usr/bin/xdotool; mv /usr/bin/wmctrl.off /usr/bin/wmctrl

echo "=== injection side effects (must be empty)"
ls -la /work/pwned /work/pwned2 /pwned /pwned2 2>&1 | tee /work/out/injection-check.txt
jq -s . "$RAW" > /work/out/raw.json
echo done
