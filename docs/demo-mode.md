# Demo mode

Demo mode is a scripted, safe walkthrough of Phoenix. It plays the existing mock-capability scenarios for builds, tests, coding agents, deployments, meetings, Frappe health and merge conflicts.

## What it does

Start it from **Settings → Demo mode**. The web app shows the persistent **“Demo - nothing is saved”** banner, changes to an isolated temporary Core, and offers the walkthrough steps. Each step invokes the mock capability's existing `simulate` command; it does not copy scenario events into the demo implementation.

Starting the demo stops this page's microphone features first: voice listening is switched off, and a call recording in progress makes the demo refuse to start (stop the recording first), so no real microphone, socket or session keeps running behind the demo banner.

Stop it with **Stop demo and go back**. The web app reconnects to the real Core and restores the route you were on.

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

| Route                  | Result                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/demo/start` | Starts the isolated Core and returns `{ url, token, steps }`. `steps` are ordered `{ scenario, caption_id, caption, route }` values. |
| `POST /api/demo/stop`  | Stops the isolated Core; returns `{ stopped }`.                                                                                      |
| `GET /api/demo/status` | Returns `{ running, step_count, idle_limit_ms }`.                                                                                    |

Giving the temporary demo token to the holder of the real session token is intentional: it grants access only to an isolated, in-memory Core with no real data. The web app validates that the returned URL is exactly loopback `http://127.0.0.1:<port>` before using it.

## Verification boundary

The automated Core and web tests cover token separation, state/database/keychain/file isolation, kill-switch and single-demo limits, idle stop, browser client switching and restoration. It was **not run in the packaged desktop app**.
