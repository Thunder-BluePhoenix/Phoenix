# Phase 96 — Browser Profiles, Sync & Extensions

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | ⬜ Not started |
| Depends on | [Phase 93 — Phoenix Mini Browser](phase-93-phoenix-mini-browser.md), [Phase 45 — Cross-Device Context & Sync](phase-45-cross-device-context.md) |
| Unblocks | — |

## Goal

Make the Phoenix browser yours across devices.

## Tasks

- [ ] Several profiles (work, personal, testing)
- [ ] Bookmarks and history synced through Phoenix's encrypted sync (Phase 45)
- [ ] Import bookmarks from other browsers
- [ ] Small extension API through capabilities (page actions, content scripts with declared permissions)

## Deliverables

- Profiles, sync, import, extension API

## Exit criteria

- [ ] Bookmarks round-trip between two devices encrypted end to end

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
