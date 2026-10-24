# Phase 68 — Media & Portfolio Capabilities

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Spotify, Apple Music (macOS only), MPRIS media control (Linux, `playerctl`; fake runner only, never run on Linux) and a read-only portfolio built and tested with a fake script runner and local mock servers; neither macOS player was running or installed, so no playback control was ever run against a real player, and no real exchange or indexer was contacted; Fawkes does not dance; "no write endpoints" is checked by a static scan test; exit criteria partly met |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | [Phase 94 — YouTube Music & Site Connectors](phase-94-youtube-music-and-site-connectors.md) |

## Goal

Optional personal capabilities: what is playing, and a read-only crypto portfolio.

## Tasks — parity with Coucou

- [ ] Spotify: cover, title, artist, seek, play/pause, previous/next, shuffle, repeat, volume; Fawkes dances while it plays. Built (`capabilities/spotify`, `test/spotify.test.ts`) with a fake script runner: now playing with the cover as an inline `data:` image, and every control. Not done: Fawkes does **not** dance (no Fawkes state means "enjoying music" and a new state may not be added, so the capability declares no `state_rules`, asserted by "declares no state_rules…"); repeat is off or all only; the AppleScript dictionary terms (`artwork url`, `repeating`) come from public docs and were never run against Spotify.
- [ ] Apple Music: now playing and controls. Built (`capabilities/apple-music`, `test/apple-music.test.ts`) with a fake script runner; macOS only; cover art read from the Music app through a fixed AppleScript (`COVER_SCRIPT`, `raw data of artwork 1`), capped at 400 KB, PNG/JPEG by magic bytes only, returned as an inline `data:` URI like Spotify's (`test/apple-music.test.ts` "cover art"). Never run against the Music app, so the real `raw data` output and which tracks expose artwork are unconfirmed; a TIFF or other non-PNG/JPEG cover is refused, not converted.
- [ ] Linux media (Phoenix addition, not a Coucou item): `capabilities/mpris` shows what an MPRIS player is playing and controls it through `playerctl` (argv only, no shell): now playing (no cover), play/pause, next, previous, seek, volume, shuffle, repeat, each control a `write` that asks, with an optional validated `player` name (`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`, one `--player=NAME` argument, never an option). Tested with a fake runner only (`capabilities/mpris/test/mpris.test.ts`); no `playerctl`, D-Bus session or player was ever run, so nothing ran on a real Linux machine. Not done: cover art; Windows (see below).
- [ ] Portfolio: 16 networks and 6 exchanges, balances, 7-day sparklines, 24-hour change. Built (`capabilities/portfolio`, `test/portfolio.test.ts`) against local mock servers: 16 networks (btc, ltc, doge, eth, optimism, base, arbitrum, polygon, gnosis, etc, xrp, xlm, algo, ton, trx, atom; native coins; token balances on 11 of them from an owner watch list, see Implementation notes), 6 exchanges with signed GETs (Binance, Bybit, OKX, KuCoin, Gate with HMAC; Coinbase Advanced Trade with an ES256 JWT, see below; spot and funding balances), and prices, 24-hour change and a 7-day sparkline from one CoinGecko `coins/markets` GET. Unticked because no network, exchange or CoinGecko was ever contacted: the response shapes and the six signing recipes come from public documentation, and the local mock recomputes signatures from the same reading, so a misreading would pass. Coinbase (`src/coinbase-jwt.ts`, `test/coinbase.test.ts`): a fresh ES256 JWT per request signed with `node:crypto` only (header `alg`/`kid`/`nonce`/`typ`, claims `sub`/`iss`/`nbf`/`exp`=nbf+120/`uri`=`GET api.coinbase.com/api/v3/brokerage/accounts`), the key name and the ECDSA P-256 PEM private key kept as the secrets `coinbase_key` and `coinbase_secret`, any other key type refused before use, one GET of List Accounts (crypto and vault accounts only), no second page accepted. Its mock verifies the signature with the public key of a pair generated at test time, the exact header and claims, nonce uniqueness and expiry, but from the same reading of Coinbase's documentation as the code, and real Coinbase was never contacted. Solana and Kraken are not covered.

## Tasks — Phoenix improvements

- [x] Portfolio is read-only by construction: public addresses and read-only keys only, no order or transfer code at all. The capability uses only the GET-only `ReadOnlyClient`; `capabilities/portfolio/test/read-only.test.ts` scans every source file for non-GET methods, `ServiceClient` and money-moving verbs, and `read-only-scan.test.ts` checks the scanner itself (the parent mutation-checked it: appending a `.post` call makes the scan fail). Source-level only; the real exchange and indexers were never contacted, and a read-only key is only as read-only as the permissions the person gave it.
- [x] Both are separate capabilities, off unless enabled. `spotify`, `apple-music` and `portfolio` are registered as installed, not enabled (`core/runtime/test/builtins.test.ts` "registers every first-party capability, installed and not enabled"). Playback controls are side effect `write`: each asks the person and is audited (`spotify.test.ts` "declares every control as a write that asks, and a declined control does nothing").

## Deliverables

- capabilities/spotify, apple-music, mpris, portfolio: built, each with a README. Web: `NowPlaying` and `Portfolio` glances in the Overview (`apps/web/test/now-playing.test.tsx`, `portfolio.test.tsx`; component tests with a fake Core, not looked at in a browser).

## Exit criteria

- [ ] Playback control works against a real player. Not met. Neither Spotify nor Music was running or installed. The only real checks were `osacompile` (the scripts compile) and a real `osascript` "is running" check, which returned false and did not launch Spotify.
- [x] Portfolio code has no write endpoints (checked by test). Met by the static scan test `capabilities/portfolio/test/read-only.test.ts` (source level only; see above).

## Implementation notes

### What was built

- Linux: `capabilities/mpris` runs `execFile("playerctl", args)` (the only process seam, `src/playerctl.ts`; 5 s timeout, 64 KB output cap). `now_playing` first reads `playerctl --list-all` and reports `not_running` (never starts a player) when no well-formed name matches, then reads one `metadata --format=` template that is a constant. Control arguments are fixed words, range-checked numbers, or a player name matched against an allow-list regex and sent as one `--player=NAME` argument. Player text is cleaned and clipped like the other media capabilities. The capability appears in the web Now playing glance (`MEDIA_SERVICES`), the voice "what am I listening to" lookup (`mpris.now_playing`), and has a fixed pill colour and glyph. Off Linux it reports unsupported and degraded and runs nothing. The `playerctl` format variables and words come from its README and source, not from a run.
- Playback runs fixed AppleScript constants through `execFile("osascript", ["-e", SCRIPT, ...args])`. Seek and volume are validated integers passed as separate arguments, never in the script text; a track title cannot reach a script. Every script returns `not_running` before it would launch the app (so Phoenix never opens Spotify or Music). The runner is injectable; off macOS the capability reports unsupported and degraded and never runs a script.
- Apple Music cover art: `COVER_SCRIPT` is a constant with no argument (no track text can reach it); the runner caps output at about 800 KB (hex), `src/cover.ts` decodes it, refuses over 400 KB and anything but PNG/JPEG magic bytes (SVG, HTML, WebP, GIF, garbage), writes no temp file, and any error or 5 s timeout means no cover. Same inline `data:` URI and unchanged CSP.
- Spotify cover art: the capability itself fetches only from `https://*.scdn.co` (no redirects, 400 KB cap, JPEG/PNG/WebP byte check) and returns an inline `data:` URI, because the web CSP is `img-src 'self' data:`. The CSP was not loosened.
- Portfolio uses only `ReadOnlyClient`. Addresses are validated per network before they reach a URL. Public indexers are free and rate-limited; their terms were not reviewed.
- Web: the `NowPlaying` and `Portfolio` glances refresh on load, after a control and on reconnect, not on track events (ephemeral events are not forwarded to clients).

### Security fix from review

A static review (not a human audit) found no exploitable defect in the AppleScript, the cover fetch, the signing, the address validation or XSS. It found one Low issue: the portfolio `endpoints` setting could redirect signed exchange requests. Fixed: exchange URLs are code-only (`exchangeUrls`), and `endpoints` applies to the public network indexers only and carries no credential.

### Other limits

Portfolio tokens (`capabilities/portfolio/src/tokens.ts`, `test/tokens.test.ts`, 41 tests with fake HTTP): read-only token balances (ERC-20 on the seven Blockscout networks, TRC-20, Stellar credit assets, Algorand assets, Cosmos denominations) for contracts in an owner-configured `tokens` watch list only (at most 10 per network, only for addresses already listed; contract validated per network, TRON by Base58Check). No new host: the same indexers, wallet address only. Strict parsing in `BigInt` (integer strings below 2^256, decimals must match the owner's), own `<id>:tokens` source, fixed messages. Tokens are never priced. Evidence is simulated: no real indexer or contract was contacted; the token response shapes come from public documentation. Not supported: btc, ltc, doge (no tokens), xrp and ton (no keyless GET route established); EIP-55 mixed-case checksums are not verified (no Keccak in `node:crypto`).

Linux playback is implemented as the `mpris` capability (fake-tested only, see its README). Windows playback is not implemented: reading the WinRT `GlobalSystemMediaTransportControlsSessionManager` needs PowerShell to await WinRT async operations through reflection, which could not be tested faithfully without a Windows machine, so the capability reports unsupported there rather than ship an untested script. macOS keeps `spotify` and `apple-music`; `mpris` is unsupported and degraded off Linux. Exchange balances are spot and funding only. Emoji control icons were not looked at. A relaunch race between the not-running check and the `tell` block is theoretically possible (inference, not tested). The xrpscan `xrpBalance` and Blockscout `coin_balance` shapes are the first to check against live services.

What was not done or not run: any real player, exchange, indexer or CoinGecko request; Fawkes dancing; a real Music app's artwork; any run of `mpris` against a real `playerctl`, D-Bus session or Linux player; Windows media; Solana, tokens, Kraken, and any real Coinbase request or key (its ES256 signing is built and mock-tested only). Open items are in the [gap register](../gaps.md).

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
