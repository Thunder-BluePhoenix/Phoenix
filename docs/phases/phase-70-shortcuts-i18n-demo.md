# Phase 70 — Shortcuts, Languages & Demo Mode

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | ⬜ Not started |
| Depends on | [Phase 19 — Settings & Privacy Controls](phase-19-settings-and-privacy.md) |
| Unblocks | — |

## Goal

Global shortcuts, translations and a safe demo.

## Tasks — parity with Coucou

- [ ] Global shortcuts (open chat, jump to alert or terminal, switch pills, mute, send Fawkes to desktop, wardrobe), customisable
- [ ] 10 languages (English, Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Russian, Indonesian)
- [ ] Demo mode: scripted walkthrough that writes nothing and restores the real state

## Tasks — Phoenix improvements

- [ ] Command palette in the web app
- [ ] Right-to-left layout for Arabic
- [ ] Demo mode reuses the mock capability scenarios

## Deliverables

- Shortcut manager
- i18n framework + translations
- Demo mode

## Exit criteria

- [ ] Every UI string is translatable
- [ ] Demo mode leaves no file or keychain entry behind

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
