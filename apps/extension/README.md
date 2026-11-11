# Phoenix: send page (browser extension)

A click-only Manifest V3 extension with one action, "Send page to Phoenix". It sends the tab's origin and path (no query, no fragment), its title and, if you selected text, that selection to your local Phoenix through the native-messaging host `dev.phoenix.companion`. The host (not the extension) holds the session token and talks only to `http://127.0.0.1:<port>`. Design and limits: [docs/companion-clients.md](../../docs/companion-clients.md#browser-extension-send-page-to-phoenix).

## Status

Loaded unpacked and driven once in a **real Chrome 157.0.8103.50 (macOS arm64)** throwaway profile against a real Core process on 2026-11-11: no manifest errors or warnings, Chrome itself started the host, the note arrived in Core with the query and fragment dropped, and a host manifest listing a different extension id was refused by Chrome. That run used the DevTools command `Extensions.triggerAction`, **not a real click**. Not verified: a real user click, Edge, Brave, Chromium, Firefox, Windows, Linux, store review. Evidence: [phase-89-real-browser-extension-2026-11-11.md](../../docs/evidence/phase-89-real-browser-extension-2026-11-11.md).

## Install for real use (per user)

1. `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension`. Copy the 32-letter id. With no `key` in `manifest.json` the id is derived from the absolute path of this folder, so it changes if you move the checkout.
2. `node apps/extension/scripts/install-host.js install --chrome-id <id> --browser chrome` (writes the manifest into the browser's real per-user `NativeMessagingHosts` folder; `uninstall` removes it).
3. Start Core, open a page, click the toolbar button.

If the button shows `!` with "host is not installed", the browser said either `Specified native messaging host not found.` (no manifest) or `Access to the specified native messaging host is forbidden.` (the manifest's `allowed_origins` lists another id). The extension shows the same hover text for both.

## Loading in current Chrome

`--load-extension=<path>` was silently ignored by Chrome 157 (the extension did not load). The mechanism that worked is the DevTools command `Extensions.loadUnpacked {path}`, which needs `--enable-unsafe-extension-debugging` and a debugging transport. Loading through `chrome://extensions` → **Load unpacked** is the normal route for a person.

## Manual real-browser check (never run by CI)

`scripts/real-browser-check.mjs` repeats the Phase 89 run: three throwaway browser profiles (host allowed, host manifest for a different id, no host manifest), a child Core with a temp data dir on a free port, and a local test page.

```
PHOENIX_REAL_BROWSER_CHECK=1 node apps/extension/scripts/real-browser-check.mjs \
  [--browser "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] [--out result.json]
```

Safety rules it keeps: it never attaches to or signals a running browser; every browser it starts has a fresh `--user-data-dir=/tmp/p89-profile-*`, `--no-first-run`, `--no-default-browser-check` and `--remote-debugging-pipe` (no TCP debugging port); the host manifest and launcher are written only into that profile's `NativeMessagingHosts/` (it does not run `install-host.js`, which targets the real per-user folders); Core uses a temp `PHOENIX_DATA_DIR` and port 0; it kills only the processes it started, deletes its temp dirs and checks that the browser that was already running is unchanged. macOS and Linux only. It uses `Extensions.triggerAction`, which is not a user gesture.

## Tests

`pnpm vitest run apps/extension` (fake `chrome` API, host framing and hostile-message tests, installer with fake file system and registry runner, in-process Core).
