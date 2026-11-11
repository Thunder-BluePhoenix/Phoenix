# Phase 89: "Send page to Phoenix" in a real Chrome (2026-11-11)

One manual run, one machine. Raw data: [`phase-89-real-browser-extension-2026-11-11-raw.json`](phase-89-real-browser-extension-2026-11-11-raw.json), produced by `apps/extension/scripts/real-browser-check.mjs` (guarded by `PHOENIX_REAL_BROWSER_CHECK=1`, not a vitest test, never run by CI). Nothing was tuned after a result; the only edits between the first and the last run were to the script's own driving code (see "Driving problems").

**Not a human click.** The toolbar button was not clicked by a person. The run used the browser's own `Extensions.triggerAction` DevTools command, which runs the extension's action for a tab target; that is not a user gesture. See "What this does not show".

## Setup

- Browser: Google Chrome `157.0.8103.50` (macOS arm64), `/Applications/Google Chrome.app`. Brave was not needed.
- Safety: the user's Chrome (main pid 44673, started `Fri Oct 30 13:13:23 2026`) was never attached to, signalled or reused. Each of the three scenarios launched a SEPARATE browser process with a fresh `--user-data-dir=/tmp/p89-profile-XXXXXX`, `--no-first-run`, `--no-default-browser-check`, `--remote-debugging-pipe` (no TCP debugging port existed) and `--enable-unsafe-extension-debugging`. After the run pid 44673 was still running with the same start time, no process with our profile remained (`leftoverProcessesWithOurProfile: 0`), and all temp dirs, the host log and the scratch scripts were deleted. The real per-user `~/Library/Application Support/Google/Chrome/NativeMessagingHosts` was listed before finishing and holds nothing of ours; `install-host.js` was never run.
- Core: a real child process `tsx core/runtime/src/main.ts` with `PHOENIX_DATA_DIR=/tmp/p89-core-XXXXXX`, `PHOENIX_PORT=0` (a free loopback port; it wrote `core.json` and `session.token` there), on Node v22.19.0. Never 47821/47822 or `~/.phoenix`.
- Test page: a local `node:http` server on `127.0.0.1:<random>` serving `/notes/page1` with title `Phoenix real-browser test page`. The tab was opened at `/notes/page1?token=zzz&utm=distinct#frag-distinct` (a distinct path, query and fragment). A script-made selection of `Selected sentence for Phoenix.` (30 characters) was set in the page before the action.
- Host manifest: written BY HAND into `<temp profile>/NativeMessagingHosts/dev.phoenix.companion.json` by the check script, using the installer's own `buildManifest()` and `launcherScript()` (imported from `install-host.js`), because `install-host.js` can only target the real per-user folders and has no directory option. The launcher differs from `launcherScript()` in two lines before the `exec`: it exports `PHOENIX_DATA_DIR` (so the host finds the throwaway Core; the host reads `core.json` and `session.token` from there) and appends `pid, ppid, parent command` to a temp log so the browser's launch of the host is observable. Manifest content (scenario A): `{ name: "dev.phoenix.companion", type: "stdio", path: "<temp profile>/phoenix-host-launcher.sh", allowed_origins: ["chrome-extension://bgimidembamdjimmcdhpbgcjoiagokhj/"] }`.

## Loading mechanism

| Mechanism                                                                                                     | Result in Chrome 157                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--load-extension=<path>` (with a fresh profile, `--remote-debugging-port=0`)                                 | Accepted silently, extension NOT loaded: `Extensions.getExtensions` returned `[]`, no extension service-worker target appeared. (One ad hoc probe, not part of the script.) |
| CDP `Extensions.loadUnpacked {path}` with `--enable-unsafe-extension-debugging` and `--remote-debugging-pipe` | Worked: returned `{ id: "bgimidembamdjimmcdhpbgcjoiagokhj" }`. This is what the script uses.                                                                                |
| The same command over `--remote-debugging-port=0` (loopback)                                                  | Worked identically (ad hoc probe). The script uses the pipe so no network port exists.                                                                                      |

The Chrome `Extensions` DevTools domain is marked experimental in the protocol document.

## Extension identity and manifest health

- Id `bgimidembamdjimmcdhpbgcjoiagokhj`. `manifest.json` has no `key`, so the id is path-derived: SHA-256 of the absolute path `/Users/bluephoenix/projs/Phoenix/apps/extension`, first 16 bytes, hex digits mapped to `a`-`p`. The script recomputes it and it matched (`idMatchesPathDerivation: true`). The id therefore differs per checkout location; `allowed_origins` has to be written from the id the browser reports, as `install-host.js install --chrome-id <id>` expects.
- `chrome.developerPrivate.getExtensionsInfo` (read from a `chrome://extensions` target, the data that page shows) for the extension: `state: ENABLED`, `location: UNPACKED`, `manifestErrors: []`, `runtimeErrors: []`, `installWarnings: []`, every `disableReasons` flag false, permission text `Communicate with cooperating native applications`, `pinnedToToolbar: true`. The service worker `chrome-extension://<id>/src/background.js` appeared as a target, with no exception or console event captured (`serviceWorkerEvents: []`). The browser's stderr contained only Chrome's own updater/crashpad noise (the first lines of it are in the raw file).

## A: manifest allows this extension's id

1. `Extensions.triggerAction {id, targetId: <tab target of the test page>}` returned `{}` (success). Note that it needs the target of type `tab`, not `page`; with a `page` target it answered `Action can only be triggered on a tab target.`
2. The action was received by the extension: the badge on that tab became `OK`, hover title `Sent to Phoenix. Review it in Phoenix, under Pages.`
3. **The browser started the host itself.** In the preserved raw file the launcher logged `pid=64780 ppid=63645 args=chrome-extension://<id>/`, and `ps` for pid 63645 shows `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/p89-profile-... --remote-debugging-pipe ...`: the host launcher's parent was our throwaway browser's main process (a child of the check script, pid 63491), not the script and not the user's Chrome (44673). Chrome's first argument is the caller's origin, `chrome-extension://<id>/`. The manifest existed only in `<temp profile>/NativeMessagingHosts/`, so Chrome found the host there; the real per-user and system folders hold no `dev.phoenix.companion`. (`processesStartedByClick` in the raw file is empty: that field only matches a process named like the launcher among later ps rows and the short-lived host had already exited; the launcher log is the evidence.)
4. Core received one note (`GET /api/companion/pages`, session token): `url: http://127.0.0.1:<port>/notes/page1`, `title: "Phoenix real-browser test page"`, `selected_text: "Selected sentence for Phoenix."`, id `pn_` + 24 hex characters. The query (`token=zzz&utm=distinct`) and fragment (`frag-distinct`) appear nowhere in the stored note (`newNotesContainQueryOrFragment: false`, `newNoteUrlIsOriginAndPathOnly: true`). The selection arriving also shows `activeTab` was granted for the action and `scripting.executeScript` ran in the page.
5. Audit (`GET /api/audit?limit=200`, rows whose action starts with `companion.`): exactly one, `actor: companion`, `action: companion.page.received`, `decision: info`, details `{ id, host: "127.0.0.1:<port>", selection_chars: 30 }` (host, no path, no query, no selection text).
6. Settings list API: `GET /api/companion/pages` returned that one note (`status 200`). The Settings web screen was not opened in this run; only the API it reads from was.

## B: manifest lists a different extension id (negative control)

The host manifest in a fresh profile had `allowed_origins: ["chrome-extension://pppppppppppppppppppppppppppppppp/"]`. The same trigger produced badge `!` with hover `Phoenix's native-messaging host is not installed for this browser.` A direct `chrome.runtime.sendNativeMessage("dev.phoenix.companion", ...)` from the extension's service worker returned no response and `chrome.runtime.lastError.message` = **`Access to the specified native messaging host is forbidden.`** The launcher log stayed empty: Chrome did not start the host. The note count stayed at 1. So Chrome 157 enforces `allowed_origins`.

## C: no host manifest (negative control)

A fresh profile with no `NativeMessagingHosts` folder: badge `!`, same hover text; `lastError.message` = **`Specified native messaging host not found.`** No host started, note count stayed at 1.

## Diagnosis worth keeping

- The extension maps ANY `runtime.lastError` to `host_missing` ("not installed for this browser"). In B the host IS installed but forbidden for this id, so the hover text is misleading (the person should fix the id in `allowed_origins`, not install again). Not changed here: it is a wording choice, not a defect that loses data. Recorded as a limitation.
- The in-extension error text is not logged anywhere; `lastError.message` is only visible by calling the API from the service worker, as this script did.

## Driving problems (script, not extension)

1. `Target.createTarget {url}` over the pipe left the tab at `about:blank` (never requested the page); the script now creates `about:blank` and uses `Page.navigate`.
2. `Extensions.triggerAction` needs the `tab` target; `Target.getTargets` without a filter did not list it, so `filter: [{ type: "tab" }]` is passed.
3. The first cleanup check compared all processes that contained `.app/`, which also matched Chrome helper processes and flagged the user's own browser as "changed"; the check now compares only the rows whose command is exactly the browser binary (the main process), by pid and start time.

## What this does not show

- **A real click.** `Extensions.triggerAction` is the browser's DevTools shortcut for the action; no mouse event, no toolbar interaction, no user gesture. The script-made text selection is also not a person's selection. Whether `activeTab` is granted exactly the same by a physical click was not tested; here the grant was observed to work for the trigger.
- Chrome 157 on macOS arm64 only; headed, throwaway profile; a profile where the person already has the extension installed from a store, or Chrome policy that restricts native messaging (`NativeMessagingBlocklist` etc.), was not exercised.
- Edge, Brave, Chromium and Firefox were not run. The Firefox build and the Windows registry path remain untested. The Linux manifest folder behaviour was not run.
- No store review (Chrome Web Store, Edge Add-ons, Mozilla Add-ons).
- The Settings screen was not rendered (the Core API behind it was read); there was no model and no web UI in this run.
- One Core, one note, one page, no failure of the Core side (Core stopped, wrong token) was driven through the real browser.
- `install-host.js` itself (the per-user install) was not run against any real folder; only its `buildManifest` and `launcherScript` were reused.

## Replacement for the Phase 89 "Send page to Phoenix" row

See the final report: observed in Chrome 157 only; still unverified for a real click, other browsers, store review.
