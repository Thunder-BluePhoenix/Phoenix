# Phase 64 — Dictation Anywhere

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Core dictation (local Whisper over stdin, vocabulary, local-only clean-up, statistics), the Dictate button in the chat, the hotkey state machine, the pill and a guarded paste built and unit-tested; no real microphone, hotkey press, permission prompt or paste into any application was ever run; paste works effectively on macOS only; Parakeet, the OS speech fallback and dictate-to-agent are not built |
| Depends on | [Phase 54 — Multimodal Interaction (Speech & Vision)](phase-54-multimodal-interaction.md), [Phase 60 — Fawkes Island (Notch / Top Edge) & Desktop Platforms](phase-60-fawkes-island.md) |
| Unblocks | [Phase 65 — Botless Notetaker](phase-65-botless-notetaker.md), [Phase 66 — « OK Fawkes » Voice Assistant](phase-66-ok-fawkes-voice-assistant.md) |

## Goal

Hold a key anywhere, speak, release: the words are typed where you are, recognised on your machine.

## Tasks — parity with Coucou

- [x] Hold-to-talk global key (right ⌥ / fn / right ⌘ / right ⌃ on macOS, right Ctrl elsewhere); two taps for hands-free; Esc cancels; paste-again shortcut; clipboard restored. The state machine is pure and has 89 unit tests (`apps/desktop/src-tauri/src/dictation_keys.rs`: hold at 250 ms, double-tap window, Esc consumed only while capturing, paste-again chord, auto-repeat, bounce); the platform listeners are in `dictation_hotkey.rs` (16 unit tests on decoding and modifier tracking); clipboard restore is in the paste decision table `dictation_paste.rs` (tests "pastes_then_restores_the_original_text_after_the_delay", "the_clipboard_is_not_restored_when_the_user_copied_something_meanwhile", "a_non_text_clipboard_is_never_overwritten_and_the_text_is_typed"). Caveats: the listeners (macOS CGEventTap, Linux XRecord, Windows low-level hook) were never fed a real key press by a person; the Windows hook was never compiled; Wayland is refused. Paste-again asks Core again on every press (dictation enabled and kill switch; `pill.rs` "paste_again_refuses_and_forgets_the_text_when_dictation_is_off_or_killed").
- [ ] Offline recognition (Parakeet where available, OS speech fallback). Only local whisper.cpp is built: `WhisperStdinRecognizer` (`ai/multimodal/src/dictation/whisper-stdin.ts`) pipes a WAV built in memory to `whisper-cli` over stdin (`-`), selected with `PHOENIX_WHISPER_MODEL_PATH`. Tests use a fake process runner (`dictation-sessions.test.ts` "whisper.cpp over stdin"). The real binary was run once with a stub model and read the bytes from stdin; no recognition quality on real speech was shown. No Parakeet, no OS speech fallback.
- [x] Dictionary, replacements, snippets; optional AI clean-up per app (as said / natural / polished): `ai/multimodal/src/dictation/vocabulary.ts`, `cleanup.ts`, `text.ts`; per-app modes in settings. Tests: `dictation-pipeline.test.ts` (dictionary, replacements, snippets, clean-up guard, prompt injection), `dictation-sessions.test.ts` ("uses the per-app clean-up mode"), `apps/web/test/dictation.test.tsx` ("edits dictionary, replacements and snippets…", "per-app clean-up modes…"). Clean-up is local-only by construction: its purpose is outside the sensitive-cloud allow-list, so even with the grant and every opt-in no cloud request is made (`dictation-pipeline.test.ts` "AI clean-up is local only by construction", `core/runtime/test/dictation.test.ts` "dictation clean-up never reaches a cloud provider"). Clean-up quality with a real model was not evaluated.
- [ ] The pill: see-through toolbar at a screen edge (dictate, record a call, open Phoenix); dots follow your voice. Built (`apps/desktop/src-tauri/src/pill.rs`, `pill_geometry.rs`, `apps/web/src/pill/`; tests `pill.test.tsx`, `pill-shell.test.ts`, Rust unit tests) but left unticked: nobody saw it on a screen; "Record a call" only opens `/notetaker` and starts nothing; and the pill's own **Dictate** button starts a session without the focus capture that only a hotkey start performs, so a paste from it is refused (`no_focus_target`) and the text is shown instead.
- [x] Statistics: words, time saved, WPM, streak, apps. Aggregates only, one row per local day and app in `dictation_stats` (migration 27): counts, no text, no audio, no finer time; deletable. Tests: `dictation-sessions.test.ts` ("statistics math"), `core/runtime/test/dictation.test.ts` ("dictation statistics": aggregates only, delete-all, time saved from the typing-speed setting), `dictation.test.tsx` ("shows statistics and deletes them only after a confirmation"). No retention period exists for these rows (owner decision, [gap register](../gaps.md)).
- [x] Dictate in the chat box: `DictateButton` in `Chat.tsx` (`apps/web/src/components/Dictation.tsx`); the microphone and Core are untouched until the click. Tests: `dictation.test.tsx` ("Dictate button", "browser microphone seam", "Chat box wiring"). Tested with a fake microphone; no real browser microphone permission prompt was answered.

## Tasks — Phoenix improvements

- [ ] Dictate an instruction straight to a coding agent session. Not built.
- [ ] Works on macOS, Windows and Linux (X11 and Wayland) from the first release. Not met. The paste refuses when it cannot prove the focused field is not a protected one: only macOS has a positive signal; on Linux every paste is refused, on Windows only a standard `Edit` control can be proven safe (browsers and custom controls are refused), and Wayland has neither key listening nor paste. In practice dictation paste is a macOS feature today. The Linux and Windows code compiled in CI or a container at best; none was run by a person.
- [x] Visible listening indicator in every Fawkes view: Core publishes `dictation.listening` when a session starts and `dictation.idle` on every exit path, and maps them to the LISTENING state with no timeout, so every view that mirrors Core's state shows it for the whole capture (`core/runtime/test/dictation.test.ts` "LISTENING is shown for the whole capture…", "…even before any audio, and cancel ends it", "the kill switch aborts a capture at once… and clears LISTENING"). The page itself shows a "Listening: your microphone is on" indicator (`dictation.test.tsx`). These events cannot be forged or cleared over `POST /api/events` (see Phase 65 tests `notetaker.test.ts` "the microphone indicators cannot be forged or cleared over the API"). Not looked at in each view on a real display.

## Deliverables

- apps/desktop dictation (hotkey, pill, paste): built, unit-tested, never used by a person
- Local speech engine integration: whisper.cpp over stdin only
- Dictation settings and statistics: built (`Dictation.tsx`, Core routes, migration 27)

## Exit criteria

- [ ] Dictation pastes correctly into three different apps on macOS. Not done: the paste was never run into any application. The paste decision table and typing plan are tested with a fake platform only.
- [ ] No audio is written to disk. Not demonstrated end to end. By construction dictation has no audio file: audio lives in memory and is zeroed on every exit path (`dictation-sessions.test.ts`), and whisper-cli is given `-` and no `-f`/`-o` argument (`whisper.cpp over stdin` test, fake runner). No test or run watched the filesystem during a real dictation. The older `LocalWhisperSpeech` (Phase 54 one-shot capture) still writes a temporary WAV; dictation does not use it.

## Implementation notes

- **Core.** Off by default; `POST /api/dictation/sessions` starts a session, audio goes over a single-use same-origin WebSocket (`core/api/src/dictation-socket.ts`; missing or foreign origin, wrong token, a cookie, extra query parameters are refused; the socket cannot send text), `finish` returns the text. Limits: 120 s, frame size, rate; the kill switch and turning dictation off abort a capture and zero the audio. Audit entries carry no text. `dictation.listening` / `dictation.idle` are Core-only events.
- **Shell paste (`dictation_paste` command).** Only the pill window may call it. Text is refused if it contains a newline or tab (so a dictation can never press Return or Tab), if no focus target was captured when the dictation started (hotkey starts only), if focus moved, or if secure input cannot be proven false. The captured target is single use. Paste-again re-asks Core every time. These came out of a static security review and were mutation-checked for the secure-input refusal and the paste-again gate.
- **Tests.** 278 Rust unit tests across the desktop crate plus the lifecycle tests on the mock runtime (macOS), and a Linux container pass of fmt, clippy and tests at the time of the first finish; TypeScript tests listed above. Real Rust-side behaviour on Windows is unverified.

What was not done or not run: any real microphone, system hotkey, permission prompt (Accessibility, Input Monitoring, microphone), paste into an application, recognition of real speech beyond a stub-model stdin check, Parakeet, the OS speech fallback, dictate-to-agent, the three-apps exit run, Linux or Windows behaviour on a desktop. Dictation start has no per-use human-bound consent beyond the standing Settings opt-in (the session token cannot tell a person from an agent). Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Off by default; microphone permission requested on first use.
- The dictated text is on the system clipboard for about 350 ms during a paste and is then restored; another process can read it in that window.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
