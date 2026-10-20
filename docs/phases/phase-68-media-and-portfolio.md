# Phase 68 — Media & Portfolio Capabilities

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Spotify, Apple Music (macOS only) and a read-only portfolio built and tested with a fake script runner and local mock servers; neither player was running or installed, so no playback control was ever run against a real player, and no real exchange or indexer was contacted; Fawkes does not dance; "no write endpoints" is checked by a static scan test; exit criteria partly met |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | [Phase 94 — YouTube Music & Site Connectors](phase-94-youtube-music-and-site-connectors.md) |

## Goal

Optional personal capabilities: what is playing, and a read-only crypto portfolio.

## Tasks — parity with Coucou

- [ ] Spotify: cover, title, artist, seek, play/pause, previous/next, shuffle, repeat, volume; Fawkes dances while it plays. Built (`capabilities/spotify`, `test/spotify.test.ts`) with a fake script runner: now playing with the cover as an inline `data:` image, and every control. Not done: Fawkes does **not** dance (no Fawkes state means "enjoying music" and a new state may not be added, so the capability declares no `state_rules`, asserted by "declares no state_rules…"); repeat is off or all only; the AppleScript dictionary terms (`artwork url`, `repeating`) come from public docs and were never run against Spotify.
- [ ] Apple Music: now playing and controls. Built (`capabilities/apple-music`, `test/apple-music.test.ts`) with a fake script runner; macOS only; no cover art. Never run against the Music app.
- [ ] Portfolio: 16 networks and 5 exchanges, balances, 7-day sparklines, 24-hour change. Built (`capabilities/portfolio`, `test/portfolio.test.ts`) against local mock servers: 16 networks (btc, ltc, doge, eth, optimism, base, arbitrum, polygon, gnosis, etc, xrp, xlm, algo, ton, trx, atom; native coins only, no tokens), 5 exchanges with HMAC-signed GETs (Binance, Bybit, OKX, KuCoin, Gate; spot and funding balances), and prices, 24-hour change and a 7-day sparkline from one CoinGecko `coins/markets` GET. Unticked because no network, exchange or CoinGecko was ever contacted: the response shapes and the five signing recipes come from public documentation, and the local mock recomputes signatures from the same reading, so a misreading would pass. Solana, Kraken and Coinbase are not covered.

## Tasks — Phoenix improvements

- [x] Portfolio is read-only by construction: public addresses and read-only keys only, no order or transfer code at all. The capability uses only the GET-only `ReadOnlyClient`; `capabilities/portfolio/test/read-only.test.ts` scans every source file for non-GET methods, `ServiceClient` and money-moving verbs, and `read-only-scan.test.ts` checks the scanner itself (the parent mutation-checked it: appending a `.post` call makes the scan fail). Source-level only; the real exchange and indexers were never contacted, and a read-only key is only as read-only as the permissions the person gave it.
- [x] Both are separate capabilities, off unless enabled. `spotify`, `apple-music` and `portfolio` are registered as installed, not enabled (`core/runtime/test/builtins.test.ts` "registers every first-party capability, installed and not enabled"). Playback controls are side effect `write`: each asks the person and is audited (`spotify.test.ts` "declares every control as a write that asks, and a declined control does nothing").

## Deliverables

- capabilities/spotify, apple-music, portfolio: built, each with a README. Web: `NowPlaying` and `Portfolio` glances in the Overview (`apps/web/test/now-playing.test.tsx`, `portfolio.test.tsx`; component tests with a fake Core, not looked at in a browser).

## Exit criteria

- [ ] Playback control works against a real player. Not met. Neither Spotify nor Music was running or installed. The only real checks were `osacompile` (the scripts compile) and a real `osascript` "is running" check, which returned false and did not launch Spotify.
- [x] Portfolio code has no write endpoints (checked by test). Met by the static scan test `capabilities/portfolio/test/read-only.test.ts` (source level only; see above).

## Implementation notes

### What was built

- Playback runs fixed AppleScript constants through `execFile("osascript", ["-e", SCRIPT, ...args])`. Seek and volume are validated integers passed as separate arguments, never in the script text; a track title cannot reach a script. Every script returns `not_running` before it would launch the app (so Phoenix never opens Spotify or Music). The runner is injectable; off macOS the capability reports unsupported and degraded and never runs a script.
- Spotify cover art: the capability itself fetches only from `https://*.scdn.co` (no redirects, 400 KB cap, JPEG/PNG/WebP byte check) and returns an inline `data:` URI, because the web CSP is `img-src 'self' data:`. The CSP was not loosened.
- Portfolio uses only `ReadOnlyClient`. Addresses are validated per network before they reach a URL. Public indexers are free and rate-limited; their terms were not reviewed.
- Web: the `NowPlaying` and `Portfolio` glances refresh on load, after a control and on reconnect, not on track events (ephemeral events are not forwarded to clients).

### Security fix from review

A static review (not a human audit) found no exploitable defect in the AppleScript, the cover fetch, the signing, the address validation or XSS. It found one Low issue: the portfolio `endpoints` setting could redirect signed exchange requests. Fixed: exchange URLs are code-only (`exchangeUrls`), and `endpoints` applies to the public network indexers only and carries no credential.

### Other limits

Linux (MPRIS) and Windows playback are not implemented. Exchange balances are spot and funding only. Emoji control icons were not looked at. A relaunch race between the not-running check and the `tell` block is theoretically possible (inference, not tested). The xrpscan `xrpBalance` and Blockscout `coin_balance` shapes are the first to check against live services.

What was not done or not run: any real player, exchange, indexer or CoinGecko request; Fawkes dancing; Apple Music cover art; Linux and Windows media; Solana, tokens, Kraken, Coinbase. Open items are in the [gap register](../gaps.md).

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
