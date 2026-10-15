# Phase 64 — Dictation Anywhere

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 54 — Multimodal Interaction (Speech & Vision)](phase-54-multimodal-interaction.md), [Phase 60 — Fawkes Island (Notch / Top Edge) & Desktop Platforms](phase-60-fawkes-island.md) |
| Unblocks | [Phase 65 — Botless Notetaker](phase-65-botless-notetaker.md), [Phase 66 — « OK Fawkes » Voice Assistant](phase-66-ok-fawkes-voice-assistant.md) |

## Goal

Hold a key anywhere, speak, release: the words are typed where you are, recognised on your machine.

## Tasks — parity with Coucou

- [ ] Hold-to-talk global key (right ⌥ / fn / right ⌘ / right ⌃ on macOS, right Ctrl elsewhere); two taps for hands-free; Esc cancels; paste-again shortcut; clipboard restored
- [ ] Offline recognition (Parakeet where available, OS speech fallback)
- [ ] Dictionary, replacements, snippets; optional AI clean-up per app (as said / natural / polished)
- [ ] The pill: see-through toolbar at a screen edge (dictate, record a call, open Phoenix); dots follow your voice
- [ ] Statistics: words, time saved, WPM, streak, apps
- [ ] Dictate in the chat box

## Tasks — Phoenix improvements

- [ ] Dictate an instruction straight to a coding agent session
- [ ] Works on macOS, Windows and Linux (X11 and Wayland) from the first release
- [ ] Visible listening indicator in every Fawkes view

## Deliverables

- apps/desktop dictation (hotkey, capture, paste)
- Local speech engine integration
- Dictation settings and statistics

## Exit criteria

- [ ] Dictation pastes correctly into three different apps on macOS
- [ ] No audio is written to disk

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Off by default; microphone permission requested on first use.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
