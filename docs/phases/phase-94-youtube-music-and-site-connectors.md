# Phase 94 — YouTube Music & Site Connectors

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 93 — Phoenix Mini Browser](phase-93-phoenix-mini-browser.md), [Phase 68 — Media & Portfolio Capabilities](phase-68-media-and-portfolio.md) |
| Unblocks | — |

## Goal

"Fawkes, play some lo-fi": music from YouTube and other sites, controlled by Fawkes.

## Tasks

- [ ] YouTube connector: search, play, pause, next, queue through YouTube's official embedded player
- [ ] Mini player beside Fawkes, always visible and at least 200 × 200 (YouTube terms); audio never separated from video
- [ ] Now playing in Fawkes and the media capability (Phase 68); Fawkes dances while it plays
- [ ] Ask by text or voice (Phase 66)
- [ ] More connectors: SoundCloud, Bandcamp, Spotify Web
- [ ] YouTube's own ads are not blocked (YouTube terms); the blocker exempts YouTube and says why

## Deliverables

- Connector framework
- YouTube, SoundCloud, Bandcamp, Spotify Web connectors

## Exit criteria

- [ ] A spoken or typed request plays a real YouTube track in the mini player
- [ ] Player stays visible and within YouTube's size rule

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
