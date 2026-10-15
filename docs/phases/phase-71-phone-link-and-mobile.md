# Phase 71 — Phone Link & Mobile Companions

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 45 — Cross-Device Context & Sync](phase-45-cross-device-context.md), [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md) |
| Unblocks | [Phase 87 — Remote Access Relay](phase-87-remote-access-relay.md), [Phase 89 — Apple Watch, Browser Extension & phoenix CLI](phase-89-watch-extension-cli.md) |

## Goal

Follow agents and approve requests from a phone.

## Tasks — parity with Coucou

- [ ] iPhone: Live Activity / Dynamic Island, notifications you can act on, Face ID on every Allow, widgets, Control Center, Siri and Shortcuts, Spotlight, Focus filter
- [ ] Android: approvals with fingerprint, agents at a glance, answers and chat, island overlay, home-screen widgets
- [ ] LAN phone link: off by default, pairing code, pinned TLS, approvals bound to the exact request

## Tasks — Phoenix improvements

- [ ] The phone link lives in Core, so any client (phones, a PWA) uses the same audited approval path
- [ ] Device list with revoke (closes the Phase 45 device-revocation gap)

## Deliverables

- Core phone link
- apps/ios
- apps/android

## Exit criteria

- [ ] A permission request is approved from a real phone with biometric confirmation

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
