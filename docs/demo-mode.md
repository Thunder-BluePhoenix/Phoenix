# Demo mode

Demo mode is a scripted, safe walkthrough of Phoenix. It plays the existing mock-capability scenarios for builds, tests, coding agents, deployments, meetings, Frappe health and merge conflicts.

## What it does

Start it from **Settings → Demo mode**. The web app shows the persistent **“Demo - nothing is saved”** banner, changes to an isolated temporary Core, and offers the walkthrough steps. Each step invokes the mock capability's existing `simulate` command; it does not copy scenario events into the demo implementation.

Starting the demo stops this page's microphone features first: voice listening is switched off, and a call recording in progress makes the demo refuse to start (stop the recording first), so no real microphone, socket or session keeps running behind the demo banner.

Stop it with **Stop demo and go back**. The web app reconnects to the real Core and restores the route you were on.

## Automatic walkthrough (optional)

Below the step buttons, **Play automatically** runs the same steps through the same controller as **Next step**: the first step at once, then one step every 6 seconds, ending on the last step (the screen stays there; **Stop demo and go back** is still the way out). **Pause** keeps the current step and stops the clock, **Resume** goes on from it, and **Stop and start over** ends the run and resets the walkthrough to its first screen (the demo Core and the route are left as they are).

- It never starts by itself. Only pressing **Play automatically** starts it, so a demo that is merely open never moves.
- With `prefers-reduced-motion: reduce` the page says so and the walkthrough still only advances after that explicit press. If the preference turns on while a run is going, the run is paused.
- Any other driver ends the run (it goes back to idle and the screen stays as it is): a step played by hand (Previous, Play this step, Next), a hash-route change that is not the step's own route (navigating by hand), stopping the demo, the walkthrough unmounting, or a step that fails (the error is shown as for a manual step).
- Its one timer is cleared and its subscriptions removed whenever the run ends or the walkthrough unmounts. The interval (`DEFAULT_STEP_INTERVAL_MS`, 6000), the timer functions and the reduced-motion source are injectable (`DemoHost`'s `timeline` prop, `DemoTimeline` options) so tests use fake timers. There is no setting for the interval in the UI.
- Code: `apps/web/src/core/demo-timeline.ts`, wired in `apps/web/src/components/Demo.tsx`; tests: `apps/web/test/demo-timeline.test.tsx` (fake timers, no real clock). Non-English strings for the new controls are machine-generated and not reviewed by a native speaker.

## Floating window and island: follow the demo (built, never run in a real window)

The main web app switches its own client to the demo Core. The floating window and the island are separate webview entry points on the real Core, and they are **not** given the demo URL or token. Instead the real Core reports the running demo's Fawkes state and active tasks on `GET /api/demo/view` (real session token; `{ "running": false }` when no demo runs). The answer holds only `state` (`state`, `explanation`, `since`, `recording`, `sleeping`) and up to 20 `tasks`, read from the demo runtime's own state engine; no address, no token, no condition list.

`DemoFollowProvider` (`apps/web/src/core/demo-follow.tsx`, mounted in `floating/main.tsx` and `island/main.tsx` only) polls that route every 1.5 s while the real Core is online and validates the answer (`demo-view.ts`: bounded text and counts, state names `[A-Z_]{1,24}`, only known fields copied; anything malformed counts as "no demo"). While a view is present `useDisplayedState`, `useTasks` and the pill list show the demo's state and tasks (the real agent sessions are left out of the pills); when the demo ends, the answer is malformed, the request fails or the real Core goes offline, the window shows the real Core again. OFFLINE is never hidden by the demo.

Not covered: the dictation pill (a page served by Core with its own client; it shows dictation, not Fawkes' state, and is not given a demo view), glance data of other cards (only state and tasks follow; the Pet summary and approvals list in those windows still read the real Core), and the poll delay (up to 1.5 s after a state change). Tests use fakes (`apps/web/test/demo-follow.test.tsx`, `core/runtime/test/demo.test.ts`); nothing ran in a real window.

## Isolation and safety

A demo is a separate `PhoenixRuntime`, not a special state inside the real one:

- Its SQLite database is `:memory:`; it never opens the real database.
- It has a separate event bus, state engine, settings store, notification store, permission gateway, audit log, capability manager, secret store and kill switch.
- Its secret store is `MemorySecretStore`; it never asks the OS keychain for a credential.
- Its session token is freshly random, is never written to a token file, and is accepted only by its own Core. The real Core rejects that token; the demo Core rejects the real token.
- It binds a fresh loopback-only port and accepts only the browser origin that was already accepted by the real Core.
- It contains only the mock capability, has no network fetcher, starts no agent relay socket, cannot use Git or focus terminal windows, and cannot start another demo. Its sync relay transport is also a refusing one: configuring and running sync inside the demo reports a failure and makes no network request.
- Its data directory is a fresh temporary path that is never created (not the real data folder). The real data directory, real database rows and real state are not read or changed by the walkthrough.

Only one demo can run at a time. It refuses to start when the real emergency stop is engaged, and a real emergency stop also ends a running demo. It stops automatically after ten minutes without mock scenario activity. Stopping Core stops its demo first.

## API

All routes require the real Core's normal session token.

| Route                  | Result                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/demo/start` | Starts the isolated Core and returns `{ url, token, steps }`. `steps` are ordered `{ scenario, caption_id, caption, route }` values.  |
| `POST /api/demo/stop`  | Stops the isolated Core; returns `{ stopped }`.                                                                                       |
| `GET /api/demo/status` | Returns `{ running, step_count, idle_limit_ms }`.                                                                                     |
| `GET /api/demo/view`   | Returns `{ running: false }` or `{ running: true, state, tasks }` of the demo (no URL, no token), for the floating window and island. |

Giving the temporary demo token to the holder of the real session token is intentional: it grants access only to an isolated, in-memory Core with no real data. The web app validates that the returned URL is exactly loopback `http://127.0.0.1:<port>` before using it.

## Verification boundary

The automated Core and web tests cover token separation, state/database/keychain/file isolation, kill-switch and single-demo limits, idle stop, browser client switching and restoration. It was **not run in the packaged desktop app**.
