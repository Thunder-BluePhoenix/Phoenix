# Proposal: Phoenix originals and the Phoenix browser

**Date:** 2026-10-15 · **Owner decision:** add all of it as phases (Stage 14, phases 76–92; Stage 15, phases 93–96).

Features neither Coucou nor Insomnia has, chosen because they fit Phoenix's thesis (an ambient, local-first operating layer for developers, with Fawkes as the interface) and reuse what Phoenix already has: the event bus, permission gateway, audit log, knowledge graph, capability SDK and desktop shell. The companion audit of Coucou and Insomnia is [coucou-insomnia-audit.md](coucou-insomnia-audit.md).

## Stage 14 — Phoenix originals

| #   | Phase                                                           | Why it belongs in Phoenix                                                                               |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 76  | MCP server & universal approval channel                         | Any MCP-capable agent gets Phoenix's context and its audited approval path, with no per-agent hook work |
| 77  | Agent safety net: checkpoints, rollback, loop & stall detection | Makes autonomy safer: every agent session can be undone; Fawkes notices when an agent is stuck          |
| 78  | Agent cost meter & mission control                              | One place for every agent session and what it costs, across agents and repos                            |
| 79  | Session handoff notes & secret guard                            | What an agent did and why travels with its commit; secrets never leave through an agent                 |
| 80  | Port & process radar                                            | The dev servers and processes you forgot, and stopping them with approval                               |
| 81  | Machine health & local model manager                            | Disk, memory, battery and heat in Fawkes; local models that fit your machine                            |
| 82  | Dependency advisories, flaky tests, build trends & config drift | Proactive engineering signals from data Phoenix already collects                                        |
| 83  | Calendar awareness & meeting prep                               | Reminders, one-click recording, prep notes from past decisions, deploy freezes                          |
| 84  | Standup & end-of-day digest                                     | Written from commits, agent sessions, meetings and CI                                                   |
| 85  | Focus mode & screenshot-to-issue                                | Quiet Fawkes on demand; a screen capture becomes an issue draft                                         |
| 86  | Approvals in Slack, Discord & Teams                             | Answer an agent from the chat tool you are already in                                                   |
| 87  | Remote access relay                                             | Phone and chat approvals beyond the home network, end-to-end encrypted                                  |
| 88  | Physical status lights & Stream Deck                            | Fawkes' state on a lamp (red while recording) and hardware buttons                                      |
| 89  | Apple Watch, browser extension & `phoenix` CLI                  | Approve from the wrist; Fawkes on PR pages; status and questions from a terminal                        |
| 90  | Scheduled awake windows & power-aware scheduling                | Overnight agent runs; heavy work waits for the charger; keep awake from the phone                       |
| 91  | Fawkes rebirth, milestones, skin packs & accessibility          | The phoenix rises when a failure is fixed; community skins; spoken states                               |
| 92  | Team status & incoming webhooks                                 | Opt-in shared status; any tool can drive Fawkes with a URL and a token                                  |

## Stage 15 — Phoenix browser

A small, private browser that belongs to Fawkes: Fawkes lives in it, can read and act on pages **with your approval**, and can play music.

### Design choices

- **Engine: the system webview** through Tauri (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux). Small, already in `apps/desktop`, updated by the OS. A bundled Chromium (CEF/Electron) would add hundreds of MB and its own update duty; revisit only if a needed feature is impossible on the system webviews.
- **Privacy like Brave, within what each webview allows:** a separate profile (never your main browser's cookies), ad and tracker blocking from public filter lists (EasyList/EasyPrivacy, GPL-3.0/CC BY-SA, compatible), HTTPS upgrade, third-party cookies off, no telemetry. On macOS blocking uses WebKit content rules; on Windows and Linux, request filtering (for example Brave's `adblock-rust`, MPL-2.0, GPL-compatible). Fingerprinting defences are limited to what the webview exposes; the phase records what is and is not possible rather than claiming Brave parity.
- **Fawkes acts only through the tool gateway.** Reading a page is a read; clicking, typing, submitting, downloading and logging in each need approval. **Web pages are untrusted data**: text in a page can never instruct Fawkes (Tech Spec §09 "untrusted content rule").
- **Music from YouTube, inside YouTube's rules.** Playback uses YouTube's official embedded player, which must stay **visible (at least 200 × 200)** and may not have its audio separated from the video; Phoenix shows it as a small mini player beside Fawkes. Ads on YouTube are not blocked (blocking them breaks YouTube's terms); the blocker exempts YouTube by default and says why.

### Phases

| #   | Phase                               | What it delivers                                                                                                                                                           |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 93  | Phoenix mini browser                | Tabs, address bar, private profile, ad/tracker blocking, HTTPS upgrade, downloads with approval, Fawkes in the corner of every tab                                         |
| 94  | YouTube music & site connectors     | "Fawkes, play some lo-fi": search and play in the mini player, queue, now playing in Fawkes (Phase 68), Fawkes dances; more connectors (SoundCloud, Bandcamp, Spotify Web) |
| 95  | Fawkes browsing assistant           | Summarise a page, answer questions about it, fill a form or click through a flow with approval at each side effect; prompt-injection tests                                 |
| 96  | Browser profiles, sync & extensions | Several profiles, bookmarks/history sync through Phoenix's encrypted sync (Phase 45), import from other browsers, a small extension API through capabilities               |
