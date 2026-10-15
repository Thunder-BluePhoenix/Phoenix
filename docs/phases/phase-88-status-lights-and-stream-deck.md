# Phase 88 — Physical Status Lights & Stream Deck

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | ⬜ Not started |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | — |

## Goal

Fawkes' state in the physical world.

## Tasks

- [ ] Lights: Philips Hue, Elgato Key Light, Luxafor/busy lights, LIFX; map states to colours (red while recording)
- [ ] Stream Deck plugin: approve/deny, start recording, keep awake, state icons
- [ ] Respects focus mode and quiet hours

## Deliverables

- capabilities/lights
- Stream Deck plugin

## Exit criteria

- [ ] A real light follows Fawkes through IDLE, WORKING, ERROR and RECORDING

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
