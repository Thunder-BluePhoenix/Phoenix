# YouTube Music & site connectors (Phase 94)

`@phoenix/capability-youtube-music` (`capabilities/youtube-music`) is the connector
framework for music sites controlled by Fawkes. It is a pure state/policy module:
the Phoenix browser (Phase 93) owns webviews, navigation, playback and all network
access. This module never fetches and ships no hidden or background player.

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

## Integration hooks for the parent

1. Implement `VisiblePlayerHost` in the mini browser (Phase 93) and construct one
   `ConnectorPolicy` backed by the user's saved per-site opt-in settings.
2. Expose `snapshot()` to Fawkes now-playing and the media capability (Phase 68), and
   trigger the dance animation while `state === "playing"`.
3. Route text/voice requests (Phase 66) to `search()` then an explicit user selection.
4. Have the ad blocker consult `policy.describe(site).adBlocking`/`forUrl()`.
5. Call `await connector.dispose()` on shutdown.

## Limitations

Evidence is simulated with injected fakes. There is no real embedded player, so the
exit criteria (a real track plays in the mini player; real-size rule observed) are
**not** met until the browser host exists. SoundCloud, Bandcamp and Spotify Web have
policy and search-URL support only; no playback control. No UI or i18n is included.
