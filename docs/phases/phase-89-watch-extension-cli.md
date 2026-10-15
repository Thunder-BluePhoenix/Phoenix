# Phase 89 — Apple Watch, Browser Extension & phoenix CLI

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | ⬜ Not started |
| Depends on | [Phase 71 — Phone Link & Mobile Companions](phase-71-phone-link-and-mobile.md) |
| Unblocks | — |

## Goal

Phoenix from the wrist, the browser and the terminal.

## Tasks

- [ ] Apple Watch app: state, approvals with wrist confirmation (through the iPhone app)
- [ ] Browser extension: Fawkes on GitHub PR pages, meeting record button on Meet, send page to Phoenix
- [ ] `phoenix status`, `phoenix ask "why did CI fail?"`, `phoenix awake 2h`, `phoenix approve`

## Deliverables

- apps/watch
- apps/extension
- CLI commands

## Exit criteria

- [ ] Each surface performs one real action end to end

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
