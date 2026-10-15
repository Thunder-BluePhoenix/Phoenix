# Phase 62 — Drop Files & Attach Windows as Context

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 32 — Fawkes Chat & Approval UX](phase-32-fawkes-chat-and-approval-ux.md), [Phase 63 — More AI Providers & Model Switcher](phase-63-more-ai-providers.md) |
| Unblocks | — |

## Goal

Give Fawkes context by dropping a file on it or dragging it onto a window.

## Tasks — parity with Coucou

- [ ] Drop a file on Fawkes: it swallows it, then ask a question about it
- [ ] Send it by email (draft only, the user sends)
- [ ] Drag Fawkes onto a window to attach that window as context (macOS)

## Tasks — Phoenix improvements

- [ ] Folders, images and screenshots, with local vision when available (Phase 54)
- [ ] Context stays local unless an external AI purpose is opted in (Phase 29)
- [ ] Attached context is visible and removable before anything is sent

## Deliverables

- Drop target in web and desktop
- Window-context capture (macOS Accessibility)

## Exit criteria

- [ ] A dropped file answers a question with a local model

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
