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

## The player model (web side, built)

`apps/web/src/core/youtube-player.ts` is the `VisiblePlayerHost` for `YouTubeMusicConnector`, written against an
injected `YtApi` (the shape of YouTube's IFrame Player API `YT.Player`). It holds Phoenix's rules and nothing else:

- the embed address is `https://www.youtube.com/embed/<videoId>` built by `embedUrl()` from an 11-character
  `[A-Za-z0-9_-]` id (`isVideoId`, now exported by the capability and used by `validateSelection` too), with `enablejsapi=1`
  and no `autoplay`. After the API makes the frame, `isEmbedAddress()` checks that its `src` really is that address,
  else the player is destroyed (`bad_embed`);
- the id reaches the player only through `pickResult(results, index, gesture)`: it needs a `UserGesture`, which can be made
  only from a trusted (`isTrusted`) click/key event, and rebuilds the selection from a validated row (title and channel are
  stripped of control and bidi characters and cut to 300). Page text, a synthetic event or an agent cannot make one;
- `MiniPlayer.fit(space)`: the surface is shown at the wanted size reduced only down to the space and **never below
  200 × 200**; with less room it is hidden (after pausing), not shrunk. `resize()` and the constructor raise anything
  smaller to 200 × 200; load and play refuse while hidden (`not_visible`);
- pause before hide: `hide()` runs the connector's `beforeHide` hook (a failing hook does not stop the next step), then
  pauses the iframe player itself if it is still playing, then hides. A `playing` report from the iframe while hidden is
  paused again at once and passed on as `paused` (`bindConnector` forwards reports to `onPlayerState`);
- play only after a gesture: `play()` needs `noteGesture()` within 10 s (`GESTURE_WINDOW_MS`); a stale or missing gesture is
  `gesture_required`. Fawkes, voice and the queue can search and select, but a person presses the button that starts sound;
- no ad blocking inside the player: the embed is the stock iframe and nothing here filters it; the Shields exemption
  (connector policy `adBlocking: "exempt"`, YouTube hosts, only while the connector is on) is unchanged;
- `openSearch()` only opens `https://www.youtube.com/results…` through an injected page opener; it never scrapes;
- `nowPlayingOf(snapshot)` shapes the connector snapshot like the Now playing glance (`core/media.ts`).

Test: `apps/web/test/youtube-player.test.ts` (31) against a **fake** IFrame API. No iframe was created, no YouTube script was
loaded and nothing played. The sections below say what is missing.

## Hosting the embed: why it is not wired (decision)

The model needs a page that frames `https://www.youtube.com/embed/<id>` and, for the IFrame API, loads
`https://www.youtube.com/iframe_api` (a remote script). No surface in Phoenix can do that without weakening isolation:

- every page Core serves (`core/api/src/static.ts` `PAGE_HEADERS`) has `script-src 'self'`, `default-src 'self'` (so no
  `frame-src`) and carries the **per-start Core session token** in a `<meta>` tag in the same origin. Adding YouTube to
  `script-src` there would run remote script with the token. The Phoenix chrome page (`browser.html`) is one of them and also
  holds the Tauri `phoenix-browser` capability, so framing remote content in it is excluded outright;
- pages the shell serves itself (`WebviewUrl::App`) share the single global `app.security.csp` of `tauri.conf.json`
  (`script-src 'self'`, no `frame-src`); `app.security.csp` is one global setting (no per-window CSP was found in the config schema used here), so opening it for a player page opens it for the pet,
  the island and the pill;
- one webview cannot hold both the chrome and a remote iframe without letting that frame's script reach the chrome's
  IPC; the remedy would be `Window::add_child` (the `unstable` feature, not enabled) or a separate window.

What would honestly unblock it, none built: (1) a dedicated **player window with no capability file** whose page is served
from an origin that carries no token (Core would have to serve `player.html` without `injectToken` and with its own CSP
`frame-src https://www.youtube.com; script-src 'self' https://www.youtube.com https://s.ytimg.com`, on a port or host that
is not the session's), created by Rust with a label that appears in no capability; or (2) a content window that loads
`https://www.youtube.com/embed/<id>` as a top-level page (no parent page, so no IFrame API: pause before hide would be
navigating to `about:blank`, play would be YouTube's own button, and the size rule would be the window's minimum size).
Option (2) needs only Rust (`browser.rs`) and gives up programmatic control; option (1) needs Core static-server and Rust
work. A person must also look at it on a real display: whether YouTube accepts the embed from either origin (error 150/153 for
a missing referrer or origin is possible) was never seen.

## Integration hooks still needed from the browser

1. Host the player surface (see above): `MiniPlayer` implements `VisiblePlayerHost`, but nothing mounts it.
2. Expose `snapshot()` to Fawkes now-playing and the media capability (Phase 68), and
   trigger the dance animation while `state === "playing"`. `nowPlayingOf()` shapes the data, but the Now playing glance reads
   Core capabilities (`MEDIA_SERVICES`: Spotify, Apple Music, MPRIS) and none can see a webview-hosted player; no event
   carries it. Not wired.
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
