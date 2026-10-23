# 🐦‍🔥 Phoenix

**Phoenix is the platform. Fawkes is the pet.**

Phoenix is an open-source developer companion. It connects your developer tools, meetings and AI agents through a common event and capability architecture, and shows what is happening through **Fawkes**, an animated pet that lives in your navbar or floats on your desktop.

![Fawkes in every state](docs/images/fawkes-states.svg)

The first capability is **Kage**, which handles meeting capture, transcription, summaries and archiving.

> Status: unreleased and in active development. Implementation spans well beyond Stage 1 (see the [phase tracker](docs/phases/TRACKER.md)); no release has been tagged, and many release gates are still open (see the [gap register](docs/gaps.md)). Phases 56–96 (agent approvals, the Fawkes island, wardrobe, attachments, more AI providers, dictation, the notetaker, the voice assistant, service integrations, the weekly recap, shortcuts and languages, the phone link, the keep-awake, lid-closed and continuity features, the MCP server, the agent safety net, the cost meter and Mission Control, handoff notes and the secret guard, the port radar, machine health and the local model manager, engineering signals, calendar awareness, the daily digest, and focus mode and screenshot-to-issue, chat-app approvals, the remote access relay, status lights, the `phoenix` CLI, scheduled awake windows, Fawkes rebirth, team status and webhooks, and the policy engines and assistants for a mini browser, music playback, browsing and browser profiles) are built and tested with fakes and simulations, but none was run against a real coding agent, cloud AI provider key, microphone, call, global hotkey, phone, Mac lid, privileged helper, MCP client, coding-agent hook, pull request, Ollama or LM Studio, calendar account, display or screen capture, Slack, Discord or Teams workspace, relay host, light, Stream Deck, watch, OS power schedule, webview or browser, or paste into another application (the only real runs are one guarded macOS `caffeinate` test and one guarded read-only macOS port listing). Several of the newest features are only partly wired: model downloads refuse in production for lack of a trusted size source, engineering-signal advisories are always unavailable and there is no screen to opt in, no calendar provider is connected, the digest cannot send to Slack or Teams, and focus mode and screenshot-to-issue are not mounted in the app. Most of Phases 86–96 is wired into Core, its routes and (in part) the web app, but only exercised with fakes and loopback servers: the mini browser (Phase 93) and the browsing assistant (Phase 95) are not wired, no browser exists (Phase 93 is only a policy engine), there is no phone app for the relay, and no real chat workspace, light or watch has been used. "Record a call" is disabled in the desktop app because the trusted consent dialog it needs does not exist yet.

## Repository layout

| Path            | Contents                                                                     |
| --------------- | ---------------------------------------------------------------------------- |
| `protocol/`     | Versioned event schema, error codes, Fawkes state definitions                |
| `core/`         | Phoenix Core: config, logging, persistence, event bus, state engine, runtime |
| `pet/`          | Fawkes runtime, states, animations and assets                                |
| `apps/`         | `web` (navbar + Pet Panel) and `desktop` (floating Fawkes or island)         |
| `sdk/`          | Capability SDK                                                               |
| `capabilities/` | First-party capabilities, e.g. Kage, Git, GitHub, terminal, Docker, Frappe   |
| `docs/`         | Vision, phases, ADRs, contracts                                              |

## Getting started

Requires Node.js ≥ 22.13 and pnpm 10.

```sh
pnpm install
pnpm check        # typecheck + lint + tests
pnpm start        # build the web app and start Phoenix Core
```

Open <http://127.0.0.1:4870>. Fawkes lives in the top bar; click it for the Pet Panel. Set up capabilities (Git repositories, your Kage server and API key) under **Settings**.

For UI development with hot reload, run `pnpm dev:core` in one terminal and `pnpm dev:web` in another, then open <http://localhost:5173> (the Vite dev server proxies the API and picks up the core's session token).

The floating desktop Fawkes (Phase 14, in progress) and the optional notch/top-edge island (Phase 60, run on a Mac without a notch only) are a Tauri v2 app in `apps/desktop`. It needs Rust ≥ 1.90 and a running core:

```sh
pnpm dev:core
pnpm --filter @phoenix/desktop dev
```

Tools and scripts can call the API with the session token core writes to `.phoenix/dev/session.token`:

```sh
curl -H "Authorization: Bearer $(cat .phoenix/dev/session.token)" http://127.0.0.1:4870/api/pet/state
```

## Privacy

Phoenix is local-first. Everything it stores lives in its data directory on your computer (`.phoenix/<env>/`); credentials such as API keys live in your OS keychain. **Phoenix sends no telemetry.** AI features are optional and off by default. When you turn them on, a local Ollama model processes data on this device; a cloud provider is used only if you have configured it, added your own key, and granted the matching opt-ins, and sensitive data classes (for example meeting content) are never sent to the cloud by default. Only the built-in Ollama integration is treated as trusted local for sensitive data; other local servers such as LM Studio are not. Dictation clean-up, call summaries and questions about attached files are never sent to a cloud provider. Known limit: the external-AI permission and the opt-ins are protected by the local session token only, so another program running as your user that can read that token could switch them on (see the [gap register](docs/gaps.md)). Dictation and recording are off by default; dictation keeps audio in memory and recognises it on your computer. **Settings → Privacy and data** shows what is stored, sets how long each kind is kept, and deletes it. The audit log of permissions, approvals and deletions is kept for accountability.

## Documentation

- [Vision documents](docs/vision/)
- [Phase tracker](docs/phases/TRACKER.md)
- [Architecture decisions](docs/adr/README.md)
- [Event protocol v1](docs/protocol/events-v1.md)
- [Architecture](docs/architecture.md)
- [Security review](docs/security-review.md)
- [Known gaps and unverified claims](docs/gaps.md)
- [Release gates for AI features](docs/release-gates.md)
- [Developer preview programme](docs/preview/programme.md) (a plan, not a record of completed stages)
- [v1.0 verification plan](docs/release/v1-verification.md) and [v2.0 verification plan](docs/release/v2-verification.md) (plans and decisions, not releases)
- [Capability SDK docs](docs/capabilities/) and the local [0.1.0 static docs snapshot](docs/capabilities/site/0.1.0/index.html) (not hosted or published)
- [« OK Fawkes » voice assistant](docs/voice-assistant.md), [demo mode](docs/demo-mode.md) and the [interface languages](apps/web/src/i18n/README.md) (all non-English text is machine-generated and unreviewed)
- [Phone link](docs/phone-link.md) (Core side only, no phone app exists), the [keep-awake helper and recovery journal](docs/awake-helper.md) and [lid-close actions](docs/awake-lid-actions.md) (built and tested with fakes and simulations; the helper was never installed or run with root)
- [MCP server and approval channel](docs/mcp-server.md) (tested with a simulated client only; no real MCP client was run), [agent safety net](docs/agent-safety-net.md) (checkpoints, rollback, loop and stall warnings; no real agent session was rolled back), [Mission Control and cost meter](docs/mission-control.md) (no provider figure was compared), [handoff notes and secret guard](docs/handoff-and-secret-guard.md) (never run in a real agent or against a real PR) and the [port and process radar](docs/port-radar.md) (macOS listing read once; no process was ever signalled)
- [Machine health and local models](docs/machine-health.md) (Ollama and LM Studio on loopback; downloads refuse until a trusted size catalog exists), [engineering signals](docs/engineering-signals.md) (advisory provider always unavailable; opt-in screen fake-tested only), [calendar awareness and meeting prep](docs/calendar-awareness.md) (no provider connected in production; deploy freeze is opt-in), the [standup and end-of-day digest](docs/daily-digest.md) (copy plus confirmation-gated Slack send with a fake transport; no Teams/Discord send) and [focus mode and screenshot-to-issue](docs/focus-and-screenshot.md) (manual/Pomodoro Focus Mode wired; screenshot-to-issue unmounted); all built and tested with fakes and simulations only
- Phases 86–96, built as code and mostly wired into Core, routes and the web app; all evidence is simulated (fakes, loopback servers, in-memory or temporary databases) and no exit criterion is met. Wired: [chat approvals](docs/chat-approvals.md) (public Slack and Discord callback route authenticated by the provider signature, bus-driven cards; Teams notify-only, no `phoenix://` handler), the [remote relay](docs/remote-relay.md) (Core's side, key only in the OS secret store; no phone app, hosting or pairing UI), [status lights](docs/status-lights.md) (Elgato Key Light and LIFX over UDP, both fake-tested only; Focus mode darkens the lights; no Hue, Luxafor or Stream Deck plugin), [scheduled awake](docs/scheduled-awake.md) (asks before turning on or saving a schedule; no OS wake, and the macOS `pmset` reading was never run), [Fawkes rebirth](docs/fawkes-rebirth.md) (fed only by GitHub events; no skin-pack kind or speech), [team status and incoming webhooks](docs/team-status.md) (over the relay, tested on loopback only; no pairing flow), [YouTube Music and connectors](docs/youtube-music.md) (per-site opt-in and search URLs only; no player) and [browser profiles](docs/browser-profiles.md) (no browser engine, partition purge or extension sandbox; by default no extension can be installed). Not wired: the [mini browser policy engine](docs/mini-browser.md) (no browser exists; enforcement must be in Rust) and the [browsing assistant](docs/browsing-assistant.md) (needs a page reader, browser tools and an approval UI). The [`phoenix` CLI](docs/phoenix-cli.md) and [companion clients](docs/companion-clients.md) have no watch app or extension. Settings sections for some of these are in progress

## License

Phoenix is free software, licensed under the [GNU General Public License v3.0](LICENSE).
