# Phase 64 real X11 dictation harness

Run on 2026-11-12 with `bash apps/desktop/src-tauri/tests/real-x11/run-in-container.sh /tmp/x11dict-out`. The complete captured transcript follows this write-up; machine-readable section splits are in [phase-64-real-x11-dictation-2026-11-12-raw.json](phase-64-real-x11-dictation-2026-11-12-raw.json).

**Scope and limits.** This was a real build and execution of the copied production Linux XRecord listener and GTK/XTest paste platform in one `rust:1-bookworm` container, against Xvfb 21.1.7 with Openbox. The key events were synthetic XTest/`xdotool` input and Xvfb is a synthetic X server. It was not a Wayland, GNOME, KDE, real physical keyboard, Windows, or human-use run. It does not close those gaps.

## Environment

- Container: `rust:1-bookworm`, Debian 12.15, `aarch64`; Docker 29.6.1.
- Rust: `rustc 1.97.0 (2d8144b78 2026-07-07)`; Cargo 1.97.0.
- Crates selected from the copied lockfile: gtk 0.18.2, libc 0.2.190, x11-dl 2.21.0.
- Packages: xvfb `2:21.1.7-3+deb12u13`; xdotool `1:3.20160805.1-5`; openbox `3.6.1-10`; libxtst6 `2:1.2.3-1.1`; libgtk-3-0 `3.24.38-2~deb12u3`; xterm 379-1; xclip 0.13-2.
- Xvfb reported X11 11.0, RECORD 1.13 and XTEST 2.2. The independent C XRecord client also built and received injected press/release packets.
- The throwaway wrapper compiled the copied production sources in 37.21 s. The sole deliberate source alteration was the harness-only public re-export needed to wrap the private Linux paste platform; no repository Rust source was changed.

## Listener observations

- With only `DISPLAY=:99`, `is_supported=true` and `spawn_listener=Ok`; `RightOption`, `Fn`, and `RightCommand` correctly reject on Linux. With only `WAYLAND_DISPLAY`, with both Wayland and DISPLAY, with `XDG_SESSION_TYPE=wayland`, or with no display, support is false and the public spawn error is `Global keyboard listening is not available on this system`.
- Renaming every libXtst shared object made support false. The direct `x11-dl` opening error named the missing `libXtst.so.6` / `libXtst.so` candidates; after restoration, support and spawning worked again. The public preflight deliberately reports the generic unavailable error rather than exposing loader internals.
- Real XTest injection reached the production listener and state machine: 600 ms right-Ctrl emitted `KeyDown(Dictation)`, `Start { mode: Hold }`, then `KeyUp(Dictation)`/`Stop`; the double tap emitted `Start { mode: HandsFree }`, then the next tap emitted `Stop`. A too-long gap and one short tap did not start. Escape while holding emitted `Cancel`; ordinary keys, left Ctrl, and right-Ctrl-plus-`a` were `Other` as expected; Ctrl+Alt+V emitted one `PasteAgain`, and key-repeat did not duplicate it.
- The explicit `xdotool keydown/keyup Control_R` run also reached the listener: the 600 ms hold emitted `Start { mode: Hold }` then `Stop`, and `xdotool key Escape` was seen. Each xdotool right-Ctrl press also produced an extra `Other` event (the harness comment says xdotool presses Control_L too; not separately confirmed). That extra key between the two taps meant the xdotool double-tap did NOT start hands-free in this run, whereas the single-key XTest double-tap above did. This is an injector artefact, not a measured listener fault.
- Two listeners each saw the hold start/stop sequence. Dropping listeners completed in 0.4–50.1 ms in the scenarios; ten drop cycles had a worst measured drop of 11.3 ms and returned to one process thread (one reading, taken immediately after a drop, still showed two). The 100 press/release XTest samples had no misses: press p50/p95/max 0.14/0.21/4.87 ms; release 0.12/0.18/0.83 ms.
- XRecord is observe-only: although the state machine returned `consume=true` for Escape during capture, `xev` in the focused window received Escape press and release. Killing the synthetic X server made the harness process exit with status 1 and print `X connection to :98 broken (explicit kill or server shutdown).`: that is Xlib's default fatal I/O error handler (the listener installs no handler of its own), so it did not hang, but it terminates the whole process. In the app GTK is connected to the same server, so this was not checked there.
- A caveat exposed by the harness: a flush-only injector that stayed connected coalesced its press/release until the listener saw them together. The independent C client saw the same server delivery. The measured event scenarios used XSync to avoid treating injector buffering as listener latency.

## Paste observations

The unmodified Linux `secure_input` returns `SecureInputUnknown` before clipboard access or injection. Consequently, both a visible GTK entry and an invisible/password-style GTK entry returned `Err(SecureInputUnknown)`, preserved `PREVIOUS-CLIPBOARD`, and received no text. This is the intended current Linux protection and applies regardless of field type.

To exercise the rest of the real Linux platform, the harness alone wrapped that probe to answer `Ok(false)`; every clipboard/XTest call remained production code. With a visible GTK entry, `hello dictation` arrived, result was `Ok(Pasted)`, the prior clipboard was restored at 367.3 ms, and it remained restored while the process lived. A foreign copy during the delay made `unchanged=false`, so `FOREIGN-COPY` was retained. An unknown/empty clipboard returned `ClipboardUnavailable` without pasting; an `image/png` clipboard selected the real typing path, produced `Ok(Typed)`, delivered `typed words`, and left the image clipboard untouched. The same wrapper also pasted into the invisible GTK entry, which demonstrates exactly why production must not use it as a secure-field probe.

With an xterm focused, the wrapper result was also `Ok(Pasted)` and the real XTest Ctrl+V sequence ran, but `cat > /tmp/xt.txt` received no dictated text; after the harness sent Return, Return and Ctrl+D, the file contained only `\r\n`. In this test xterm did not treat Ctrl+V as clipboard paste ([INFERENCE] xterm sent the Ctrl+V byte to the tty, where it acted as literal-next and let the first Return through as `\r`), so Linux paste cannot be claimed to work in that target. No small safe universal replacement chord is evident because GTK used Ctrl+V successfully and terminal paste bindings vary.

## Result

This supplies real synthetic-X11/XTest evidence for the Linux listener and for the Linux paste platform below its intentionally refusing secure-field gate. It does **not** make paste usable on Linux, validate Wayland or real GNOME/KDE sessions, validate Windows, or constitute a person-use run. No production defect was changed.

## Raw harness transcript

```text
@@BEGIN setup
rustc 1.97.0 (2d8144b78 2026-07-07)
cargo 1.97.0 (c980f4866 2026-06-30)
apt install ok
   Compiling proc-macro-error v1.0.4
   Compiling thiserror v1.0.69
   Compiling thiserror-impl v1.0.69
   Compiling dictation-x11-harness v0.0.0 (/work)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 37.21s
name = "gtk"
version = "0.18.2"
name = "libc"
version = "0.2.190"
name = "x11-dl"
version = "2.21.0"
reference C XRecord client built
@@END setup
@@BEGIN x_server
version number:    11.0
vendor string:    The X.Org Foundation
    RECORD
    XTEST
XTEST version 2.2 opcode: 132
RECORD version 1.13 opcode: 146, base error: 154
	"Virtual core XTEST pointer"	[XExtensionPointer]
	"Virtual core XTEST keyboard"	[XExtensionKeyboard]
@@END x_server
@@BEGIN session_detection
--- X11 (DISPLAY=:99 only)
env DISPLAY=Some(":99")
env WAYLAND_DISPLAY=None
env XDG_SESSION_TYPE=None
is_supported=true
listen_permission=Granted
spawn_listener=Ok
spawn_listener(RightOption)=Err("The Right Option key cannot be used for dictation on this operating system")
spawn_listener(Fn)=Err("The Fn key cannot be used for dictation on this operating system")
spawn_listener(RightCommand)=Err("The Right Command key cannot be used for dictation on this operating system")
x11_dl XRecord open: Ok
x11_dl XTest open: Ok
--- Wayland only (no DISPLAY, WAYLAND_DISPLAY=wayland-0)
env DISPLAY=None
env WAYLAND_DISPLAY=Some("wayland-0")
env XDG_SESSION_TYPE=None
is_supported=false
listen_permission=Granted
spawn_listener=Err("Global keyboard listening is not available on this system")
spawn_listener(RightOption)=Err("The Right Option key cannot be used for dictation on this operating system")
spawn_listener(Fn)=Err("The Fn key cannot be used for dictation on this operating system")
spawn_listener(RightCommand)=Err("The Right Command key cannot be used for dictation on this operating system")
x11_dl XRecord open: Ok
x11_dl XTest open: Ok
--- XWayland-like (DISPLAY=:99 and WAYLAND_DISPLAY=wayland-0)
env DISPLAY=Some(":99")
env WAYLAND_DISPLAY=Some("wayland-0")
env XDG_SESSION_TYPE=None
is_supported=false
listen_permission=Granted
spawn_listener=Err("Global keyboard listening is not available on this system")
spawn_listener(RightOption)=Err("The Right Option key cannot be used for dictation on this operating system")
spawn_listener(Fn)=Err("The Fn key cannot be used for dictation on this operating system")
spawn_listener(RightCommand)=Err("The Right Command key cannot be used for dictation on this operating system")
x11_dl XRecord open: Ok
x11_dl XTest open: Ok
--- XDG_SESSION_TYPE=wayland with DISPLAY=:99
env DISPLAY=Some(":99")
env WAYLAND_DISPLAY=None
env XDG_SESSION_TYPE=Some("wayland")
is_supported=false
listen_permission=Granted
spawn_listener=Err("Global keyboard listening is not available on this system")
spawn_listener(RightOption)=Err("The Right Option key cannot be used for dictation on this operating system")
spawn_listener(Fn)=Err("The Fn key cannot be used for dictation on this operating system")
spawn_listener(RightCommand)=Err("The Right Command key cannot be used for dictation on this operating system")
x11_dl XRecord open: Ok
x11_dl XTest open: Ok
--- XDG_SESSION_TYPE=x11, DISPLAY=:99
env DISPLAY=Some(":99")
env WAYLAND_DISPLAY=None
env XDG_SESSION_TYPE=Some("x11")
is_supported=true
listen_permission=Granted
spawn_listener=Ok
spawn_listener(RightOption)=Err("The Right Option key cannot be used for dictation on this operating system")
spawn_listener(Fn)=Err("The Fn key cannot be used for dictation on this operating system")
spawn_listener(RightCommand)=Err("The Right Command key cannot be used for dictation on this operating system")
x11_dl XRecord open: Ok
x11_dl XTest open: Ok
--- DISPLAY=:98 (nothing listening)
is_supported=true
listen_permission=Granted
spawn_listener=Err("Could not connect to the X server")
spawn_listener(RightOption)=Err("The Right Option key cannot be used for dictation on this operating system")
spawn_listener(Fn)=Err("The Fn key cannot be used for dictation on this operating system")
spawn_listener(RightCommand)=Err("The Right Command key cannot be used for dictation on this operating system")
x11_dl XRecord open: Ok
x11_dl XTest open: Ok
--- no DISPLAY, no WAYLAND_DISPLAY
env DISPLAY=None
env WAYLAND_DISPLAY=None
env XDG_SESSION_TYPE=None
is_supported=false
listen_permission=Granted
spawn_listener=Err("Global keyboard listening is not available on this system")
spawn_listener(RightOption)=Err("The Right Option key cannot be used for dictation on this operating system")
spawn_listener(Fn)=Err("The Fn key cannot be used for dictation on this operating system")
spawn_listener(RightCommand)=Err("The Right Command key cannot be used for dictation on this operating system")
@@END session_detection
@@BEGIN missing_libxtst
libXtst files: /usr/lib/aarch64-linux-gnu/libXtst.so
/usr/lib/aarch64-linux-gnu/libXtst.so.6
/usr/lib/aarch64-linux-gnu/libXtst.so.6.1.0
is_supported=false
listen_permission=Granted
spawn_listener=Err("Global keyboard listening is not available on this system")
spawn_listener(RightOption)=Err("The Right Option key cannot be used for dictation on this operating system")
spawn_listener(Fn)=Err("The Fn key cannot be used for dictation on this operating system")
spawn_listener(RightCommand)=Err("The Right Command key cannot be used for dictation on this operating system")
x11_dl XRecord open: Err(opening library failed (opening library failed (libXtst.so.6: cannot open shared object file: No such file or directory); opening library failed (libXtst.so: cannot open shared object file: No such file or directory); opening library failed (/usr/lib/aarch64-linux-gnu/libXtst.so.6: cannot open shared object file: No such file or directory); opening library failed (/usr/lib/aarch64-linux-gnu/libXtst.so: cannot open shared object file: No such file or directory)))
x11_dl XTest open: Err(opening library failed (opening library failed (libXtst.so.6: cannot open shared object file: No such file or directory); opening library failed (libXtst.so: cannot open shared object file: No such file or directory); opening library failed (/usr/lib/aarch64-linux-gnu/libXtst.so.6: cannot open shared object file: No such file or directory); opening library failed (/usr/lib/aarch64-linux-gnu/libXtst.so: cannot open shared object file: No such file or directory)))
restored; is_supported again:
is_supported=true
spawn_listener=Ok
@@END missing_libxtst
@@BEGIN listener_hold_600ms
[A] spawn_listener OK in 1.2ms
[A] t=   1203.4ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1469.1ms tick action=Start { mode: Hold }
[A] t=   1804.4ms event=KeyUp(Dictation) consume=false action=Some(Stop)
drop took 28.8ms
threads_after_drop=1
@@END listener_hold_600ms
@@BEGIN listener_double_tap_then_stop
[A] spawn_listener OK in 1.4ms
[A] t=   1201.2ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1296.7ms event=KeyUp(Dictation) consume=false action=None
[A] t=   1407.1ms event=KeyDown(Dictation) consume=false action=Some(Start { mode: HandsFree })
[A] t=   1502.5ms event=KeyUp(Dictation) consume=false action=None
[A] t=   1903.3ms event=KeyDown(Dictation) consume=false action=Some(Stop)
[A] t=   1998.5ms event=KeyUp(Dictation) consume=false action=None
drop took 22.1ms
threads_after_drop=1
@@END listener_double_tap_then_stop
@@BEGIN listener_tap_gap_too_long
[A] spawn_listener OK in 1.5ms
[A] t=   1202.1ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1297.4ms event=KeyUp(Dictation) consume=false action=None
[A] t=   1798.3ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1893.6ms event=KeyUp(Dictation) consume=false action=None
drop took 20.1ms
threads_after_drop=1
@@END listener_tap_gap_too_long
@@BEGIN listener_single_short_tap
[A] spawn_listener OK in 1.5ms
[A] t=   1201.5ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1296.6ms event=KeyUp(Dictation) consume=false action=None
drop took 19.9ms
threads_after_drop=1
@@END listener_single_short_tap
@@BEGIN listener_esc_while_idle
[A] spawn_listener OK in 1.1ms
[A] t=   1203.3ms event=KeyDown(Esc) consume=false action=None
[A] t=   1265.2ms event=KeyUp(Esc) consume=false action=None
drop took 43.4ms
threads_after_drop=1
@@END listener_esc_while_idle
@@BEGIN listener_esc_cancels_hold
[A] spawn_listener OK in 0.9ms
[A] t=   1202.1ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1468.2ms tick action=Start { mode: Hold }
[A] t=   1602.6ms event=KeyDown(Esc) consume=true action=Some(Cancel)
[A] t=   1662.9ms event=KeyUp(Esc) consume=true action=None
[A] t=   1764.7ms event=KeyUp(Dictation) consume=false action=None
drop took 37.0ms
threads_after_drop=1
@@END listener_esc_cancels_hold
@@BEGIN listener_nontarget_keys
[A] spawn_listener OK in 2.1ms
[A] t=   1196.4ms event=KeyDown(Other) consume=false action=None
[A] t=   1226.7ms event=KeyUp(Other) consume=false action=None
[A] t=   1226.7ms event=KeyDown(Other) consume=false action=None
[A] t=   1257.1ms event=KeyUp(Other) consume=false action=None
[A] t=   1257.1ms event=KeyDown(Other) consume=false action=None
[A] t=   1287.3ms event=KeyUp(Other) consume=false action=None
[A] t=   1287.4ms event=KeyDown(Other) consume=false action=None
[A] t=   1317.6ms event=KeyUp(Other) consume=false action=None
[A] t=   1317.6ms event=KeyDown(Other) consume=false action=None
[A] t=   1348.1ms event=KeyUp(Other) consume=false action=None
drop took 20.8ms
threads_after_drop=1
@@END listener_nontarget_keys
@@BEGIN listener_combo_ctrlR_then_a
[A] spawn_listener OK in 1.5ms
[A] t=   1203.2ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1283.4ms event=KeyDown(Other) consume=false action=None
[A] t=   1333.9ms event=KeyUp(Other) consume=false action=None
[A] t=   1734.2ms event=KeyUp(Dictation) consume=false action=None
drop took 49.5ms
threads_after_drop=1
@@END listener_combo_ctrlR_then_a
@@BEGIN listener_left_ctrl_only
[A] spawn_listener OK in 1.3ms
[A] t=   1201.1ms event=KeyDown(Other) consume=false action=None
[A] t=   1801.8ms event=KeyUp(Other) consume=false action=None
drop took 25.6ms
threads_after_drop=1
@@END listener_left_ctrl_only
@@BEGIN listener_paste_chord_default
[A] spawn_listener OK in 1.6ms
[A] t=   1202.6ms event=KeyDown(Other) consume=false action=None
[A] t=   1232.9ms event=KeyDown(Other) consume=false action=None
[A] t=   1263.8ms event=KeyDown(PasteChord) consume=false action=Some(PasteAgain)
[A] t=   1304.4ms event=KeyUp(PasteChord) consume=false action=None
[A] t=   1334.7ms event=KeyUp(Other) consume=false action=None
[A] t=   1364.9ms event=KeyUp(Other) consume=false action=None
drop took 40.2ms
threads_after_drop=1
@@END listener_paste_chord_default
@@BEGIN listener_chord_repeat
[A] spawn_listener OK in 1.7ms
[A] t=   1202.9ms event=KeyDown(Other) consume=false action=None
[A] t=   1233.1ms event=KeyDown(Other) consume=false action=None
[A] t=   1264.4ms event=KeyDown(PasteChord) consume=false action=Some(PasteAgain)
[A] t=   1346.0ms event=KeyUp(PasteChord) consume=false action=None
[A] t=   1377.6ms event=KeyUp(Other) consume=false action=None
[A] t=   1377.6ms event=KeyUp(Other) consume=false action=None
drop took 0.4ms
threads_after_drop=1
@@END listener_chord_repeat
@@BEGIN listener_xdotool_hold
[A] spawn_listener OK in 1.3ms
[A] t=   1198.6ms event=KeyDown(Other) consume=false action=None
[A] t=   1198.7ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1469.1ms tick action=Start { mode: Hold }
[A] t=   1814.6ms event=KeyUp(Other) consume=false action=None
[A] t=   1814.6ms event=KeyUp(Dictation) consume=false action=Some(Stop)
[A] t=   2230.2ms event=KeyDown(Other) consume=false action=None
[A] t=   2230.3ms event=KeyDown(Dictation) consume=false action=None
[A] t=   2326.0ms event=KeyUp(Other) consume=false action=None
[A] t=   2326.1ms event=KeyUp(Dictation) consume=false action=None
[A] t=   2451.6ms event=KeyDown(Other) consume=false action=None
[A] t=   2451.8ms event=KeyDown(Dictation) consume=false action=None
[A] t=   2547.3ms event=KeyUp(Other) consume=false action=None
[A] t=   2547.3ms event=KeyUp(Dictation) consume=false action=None
[A] t=   2863.5ms event=KeyDown(Esc) consume=false action=None
[A] t=   2869.9ms event=KeyUp(Esc) consume=false action=None
drop took 38.4ms
threads_after_drop=1
@@END listener_xdotool_hold
@@BEGIN injector_flush_only_caveat
Same hold as above but the injector only XFlush()es (no XSync) and stays alive between steps:
[A] spawn_listener OK in 1.6ms
[A] t=   1905.8ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1905.9ms event=KeyUp(Dictation) consume=false action=None
drop took 22.8ms
threads_after_drop=1
Independent C XRecord client (xrecord-reference.c, not Phoenix code), same injection:
go
t=  1910.0ms type=2 keycode=105
t=  1910.1ms type=3 keycode=105
@@END injector_flush_only_caveat
@@BEGIN concurrent_listeners
[A] spawn_listener OK in 1.9ms
[B] spawn_listener OK in 1.2ms
[A] t=   1501.6ms event=KeyDown(Dictation) consume=false action=None
[B] t=   1501.6ms event=KeyDown(Dictation) consume=false action=None
[B] t=   1771.3ms tick action=Start { mode: Hold }
[A] t=   1771.3ms tick action=Start { mode: Hold }
[A] t=   2101.9ms event=KeyUp(Dictation) consume=false action=Some(Stop)
[B] t=   2101.9ms event=KeyUp(Dictation) consume=false action=Some(Stop)
[A] t=   2403.3ms event=KeyDown(Esc) consume=false action=None
[B] t=   2403.3ms event=KeyDown(Esc) consume=false action=None
[B] t=   2453.9ms event=KeyUp(Esc) consume=false action=None
[A] t=   2453.9ms event=KeyUp(Esc) consume=false action=None
drop took 29.9ms
drop took 50.1ms
threads_after_drop=1
@@END concurrent_listeners
@@BEGIN esc_not_swallowed_xev
[A] spawn_listener OK in 1.4ms
[A] t=   1002.3ms event=KeyDown(Dictation) consume=false action=None
[A] t=   1267.3ms tick action=Start { mode: Hold }
[A] t=   1402.7ms event=KeyDown(Esc) consume=true action=Some(Cancel)
[A] t=   1463.0ms event=KeyUp(Esc) consume=true action=None
[A] t=   1563.6ms event=KeyUp(Dictation) consume=false action=None
drop took 39.0ms
threads_after_drop=1
--- xev (the focused window) saw:
KeyPress event, serial 25, synthetic NO, window 0x400001,	    state 0x0, keycode 105 (keysym 0xffe4, Control_R),
KeyPress event, serial 28, synthetic NO, window 0x400001,	    state 0x4, keycode 9 (keysym 0xff1b, Escape),
KeyRelease event, serial 28, synthetic NO, window 0x400001,	    state 0x4, keycode 9 (keysym 0xff1b, Escape),
KeyRelease event, serial 28, synthetic NO, window 0x400001,	    state 0x4, keycode 105 (keysym 0xffe4, Control_R),
@@END esc_not_swallowed_xev
@@BEGIN latency_100_cycles
press: n=100 min=0.09ms p50=0.14ms p95=0.21ms max=4.87ms
release: n=100 min=0.06ms p50=0.12ms p95=0.18ms max=0.83ms
missed_events=0
drop took 18.9ms
@@END latency_100_cycles
@@BEGIN drop_cycles
cycle 0: threads base=1 running=2 after_drop=1 drop=10.1ms
cycle 1: threads base=1 running=2 after_drop=1 drop=11.3ms
cycle 2: threads base=1 running=2 after_drop=1 drop=8.1ms
cycle 3: threads base=1 running=2 after_drop=1 drop=9.3ms
cycle 4: threads base=1 running=2 after_drop=2 drop=10.7ms
cycle 5: threads base=1 running=2 after_drop=1 drop=9.9ms
cycle 6: threads base=1 running=2 after_drop=1 drop=9.2ms
cycle 7: threads base=1 running=2 after_drop=1 drop=10.4ms
cycle 8: threads base=1 running=2 after_drop=1 drop=10.1ms
cycle 9: threads base=1 running=2 after_drop=1 drop=9.9ms
worst_drop_ms=11.3
@@END drop_cycles
@@BEGIN x_server_dies
harness exit code after X server died: 1
[A] spawn_listener OK in 1.3ms
READY threads_before=1 threads_after_spawn=3
X connection to :98 broken (explicit kill or server shutdown).
@@END x_server_dies
@@BEGIN paste_prod_protected_probe
focus: phoenix-paste-target
xclip -o: [PREVIOUS-CLIPBOARD]
paste_result=Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }) after 0.0ms
in_process_clipboard_after=Some("PREVIOUS-CLIPBOARD")
READY_HOLD
target field after: []
xclip -o: [PREVIOUS-CLIPBOARD]
--- same, focused field is an invisible (password-style) GtkEntry
focus: phoenix-paste-target
paste_result=Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }) after 0.0ms
in_process_clipboard_after=Some("PREVIOUS-CLIPBOARD")
READY_HOLD
target field after: []
xclip -o: [PREVIOUS-CLIPBOARD]
@@END paste_prod_protected_probe
@@BEGIN paste_wrapper_probe_overridden
Wrapper (harness code) answers Ok(false) for secure_input; every other call is the REAL Linux platform.
focus: phoenix-paste-target
##### A. plain GtkEntry, previous clipboard text PREVIOUS-CLIPBOARD, process alive while checking
target field after: [hello dictation]
while the process is alive:
xclip -o: [PREVIOUS-CLIPBOARD]
  call t=     0.0ms secure_input (production says Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }); wrapper answers Ok(false))
  call t=     0.7ms can_send_keys -> Ok(())
  call t=    10.6ms read_clipboard -> Text("PREVIOUS-CLIPBOARD")
  call t=    10.7ms write_text -> ok=true
  call t=    11.4ms send_paste -> Ok(())
  call t=   366.9ms wait done
  call t=   367.1ms unchanged -> true
  call t=   367.3ms restore_text(Some("PREVIOUS-CLIPBOARD")) -> Ok(())
paste_result=Ok(Pasted) after 367.3ms
in_process_clipboard_after=Some("PREVIOUS-CLIPBOARD")
READY_HOLD
after the process exited (no clipboard manager in this container):
xclip -o: [Error: target STRING not available]
##### B. a foreign copy is made during the restore wait
focus: phoenix-paste-target
  call t=     0.0ms secure_input (production says Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }); wrapper answers Ok(false))
  call t=     0.9ms can_send_keys -> Ok(())
  call t=    13.1ms read_clipboard -> Text("PREVIOUS-CLIPBOARD")
  call t=    13.6ms write_text -> ok=true
  call t=    14.2ms send_paste -> Ok(())
  call t=    16.6ms foreign xclip copy during wait: Ok(ExitStatus(unix_wait_status(0)))
  call t=   369.8ms wait done
  call t=   370.1ms unchanged -> false
paste_result=Ok(Pasted) after 370.1ms
in_process_clipboard_after=Some("FOREIGN-COPY")
READY_HOLD
target field after: [second text]
xclip -o: [FOREIGN-COPY]
##### C. nothing on the clipboard at all (no selection owner)
xclip -o: [Error: target STRING not available]
  call t=     0.0ms secure_input (production says Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }); wrapper answers Ok(false))
  call t=     0.9ms can_send_keys -> Ok(())
  call t=    11.0ms read_clipboard -> Unknown
paste_result=Err(PasteError { code: ClipboardUnavailable, message: "The clipboard could not be read safely, so nothing was pasted." }) after 11.0ms
in_process_clipboard_after=None
READY_HOLD
target field after: [second text]
##### C2. clipboard owned by a foreign process that offers no text target (empty string offered as UTF8)
targets: TARGETS UTF8_STRING
  call t=     0.0ms secure_input (production says Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }); wrapper answers Ok(false))
  call t=     0.7ms can_send_keys -> Ok(())
  call t=    11.6ms read_clipboard -> Unknown
paste_result=Err(PasteError { code: ClipboardUnavailable, message: "The clipboard could not be read safely, so nothing was pasted." }) after 11.6ms
in_process_clipboard_after=None
READY_HOLD
target field after: [second text]
##### D. non-text clipboard (image/png): production rule is to type instead of overwrite
focus: phoenix-paste-target
target field after: [typed words]
clipboard targets still: TARGETS image/png
  call t=     0.0ms secure_input (production says Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }); wrapper answers Ok(false))
  call t=     0.8ms can_send_keys -> Ok(())
  call t=    11.0ms read_clipboard -> NonText
  call t=    11.6ms type_text -> Ok(())
paste_result=Ok(Typed) after 11.6ms
in_process_clipboard_after=None
READY_HOLD
##### E. invisible (password-style) GtkEntry with the probe overridden
focus: phoenix-paste-target
  call t=     0.0ms secure_input (production says Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }); wrapper answers Ok(false))
  call t=     1.2ms can_send_keys -> Ok(())
  call t=    12.3ms read_clipboard -> Text("PREVIOUS-CLIPBOARD")
  call t=    12.9ms write_text -> ok=true
  call t=    13.9ms send_paste -> Ok(())
  call t=   366.0ms wait done
  call t=   366.4ms unchanged -> true
  call t=   366.6ms restore_text(Some("PREVIOUS-CLIPBOARD")) -> Ok(())
paste_result=Ok(Pasted) after 366.7ms
in_process_clipboard_after=Some("PREVIOUS-CLIPBOARD")
READY_HOLD
target field after: [into-password-field]
@@END paste_wrapper_probe_overridden
@@BEGIN paste_xterm_target
focus: phoenix-xterm
probe overridden, xterm focused:
  call t=     0.0ms secure_input (production says Err(PasteError { code: SecureInputUnknown, message: "The focused field could not be confirmed safe for dictation, so nothing was pasted." }); wrapper answers Ok(false))
  call t=     0.8ms can_send_keys -> Ok(())
  call t=    10.3ms read_clipboard -> Text("PREVIOUS-CLIPBOARD")
  call t=    10.9ms write_text -> ok=true
  call t=    11.6ms send_paste -> Ok(())
  call t=   366.2ms wait done
  call t=   366.6ms unchanged -> true
  call t=   366.7ms restore_text(Some("PREVIOUS-CLIPBOARD")) -> Ok(())
paste_result=Ok(Pasted) after 366.7ms
in_process_clipboard_after=Some("PREVIOUS-CLIPBOARD")
READY_HOLD
file right after the paste (tty line discipline has not flushed a partial line): 0000000
after Return, Return, Ctrl+D (od -c): 0000000  \r  \n 0000002
@@END paste_xterm_target
@@DONE
```
