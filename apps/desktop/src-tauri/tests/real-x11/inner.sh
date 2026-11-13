#!/usr/bin/env bash
# Runs INSIDE the rust:1-bookworm container (fed through `docker exec -i ... bash -s`).
# Expects /work/{Cargo.toml,Cargo.lock,src/{main,dictation_keys,dictation_hotkey,dictation_paste}.rs,
# paste-target.py,xrecord-reference.c} (copied by run-in-container.sh). Prints `@@BEGIN name` /
# `@@END name` sections the driver turns into the -raw.json. No numbers here are tuned: every
# scenario runs once, in this order, and the output is the evidence.
set -u
kill_all() { for p in "$@"; do case "$p" in -*) ;; *) pkill -x "$p" ;; esac; done; return 0; }
section() { echo "@@BEGIN $1"; }
endsection() { echo "@@END $1"; }

section setup
rustc --version; cargo --version
DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libgtk-3-dev libxtst-dev libx11-dev xvfb xdotool \
  openbox xterm x11-utils xclip python3-gi gir1.2-gtk-3.0 pkg-config >/tmp/apt.log 2>&1 \
  && echo "apt install ok" || { echo "apt install FAILED"; tail -5 /tmp/apt.log; }
cd /work
# The ONLY edit to the copied production source: export the private Linux `SystemPlatform` so the
# driver can wrap it. Everything else in the three files is byte-for-byte the repository's.
echo 'pub use system::SystemPlatform as HarnessSystemPlatform;' >> src/dictation_paste.rs
export CARGO_TARGET_DIR=/work/target
cargo build 2>&1 | grep -E 'error|Finished|Compiling dictation' | tail -5
grep -A1 -E '^name = "(x11-dl|gtk|libc)"$' Cargo.lock | grep -v '^--'
H=/work/target/debug/harness
gcc xrecord-reference.c -o /tmp/rec -lX11 -lXtst && echo "reference C XRecord client built"
endsection setup

Xvfb :99 -screen 0 1024x768x24 >/tmp/xvfb.log 2>&1 &
XVFB=$!
sleep 1
export DISPLAY=:99
openbox >/tmp/ob.log 2>&1 &
sleep 1
unset WAYLAND_DISPLAY XDG_SESSION_TYPE

section x_server
xdpyinfo -ext all 2>/dev/null | grep -E 'version number|RECORD|XTEST|vendor string'
endsection x_server

section session_detection
echo "--- X11 (DISPLAY=:99 only)";                         $H supported
echo "--- Wayland only (no DISPLAY, WAYLAND_DISPLAY=wayland-0)"; env -u DISPLAY WAYLAND_DISPLAY=wayland-0 $H supported
echo "--- XWayland-like (DISPLAY=:99 and WAYLAND_DISPLAY=wayland-0)"; WAYLAND_DISPLAY=wayland-0 $H supported
echo "--- XDG_SESSION_TYPE=wayland with DISPLAY=:99";      XDG_SESSION_TYPE=wayland $H supported
echo "--- XDG_SESSION_TYPE=x11, DISPLAY=:99";              XDG_SESSION_TYPE=x11 $H supported
echo "--- DISPLAY=:98 (nothing listening)";                DISPLAY=:98 $H supported 2>&1 | grep -v '^env '
echo "--- no DISPLAY, no WAYLAND_DISPLAY";                 env -u DISPLAY $H supported 2>&1 | grep -v '^x11_dl'
endsection session_detection

section missing_libxtst
LIBS=$(ls /usr/lib/*/libXtst.so* /usr/lib/libXtst.so* 2>/dev/null)
echo "libXtst files: $LIBS"
for f in $LIBS; do mv "$f" "$f.hidden"; done
$H supported 2>&1 | grep -v '^env '
for f in $LIBS; do mv "$f.hidden" "$f"; done
echo "restored; is_supported again:"; $H supported 2>&1 | grep -E 'is_supported|spawn_listener='
endsection missing_libxtst

# One scenario = start the production listener (with the production state machine on the 25 ms tick
# pill.rs uses), inject real XTest events from a second process, print what it emitted.
scenario() { # name  steps...
  name=$1; shift
  section "listener_$name"
  $H listen 5 1 >/tmp/l.log 2>&1 &
  LP=$!
  sleep 1.2
  HARNESS_XSYNC=1 $H inject "$@"
  wait $LP
  grep -v '^READY' /tmp/l.log
  endsection "listener_$name"
}
scenario hold_600ms          d:Control_R w:600 u:Control_R w:400
scenario double_tap_then_stop d:Control_R w:95 u:Control_R w:110 d:Control_R w:95 u:Control_R w:400 d:Control_R w:95 u:Control_R w:300
scenario tap_gap_too_long    d:Control_R w:95 u:Control_R w:500 d:Control_R w:95 u:Control_R w:400
scenario single_short_tap    d:Control_R w:95 u:Control_R w:600
scenario esc_while_idle      d:Escape w:60 u:Escape w:200
scenario esc_cancels_hold    d:Control_R w:400 d:Escape w:60 u:Escape w:100 u:Control_R w:300
scenario nontarget_keys      d:a w:30 u:a d:Shift_L w:30 u:Shift_L d:Control_L w:30 u:Control_L d:F5 w:30 u:F5 d:Shift_R w:30 u:Shift_R w:200
scenario combo_ctrlR_then_a  d:Control_R w:80 d:a w:50 u:a w:400 u:Control_R w:300
scenario left_ctrl_only      d:Control_L w:600 u:Control_L w:300
scenario paste_chord_default d:Control_L w:30 d:Alt_L w:30 d:v w:40 u:v w:30 u:Alt_L w:30 u:Control_L w:200
scenario chord_repeat        d:Control_L w:30 d:Alt_L w:30 d:v w:40 d:v w:40 u:v w:30 u:Alt_L u:Control_L w:200

section listener_xdotool_hold
$H listen 5 1 >/tmp/l.log 2>&1 & LP=$!
sleep 1.2; xdotool keydown Control_R; sleep 0.6; xdotool keyup Control_R; sleep 0.4
xdotool keydown Control_R; sleep 0.08; xdotool keyup Control_R; sleep 0.11; xdotool keydown Control_R; sleep 0.08; xdotool keyup Control_R; sleep 0.3
xdotool key Escape; sleep 0.3
wait $LP; grep -v '^READY' /tmp/l.log
endsection listener_xdotool_hold

section injector_flush_only_caveat
echo "Same hold as above but the injector only XFlush()es (no XSync) and stays alive between steps:"
$H listen 4 1 >/tmp/l.log 2>&1 & LP=$!
sleep 1; $H inject d:Control_R w:600 u:Control_R w:300
wait $LP; grep -v '^READY' /tmp/l.log
echo "Independent C XRecord client (xrecord-reference.c, not Phoenix code), same injection:"
/tmp/rec 4 >/tmp/rec.log & RP=$!
sleep 1; $H inject d:Control_R w:600 u:Control_R w:300
wait $RP; cat /tmp/rec.log
endsection injector_flush_only_caveat

section concurrent_listeners
$H listen 6 2 >/tmp/l.log 2>&1 & LP=$!
sleep 1.5
HARNESS_XSYNC=1 $H inject d:Control_R w:600 u:Control_R w:300 d:Escape w:50 u:Escape w:200
wait $LP; grep -v '^READY' /tmp/l.log
endsection concurrent_listeners

section esc_not_swallowed_xev
xev -geometry 200x200+0+0 -event keyboard >/tmp/xev.log 2>&1 & XP=$!
sleep 1; WID=$(xdotool search --name Event | head -1); xdotool windowfocus "$WID"; sleep 0.3
$H listen 4 1 >/tmp/l.log 2>&1 & LP=$!
sleep 1; HARNESS_XSYNC=1 $H inject d:Control_R w:400 d:Escape w:60 u:Escape w:100 u:Control_R w:300
wait $LP; kill $XP 2>/dev/null
grep -v '^READY' /tmp/l.log
echo "--- xev (the focused window) saw:"
grep -E '^(KeyPress|KeyRelease)|keycode' /tmp/xev.log | paste - - | sed 's/same_screen.*//'
endsection esc_not_swallowed_xev

section latency_100_cycles
HARNESS_XSYNC=1 $H latency 100
endsection latency_100_cycles

section drop_cycles
$H dropcycle 10
endsection drop_cycles

section x_server_dies
Xvfb :98 -screen 0 640x480x24 >/tmp/xvfb98.log 2>&1 & X98=$!
sleep 1
DISPLAY=:98 $H listen 8 1 >/tmp/l98.log 2>&1 & LP=$!
sleep 1.5; kill $X98; sleep 1
wait $LP; echo "harness exit code after X server died: $?"
cat /tmp/l98.log
endsection x_server_dies

# ------------------------------- paste -------------------------------
kill_all harness python3 xclip xterm 2>/dev/null
focus() { WID=$(xdotool search --name "$1" | head -1); xdotool windowfocus "$WID"; sleep 0.5; echo "focus: $(xdotool getwindowfocus getwindowname)"; }
setclip() { kill_all xclip 2>/dev/null; sleep 0.1; printf %s "$1" | xclip -selection clipboard -i; sleep 0.3; }
clip() { echo "xclip -o: [$(xclip -selection clipboard -o 2>&1)]"; }
newtarget() { kill_all python3 2>/dev/null; sleep 0.3; python3 /work/paste-target.py /tmp/out.txt "$@" >/tmp/target.log 2>&1 & sleep 2; focus phoenix-paste-target; }
# run paste $mode $text $hold  (foreground; the process keeps serving the clipboard for $hold s)
runpaste() { $H paste "$@" 2>&1; }

section paste_prod_protected_probe
newtarget
setclip PREVIOUS-CLIPBOARD; clip
runpaste prod "hello dictation" 1
echo "target field after: [$(cat /tmp/out.txt)]"
clip
echo "--- same, focused field is an invisible (password-style) GtkEntry"
kill_all python3; sleep 0.3
newtarget password
setclip PREVIOUS-CLIPBOARD
runpaste prod "into-password-field" 1
echo "target field after: [$(cat /tmp/out.txt)]"
clip
endsection paste_prod_protected_probe

section paste_wrapper_probe_overridden
echo "Wrapper (harness code) answers Ok(false) for secure_input; every other call is the REAL Linux platform."
newtarget
echo "##### A. plain GtkEntry, previous clipboard text PREVIOUS-CLIPBOARD, process alive while checking"
setclip PREVIOUS-CLIPBOARD
$H paste override "hello dictation" 3 >/tmp/p.log 2>&1 & PP=$!
for i in $(seq 1 60); do grep -q READY_HOLD /tmp/p.log && break; sleep 0.1; done
echo "target field after: [$(cat /tmp/out.txt)]"
echo "while the process is alive:"; clip
wait $PP; cat /tmp/p.log
echo "after the process exited (no clipboard manager in this container):"; clip

echo "##### B. a foreign copy is made during the restore wait"
kill_all python3; sleep 0.3; newtarget
setclip PREVIOUS-CLIPBOARD
runpaste override-meanwhile "second text" 1
echo "target field after: [$(cat /tmp/out.txt)]"
clip

echo "##### C. nothing on the clipboard at all (no selection owner)"
kill_all xclip harness 2>/dev/null; sleep 0.4
clip
runpaste override "third text" 1
echo "target field after: [$(cat /tmp/out.txt)]"

echo "##### C2. clipboard owned by a foreign process that offers no text target (empty string offered as UTF8)"
kill_all xclip 2>/dev/null; sleep 0.1; printf '' | xclip -selection clipboard -i; sleep 0.3
echo "targets: $(xclip -selection clipboard -o -t TARGETS 2>&1 | tr '\n' ' ')"
runpaste override "fourth text" 1
echo "target field after: [$(cat /tmp/out.txt)]"

echo "##### D. non-text clipboard (image/png): production rule is to type instead of overwrite"
kill_all python3; sleep 0.3; newtarget
kill_all xclip; sleep 0.1; printf 'PNGDATA' | xclip -selection clipboard -t image/png -i; sleep 0.3
$H paste override "typed words" 2 >/tmp/p.log 2>&1 & PP=$!
for i in $(seq 1 60); do grep -q READY_HOLD /tmp/p.log && break; sleep 0.1; done
echo "target field after: [$(cat /tmp/out.txt)]"
echo "clipboard targets still: $(xclip -selection clipboard -o -t TARGETS 2>&1 | tr '\n' ' ')"
wait $PP; cat /tmp/p.log

echo "##### E. invisible (password-style) GtkEntry with the probe overridden"
kill_all python3; sleep 0.3; newtarget password
setclip PREVIOUS-CLIPBOARD
runpaste override "into-password-field" 1
echo "target field after: [$(cat /tmp/out.txt)]"
endsection paste_wrapper_probe_overridden

section paste_xterm_target
kill_all python3 xterm 2>/dev/null; sleep 0.3
rm -f /tmp/xt.txt
xterm -title phoenix-xterm -e 'cat > /tmp/xt.txt' >/tmp/xterm.log 2>&1 &
sleep 2; focus phoenix-xterm
setclip PREVIOUS-CLIPBOARD
echo "probe overridden, xterm focused:"
runpaste override "into xterm" 1
sleep 0.5
echo "file right after the paste (tty line discipline has not flushed a partial line): $(od -c /tmp/xt.txt 2>&1 | head -3 | tr '\n' ' ')"
xdotool key Return; sleep 0.3; xdotool key Return; sleep 0.3; xdotool key ctrl+d; sleep 0.5
echo "after Return, Return, Ctrl+D (od -c): $(od -c /tmp/xt.txt 2>&1 | head -4 | tr '\n' ' ')"
endsection paste_xterm_target

kill_all harness python3 xclip xterm xev 2>/dev/null
kill $XVFB 2>/dev/null
echo "@@DONE"
