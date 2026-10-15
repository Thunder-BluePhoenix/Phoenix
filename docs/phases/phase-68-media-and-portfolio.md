# Phase 68 — Media & Portfolio Capabilities

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | ⬜ Not started |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | [Phase 94 — YouTube Music & Site Connectors](phase-94-youtube-music-and-site-connectors.md) |

## Goal

Optional personal capabilities: what is playing, and a read-only crypto portfolio.

## Tasks — parity with Coucou

- [ ] Spotify: cover, title, artist, seek, play/pause, previous/next, shuffle, repeat, volume; Fawkes dances while it plays
- [ ] Apple Music: now playing and controls
- [ ] Portfolio: 16 networks and 5 exchanges, balances, 7-day sparklines, 24-hour change

## Tasks — Phoenix improvements

- [ ] Portfolio is read-only by construction: public addresses and read-only keys only, no order or transfer code at all
- [ ] Both are separate capabilities, off unless enabled

## Deliverables

- capabilities/spotify, apple-music, portfolio

## Exit criteria

- [ ] Playback control works against a real player
- [ ] Portfolio code has no write endpoints (checked by test)

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Phoenix never trades or moves funds.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
