# YouTube Music & site connectors (Phase 94)

`@phoenix/capability-youtube-music` (`capabilities/youtube-music`) is the connector
framework for music sites controlled by Fawkes. It is a pure state/policy module:
the Phoenix browser (Phase 93) owns webviews, navigation, playback and all network
access. This module never fetches and ships no hidden or background player. Core
uses only the policy and the search-URL builder (see "How Core uses it").

## Pieces

- `ConnectorPolicy` — opt-in, per-site enablement for `youtube`, `soundcloud`,
  `bandcamp` and `spotify-web`. Nothing is enabled by default. `forUrl()` matches
  **exact hosts** over HTTPS only; subdomains, lookalikes, credentials in the URL
  and non-default ports are rejected.
- Ad blocking: only YouTube, and only while its connector is enabled, reports
  `adBlocking: "exempt"` with a reason (YouTube's own ads must not be blocked in its
  official embedded player). Every other site stays on normal blocking.
- `searchUrl()` / `searchSite()` — build a site's own search URL and ask the host to
  open it in a visible page. Search never scrapes results and never selects or
  autoplays a track.
- `YouTubeMusicConnector` — search / select / play / pause / queue / next against a
  `VisiblePlayerHost` supplied by the browser surface. A person selects a concrete
  11-character video ID; the connector loads the official embed.

## Visibility rules

- Play and select require `host.viewport()` to report a visible viewport of at least
  200 × 200 CSS px (YouTube's size rule); otherwise they throw.
- The connector registers `host.beforeHide`; the host must await it before hiding,
  minimizing or detaching the viewport, and the connector pauses first. Audio is
  never kept playing without its video.
- `onPlayerState()` mirrors the official iframe's reported state (including user
  controls); a `playing` report while hidden or disabled is forced back to paused.
- Video and audio are never separated: there is no audio-only extraction path.

## Security

- Video IDs, titles, artists and queries are validated; titles/artists from a page
  are data, never instructions.
- Host side effects (`loadOfficialEmbed`, `play`, `openSearch`) are expected to go
  through the permission/tool gateway and audit log when the parent wires them.

## How Core uses it

`MusicConnectorsService` (`core/runtime/src/music-connectors/service.ts`) keeps the
per-site opt-in and builds a site's own search address. `core/runtime/package.json`
gained the workspace edge `@phoenix/capability-youtube-music` (no third-party
dependency). Routes (session token only):

- `GET /api/music/connectors`.
- `PUT /api/music/connectors/:site` with `{enabled}`; audited as `music_connectors.changed`.
- `POST /api/music/connectors/:site/search` with `{query}`; returns `{url}` only for an
  allowed (enabled) site, 403 otherwise.

The enabled sites are stored in settings key `music-connectors.enabled` (privacy row
`music_connectors`). Test: `core/runtime/test/music-connectors-wiring.test.ts` (5).
Nothing in Core fetches, opens a page or plays. Settings section: Settings UI in
progress (`apps/web/src/components/MusicSitesSettings.tsx` does not exist yet).

## Integration hooks still needed from the browser

1. Implement `VisiblePlayerHost` in the mini browser (Phase 93) so
   `YouTubeMusicConnector` has something to play in.
2. Expose `snapshot()` to Fawkes now-playing and the media capability (Phase 68), and
   trigger the dance animation while `state === "playing"`.
3. Route text/voice requests (Phase 66) to `search()` then an explicit user selection.
4. Have the ad blocker consult `policy.describe(site).adBlocking`/`forUrl()`.
5. Call `await connector.dispose()` on shutdown.

## Limitations

Evidence is simulated with injected fakes and, for the Core routes, a running Core
that only stores the opt-in and returns a URL. There is no real embedded player, so the
exit criteria (a real track plays in the mini player; real-size rule observed) are
**not** met until the browser host exists. The `YouTubeMusicConnector` playback side
still needs the Phase 93 host. SoundCloud, Bandcamp and Spotify Web have
policy and search-URL support only; no playback control.
