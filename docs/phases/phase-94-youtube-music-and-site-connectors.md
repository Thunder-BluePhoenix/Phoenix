# Phase 94 — YouTube Music & Site Connectors

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 A visible-player policy and search URL builders exist (22 tests), and Core now keeps the per-site opt-in and builds search URLs through routes (5 wiring tests). **No embedded player exists** (it needs the Phase 93 host); nothing fetches, opens a page or plays. Neither exit criterion is met |
| Depends on | [Phase 93 — Phoenix Mini Browser](phase-93-phoenix-mini-browser.md), [Phase 68 — Media & Portfolio Capabilities](phase-68-media-and-portfolio.md) |
| Unblocks | — |

## Goal

"Fawkes, play some lo-fi": music from YouTube and other sites, controlled by Fawkes.

## Tasks

- [ ] YouTube connector: search, play, pause, next, queue through YouTube's official embedded player. Search builds a URL and selects nothing. **No embedded player exists.**
- [ ] Mini player beside Fawkes, always visible and at least 200 × 200 (YouTube terms); audio never separated from video. The policy requires a 200 × 200 minimum visible viewport, pauses before hiding, and forces a pause if playing while hidden. Simulated. **The player model now exists** (`apps/web/src/core/youtube-player.ts`, tested against a fake IFrame API: id validation, gesture-gated play, size rule, hide-after-pause), but **nothing hosts the iframe**: see the decision in [youtube-music.md](../youtube-music.md#hosting-the-embed-why-it-is-not-wired-decision). Unticked: no player on screen.
- [ ] Now playing in Fawkes and the media capability (Phase 68); Fawkes dances while it plays. Not built.
- [ ] Ask by text or voice (Phase 66). Not built.
- [ ] More connectors: SoundCloud, Bandcamp, Spotify Web. **Policy and search URL only;** no player.
- [ ] YouTube's own ads are not blocked (YouTube terms); the blocker exempts YouTube and says why. The policy has an ad-blocking exemption only for an enabled YouTube connector. Simulated. Unticked: no blocker exists (Phase 93).

## Deliverables

- `capabilities/youtube-music` (`@phoenix/capability-youtube-music`): visible-player policy, exact-host opt-in connectors, search URL building. Built, 22 tests, simulated evidence only. See [youtube-music.md](../youtube-music.md).
- `core/runtime/src/music-connectors/service.ts` (`MusicConnectorsService`) and routes `GET /api/music/connectors`, `PUT /api/music/connectors/:site` (`{enabled}`, audited `music_connectors.changed`), `POST /api/music/connectors/:site/search` (`{query}` → `{url}` only for an allowed site, 403 otherwise). Enabled sites are in settings key `music-connectors.enabled` (privacy row `music_connectors`). `core/runtime/package.json` gained the workspace edge `@phoenix/capability-youtube-music`. Test: `core/runtime/test/music-connectors-wiring.test.ts` (5). Settings UI in progress (`MusicSitesSettings.tsx` does not exist yet).
- `apps/web/src/core/youtube-player.ts` (`MiniPlayer`, `embedUrl`, `pickResult`, `UserGesture`, `nowPlayingOf`) and `apps/web/test/youtube-player.test.ts` (31, fake IFrame API). The capability now exports `isVideoId` and `MIN_PLAYER_EDGE`. Simulated evidence only.
- Not built: hosting the iframe (a decision row: remote script and frame cannot go in a Core-served page with the session token, nor in the chrome with its capability, nor under the shell's single global CSP, without weakening isolation or enabling `unstable`), the now-playing event and dance for a webview-hosted player; the `YouTubeMusicConnector` playback side still needs the Phase 93 host.

## Exit criteria

- [ ] A spoken or typed request plays a real YouTube track in the mini player. **Unmet.** No player exists and no request played anything.
- [ ] Player stays visible and within YouTube's size rule. **Unmet in reality.** The policy enforces the size rule in tests, but there is no player to enforce it on.

## Implementation notes

### What was built

- **Visible-player policy:** exact-host opt-in connectors; a 200 × 200 minimum visible viewport; pause before hiding; forced pause if playing while hidden; an ad-blocking exemption only for an enabled YouTube connector.
- **Search** builds a URL and selects nothing.
- SoundCloud, Bandcamp and Spotify Web: policy and search URL only.
- 22 tests, plus 5 wiring tests for the Core routes. Documentation: [youtube-music.md](../youtube-music.md).

### What was not built

The embedded player (it needs the [Phase 93](phase-93-phoenix-mini-browser.md) host, which does not exist), now-playing integration, voice requests.

### What was not run

Any playback of any track on any site. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
