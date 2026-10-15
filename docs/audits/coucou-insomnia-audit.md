# Audit: Coucou and Insomnia features for Phoenix

> Follow-up: features beyond Coucou and Insomnia, and the Phoenix browser, are in [phoenix-originals-and-browser.md](phoenix-originals-and-browser.md) (phases 76–96).

**Date:** 2026-10-15 · **Audited:** Coucou `a95d309` (macOS 0.4.0, Windows/Linux 0.5.0, Android 0.2.0) and Insomnia `b6a7499` · **Phoenix baseline:** `a987d53`

Goal (owner decision, 2026-10-15): bring **every** Coucou and Insomnia feature into Phoenix, with Phoenix's **own assets**, and go further than both where Phoenix's platform allows ("and more and updated"). Each feature is mapped to what Phoenix has today and to a new phase (56–75, [tracker](../phases/TRACKER.md)); each phase file lists the Coucou/Insomnia parity items and then the **Phoenix improvements** on top.

## 1. What the two projects are

|              | Coucou                                                                                                                                                                                                    | Insomnia                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| What         | A pet ("Mochi") that lives in the Mac notch or the top edge of the screen and watches AI coding agents: approvals, questions, live diffs, chat, dictation, a notetaker, service "pills", phone companions | A macOS menu-bar app for **timed keep-awake sessions**, including with the lid closed, with recovery if anything goes wrong |
| Platforms    | macOS (Swift/SwiftUI, no deps), Windows + Linux (Tauri 2: Rust + TS, same stack as `apps/desktop`), iPhone, Android (Kotlin), a Cloudflare relay                                                          | macOS 26+, Apple silicon only (Swift 6.2, ~16k lines, 50 test files)                                                        |
| Code licence | MIT                                                                                                                                                                                                       | MIT                                                                                                                         |
| Assets       | **Not open.** The names "Coucou" and "Mochi", the Mochi character, icons, sounds and media are © Louis Raillé ([LICENSE-ASSETS.md](https://github.com/Louis-CFM/coucou/blob/main/LICENSE-ASSETS.md))      | Eye icon/brand: normal MIT repo, but we use our own anyway                                                                  |

## 2. Licensing and identity rules for this work

1. **Code:** both are MIT, which is GPL-3.0 compatible. Phoenix may port code, but any file that copies or closely translates their code keeps the MIT copyright notice and is listed in `docs/licenses/INVENTORY.md` and `THIRD_PARTY_NOTICES.md`. Preferred: reimplement from behaviour (this audit and their docs), which needs no notice.
2. **Assets:** nothing from Coucou's asset list may enter Phoenix: no Mochi design, poses, expressions as a character, sounds, icons or media. This matches PRD v2.0 §25 ("Do not copy proprietary Codex Pets or Coucou character assets"). Every Fawkes outfit, emote and sound is original and CC BY-SA 4.0 (ADR-0018).
3. **Names:** features are renamed for Phoenix ("OK Fawkes", "Fawkes island", "Flow" → "Dictation").

## 3. Phoenix principles that shape the port

These come from the vision documents and change how some features are built:

- **Sensitive actions need explicit approval; voice can never approve** (Coucou already enforces this for its voice feature; Phoenix makes it a rule for every new input path).
- **No silent recording** (Fawkes PRD §9.3): the notetaker and dictation show a visible indicator the whole time and are off by default.
- **Capabilities are the boundary** (ADR-0003): service pills, media pills and power control become capabilities with manifests and permissions, not hard-coded features.
- **Local-first, no telemetry**; external AI is opt-in per purpose (Phase 29 gate).
- **Core survives any capability failure**; a hook must never block an agent when Phoenix is down (Coucou's rule too: "Claude Code is never blocked").
- **Phoenix does not get unrestricted shell or root by default.** Insomnia's lid-closed mode needs root (`pmset disablesleep`); in Phoenix that is a separate, opt-in, user-installed privileged helper (§6, Phase 73).

## 4. Coucou feature map

Legend for **Phoenix today:** ✅ has it · 🟨 partly · ⬜ missing. **Verdict:** Adopt (build as is), Adapt (build the Phoenix way), Exclude, or Decision (needs an owner call).

### 4.1 Agents (Coucou's core)

| Coucou feature                                                                                                                                        | Phoenix today                                                                                             | Verdict                                                                                                           | Phase  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| Live sessions for Claude Code, Codex, Cursor, Gemini CLI, Antigravity, Copilot CLI, Muse Code, OpenCode, Amp, Hermes, Claude Desktop                  | 🟨 Claude Code observe-only hook (Phase 25), session list (`AgentSessions.tsx`), orchestration (Phase 34) | Adapt: one relay for all agents, per-agent identity                                                               | 57     |
| Generic agents via `--agent <name>` / `coucou_agent` field                                                                                            | ⬜                                                                                                        | Adopt as `phoenix_agent` field + `--agent` flag                                                                   | 57     |
| Hook installer that backs up `settings.json` and shows the diff before writing                                                                        | ⬜ (manual setup docs)                                                                                    | Adopt                                                                                                             | 57     |
| **Approve from the pet: Allow / Deny / Always** for Claude Code `PermissionRequest` (hook waits; timeout = decision timeout + 10 s); Codex Allow/Deny | ⬜ hook is observe-only; Phoenix approval UI exists for its _own_ capabilities (Phase 11/32)              | Adapt: blocking hook → Phoenix approval card (web, Pet Panel, desktop) → hook answer; fail-open when Core is down | **56** |
| **Answer `AskUserQuestion`** (single/multi-select, up to 4 questions) or "Reply in terminal"                                                          | ⬜                                                                                                        | Adopt                                                                                                             | **56** |
| Step ticker: what the agent reads, edits, runs                                                                                                        | 🟨 events exist; no live ticker                                                                           | Adopt                                                                                                             | 58     |
| Live diffs: file name, +N −M, tap for full diff                                                                                                       | ⬜                                                                                                        | Adopt                                                                                                             | 58     |
| Jump to the session's terminal window (macOS)                                                                                                         | ⬜                                                                                                        | Adapt (macOS first; Linux/Windows best effort)                                                                    | 58     |
| "Finished" happy jump                                                                                                                                 | 🟨 SUCCESS celebration exists                                                                             | Adopt (per-agent)                                                                                                 | 59     |
| Claude plan usage (5 h / weekly) via a `statusLine` relay that chains the user's previous status line                                                 | ⬜                                                                                                        | Adopt                                                                                                             | 58     |
| Codex plan usage and free resets, read from the Codex CLI                                                                                             | ⬜                                                                                                        | Adopt                                                                                                             | 58     |
| Third-party approvals (Coucou: not yet)                                                                                                               | ⬜                                                                                                        | Adopt in 56 for any agent whose hook protocol supports a decision                                                 | 56     |

### 4.2 The character

| Coucou feature                                                               | Phoenix today                                                                     | Verdict                                                                                    | Phase |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| Idle breathing, blinks, greeting on launch                                   | ✅ breathing/blinks (Phase 10); ⬜ greeting                                       | Adopt greeting                                                                             | 59    |
| Eyes follow the cursor (on a sphere)                                         | ⬜                                                                                | Adopt (original geometry)                                                                  | 59    |
| Hover: blinks, eyes grow; click: squish + annoyed; 3 fast clicks: dizzy      | ⬜                                                                                | Adopt (original animations)                                                                | 59    |
| Emotes with real triggers                                                    | 🟨 state animations only                                                          | Adopt                                                                                      | 59    |
| 28 sounds; user-replaceable sounds folder; mute                              | ⬜ no sound at all                                                                | Adapt: **original** sound set (CC BY-SA), off by default, replaceable, respects quiet mode | 59    |
| Wardrobe + seasonal outfits                                                  | ⬜                                                                                | Adapt: original outfits                                                                    | 61    |
| A colour / mini character per agent and per service                          | ⬜                                                                                | Adopt (mini-Fawkes per source)                                                             | 61    |
| Pet on the desktop, follows cursor, flies home on alerts, remembers position | ✅ floating desktop Fawkes (Phase 14), position saved; ⬜ follow-cursor, fly-home | Adopt the missing behaviours                                                               | 59/60 |

### 4.3 Where the pet lives

| Coucou feature                                                                                   | Phoenix today                               | Verdict                                              | Phase |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------- | ----- |
| Notch island (macOS) / top-edge island (Windows, Linux) with states hidden → small → expanded    | ⬜ (floating window + navbar only)          | Adopt as an optional "island" mode of `apps/desktop` | 60    |
| Invisible when idle, peeks on hover                                                              | ⬜                                          | Adopt                                                | 60    |
| Any display: pick screen or follow mouse; works without a notch                                  | 🟨 multi-monitor placement code, unverified | Adopt                                                | 60    |
| Linux: gtk-layer-shell on wlroots/KDE/COSMIC, XWayland dock on GNOME; click-through input region | ⬜ Linux not built (Phase 14 gap)           | Adopt (closes the Phase 14 Linux gap too)            | 60    |
| "The pill": see-through toolbar at a screen edge (dictate, record, open app)                     | ⬜                                          | Adopt with 64/65                                     | 64    |
| An app window with pages (Coucou 0.4 "hub")                                                      | ✅ web app + Settings                       | Already covered                                      | —     |

### 4.4 Chat and context

| Coucou feature                                                                                 | Phoenix today                                                                   | Verdict                                                                                                        | Phase |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----- |
| Chat with Claude                                                                               | ✅ Chat (Phase 32) via model router; Anthropic adapter never contacted for real | Already                                                                                                        | —     |
| Gemini, OpenAI, DeepSeek, Qwen, Moonshot, LM Studio, Ollama; model switcher above the chat box | 🟨 Anthropic + Ollama only                                                      | Adopt: one OpenAI-compatible adapter (OpenAI, DeepSeek, Qwen, Moonshot, LM Studio) + Gemini adapter + switcher | 63    |
| Drop a file on the pet → ask about it / email it                                               | ⬜                                                                              | Adapt: ask about it (local or opted-in AI); email only as a draft the user sends                               | 62    |
| Drag the pet onto a window → attach it as context (macOS)                                      | ⬜                                                                              | Adopt (macOS Accessibility; explicit per use)                                                                  | 62    |
| Dictate in the chat box                                                                        | 🟨 Phase 54 local speech adapters, unverified                                   | Adopt                                                                                                          | 64    |

### 4.5 Voice and meetings

| Coucou feature                                                                                                                                                          | Phoenix today                                                           | Verdict                                                                                                                                                   | Phase |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Flow dictation**: hold a key anywhere, speak, release → text pasted in the front app; tap twice for hands-free; Esc cancels; paste-again shortcut; clipboard restored | ⬜                                                                      | Adopt (desktop shell: global hotkey, paste, clipboard restore)                                                                                            | 64    |
| Offline recognition (Parakeet via FluidAudio / OS speech)                                                                                                               | 🟨 Phase 54 local speech adapter                                        | Adapt: local engine (whisper.cpp or Parakeet where available), nothing leaves the machine                                                                 | 64    |
| Dictionary, replacements, snippets; optional AI clean-up per app (as said / natural / polished)                                                                         | ⬜                                                                      | Adopt (AI clean-up = opted-in AI purpose)                                                                                                                 | 64    |
| Dictation statistics (words, time saved, WPM, streak, apps)                                                                                                             | ⬜                                                                      | Adopt (local only)                                                                                                                                        | 64    |
| **Notetaker**: record mic + system audio, no bot in the call; transcript per person, summary, key points, to-dos; audio deleted after                                   | 🟨 Kage pipeline (bot-based capture), decisions/action items (Phase 35) | Adapt: local capture feeding the existing meeting pipeline (Kage upload or local transcription), visible RECORDING, consent reminder, audio deleted after | 65    |
| « OK Coucou » hands-free assistant: wake word, local recognition, actions, spoken answers; never approves by voice; off by default; < 1 % CPU idle                      | 🟨 Phase 54 (speech/vision adapters, Fawkes voice unverified)           | Adapt as « OK Fawkes » through the tool gateway; voice may deny, never approve                                                                            | 66    |

### 4.6 Integrations ("pills")

| Coucou feature                                                                         | Phoenix today                                   | Verdict                                                                                                                                                                   | Phase |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| GitHub: PRs, reviews requested, CI, contribution grid                                  | ✅ GitHub/CI capability (Phase 22), issues (26) | Already (contribution grid: add in 69)                                                                                                                                    | —     |
| Vercel deployments, Stripe payments, n8n workflows, Resend emails, Notion, Cal.com     | ⬜ (Frappe, Docker, Linear/Jira exist)          | Adopt as read-only capabilities; any write (re-run, redeploy, pause) behind approval; **nothing that moves money or sends email**                                         | 67    |
| Apple Music / Spotify now playing + controls, pet dances                               | ⬜                                              | Adopt as an optional capability (owner decision)                                                                                                                          | 68    |
| **Crypto portfolio** (16 chains, 5 exchanges): balances, 7-day sparklines, 24 h change | ⬜                                              | Adopt (owner decision) as an optional, **read-only** capability: public addresses and read-only exchange keys only, keys in the OS keychain, no trading or transfers ever | 68    |
| "Active pills": choose which tools appear                                              | 🟨 capability enable/disable (Phase 19)         | Adapt: per-capability "show in Fawkes" toggle                                                                                                                             | 61    |

### 4.7 Everything else

| Coucou feature                                                                                                          | Phoenix today                                       | Verdict                                                               | Phase |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- | ----- |
| Weekly recap (time coding, sessions, files, lines, commands, permissions, top agent/project, busiest day) + share image | 🟨 event history + knowledge graph                  | Adopt (local only)                                                    | 69    |
| Global keyboard shortcuts, customisable                                                                                 | ⬜                                                  | Adopt (desktop shell)                                                 | 70    |
| 10 languages                                                                                                            | ⬜ English only                                     | Adopt (i18n framework first, then translations)                       | 70    |
| Demo mode: scripted walkthrough, nothing written to disk                                                                | 🟨 mock capability scenarios (dev only)             | Adopt as a user-facing demo that writes nothing                       | 70    |
| iPhone app: Live Activities, Dynamic Island, widgets, Siri, approvals with Face ID, CloudKit sync                       | 🟨 Phase 45 encrypted staged-record sync (no relay) | Adopt (owner decision): Core phone link first, then native iPhone app | 71    |
| Android app + LAN phone link (pairing code, pinned TLS, approvals bound to the exact request)                           | ⬜                                                  | Adopt (owner decision): phone link in Core, then native Android app   | 71    |
| Keys in OS keychain / Credential Manager / Secret Service                                                               | ✅ macOS + Linux (Phase 15); ⬜ Windows             | Adopt Windows Credential Manager                                      | 60    |
| No telemetry, no account                                                                                                | ✅                                                  | Already                                                               | —     |

## 5. Insomnia feature map

Insomnia is a single capability for Phoenix: **keep the computer awake for a bounded time, safely**. It matters to Phoenix because long agent runs, CI watching and meeting processing die when the laptop sleeps.

| Insomnia feature                                                                                                                                         | Phoenix today                                          | Verdict                                                                                                                       | Phase |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----- |
| Timed session (days/hours/minutes) is the only way to stay awake; add time; hold-to-end; countdown in the menu bar                                       | ⬜                                                     | Adopt: `awake` capability + Fawkes/tray countdown                                                                             | 72    |
| Keep awake with the lid **open**                                                                                                                         | ⬜                                                     | Adopt without root: `caffeinate` (macOS), `systemd-inhibit` (Linux), `SetThreadExecutionState` (Windows)                      | 72    |
| Keep awake with the lid **closed** (`pmset -a disablesleep 1` via a sudoers rule)                                                                        | ⬜                                                     | Adopt (owner decision) with an opt-in privileged helper the user installs and reviews; Phoenix's own runtime never holds root | 73    |
| Recovery journal written before every change; reconcile at launch; launchd backstop every minute; recovery lock                                          | ⬜                                                     | Adopt (required before any 72/73 change ships)                                                                                | 73    |
| Battery floors (Low Power Mode below 40 %, end below 10 %) and heat rules (Low Power at serious, end at critical)                                        | ⬜                                                     | Adopt (end-session rules need no root; Low Power Mode needs the helper)                                                       | 72/73 |
| Lid observer                                                                                                                                             | ⬜                                                     | Adopt                                                                                                                         | 73    |
| Lid close: display + keyboard light off with brightness saved/restored                                                                                   | ⬜                                                     | Adopt (macOS)                                                                                                                 | 74    |
| Lid close: freeze listed apps with `SIGSTOP` (Slack, WhatsApp, Discord), skip meeting/recording/dictation apps, only unfreeze what it can prove it froze | ⬜                                                     | Adopt with the same proof-of-ownership rule; protected list includes Phoenix, terminals, editors, agents                      | 74    |
| Lid close: mute audio per output, restore on open even after switching outputs                                                                           | ⬜                                                     | Adopt                                                                                                                         | 74    |
| Lid close: freeze Docker Desktop when no container runs (off by default)                                                                                 | 🟨 Docker capability can tell if containers run        | Adopt                                                                                                                         | 74    |
| Turn App Nap off for agent apps (opt-in, journalled `defaults` writes)                                                                                   | ⬜                                                     | Adopt                                                                                                                         | 74    |
| Chromium/Arc/Comet throttling check, offer "relaunch unthrottled" (asks first)                                                                           | ⬜                                                     | Adopt                                                                                                                         | 75    |
| Wi-Fi drop → join iPhone hotspot (password in Keychain; needs Location permission)                                                                       | ⬜                                                     | Adopt (opt-in)                                                                                                                | 75    |
| No network for 90 s → type `continue` into tmux panes the user marked (`@insomnia-nudge on`)                                                             | 🟨 agent orchestration (Phase 34) knows agent sessions | Adapt: "nudge" for marked tmux panes, tied to Phoenix agent sessions; Enter off by default                                    | 75    |
| Owner-only config and logs; log privacy                                                                                                                  | ✅ Phoenix data dir; redaction everywhere              | Already (extend to new logs)                                                                                                  | —     |
| Quit refuses while something still needs undoing                                                                                                         | ⬜                                                     | Adopt                                                                                                                         | 73    |
| Install/uninstall scripts, nightly + stable channels, release validation                                                                                 | 🟨 Phase 20/43 release docs                            | Adapt into Phoenix packaging                                                                                                  | 73    |

## 6. Risks and how the plan handles them

| Risk                                                                                                                           | Handling                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crypto and exchange data                                                                                                       | Read-only by construction: public addresses, read-only API keys rejected if they carry trade/withdraw scopes where the exchange reports them, keys only in the OS keychain, no order or transfer endpoints in the code at all.                        |
| Root access for lid-closed sleep (Insomnia's sudoers rule lets **any** program running as the user run those `pmset` commands) | Phase 73 is opt-in. The helper exposes only "disable sleep on/off" and "low power on/off", is installed by the user from a reviewed script, and Phoenix's own runtime never holds root. Lid-open keep-awake (Phase 72) needs no root and ships first. |
| Overheating in a bag                                                                                                           | Insomnia's own warning applies; Phases 72/73 keep thermal and battery end rules **on by default** and show the warning before the first lid-closed session.                                                                                           |
| Freezing processes (`SIGSTOP`)                                                                                                 | Proof-of-ownership journal; never freeze Phoenix, terminals, editors, agents, meeting or dictation apps; unfreeze on every exit path; backstop.                                                                                                       |
| Blocking agent hooks                                                                                                           | Approval hooks fail open (agent asks in its terminal) when Core is unreachable, slow or the request times out; never block more than the agent's own timeout.                                                                                         |
| Voice and dictation privacy                                                                                                    | Off by default; local recognition only unless the user opts into an AI purpose; audio never written to disk except the notetaker's, which is deleted after transcription; recording indicator always visible.                                         |
| Scope: Coucou is a whole product family, and the owner wants all of it plus improvements                                       | Phases are ordered by value to Phoenix's thesis (agents first, then voice/meetings, then polish, then mobile). Each phase is shippable on its own.                                                                                                    |
| Asset/brand leakage                                                                                                            | Owner decision: Phoenix ships its own assets. Review checklist item on every PR in this track: no Coucou/Mochi assets, names or sounds; licence inventory updated.                                                                                    |

## 7. Proposed phases

Two new stages in the [tracker](../phases/TRACKER.md). Order within a stage is the recommended build order. Every phase lists **parity** items (what Coucou/Insomnia do) and **Phoenix improvements** (what Phoenix adds).

**Stage 12 — Coucou parity and beyond**

| #   | Phase                                                                                                             | Priority |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------- |
| 56  | [Agent approvals & questions from Fawkes](../phases/phase-56-agent-approvals-from-fawkes.md)                      | Critical |
| 57  | [Universal agent relay & hook installers](../phases/phase-57-agent-relay-and-installers.md)                       | High     |
| 58  | [Live agent sessions, diffs & plan usage](../phases/phase-58-live-sessions-diffs-plan-usage.md)                   | High     |
| 59  | [Fawkes interactions, emotes & sounds](../phases/phase-59-fawkes-interactions-and-sounds.md)                      | Medium   |
| 60  | [Fawkes island (notch / top edge) & desktop platforms](../phases/phase-60-fawkes-island.md)                       | Medium   |
| 61  | [Wardrobe, per-source Fawkes & visible capabilities](../phases/phase-61-wardrobe-and-per-source-fawkes.md)        | Low      |
| 62  | [Drop files & attach windows as context](../phases/phase-62-file-drop-and-window-context.md)                      | Medium   |
| 63  | [More AI providers & model switcher](../phases/phase-63-more-ai-providers.md)                                     | Medium   |
| 64  | [Dictation anywhere](../phases/phase-64-dictation-anywhere.md)                                                    | High     |
| 65  | [Botless notetaker](../phases/phase-65-botless-notetaker.md)                                                      | High     |
| 66  | [« OK Fawkes » voice assistant](../phases/phase-66-ok-fawkes-voice-assistant.md)                                  | Medium   |
| 67  | [Service integrations (Vercel, Stripe, n8n, Resend, Notion, Cal.com)](../phases/phase-67-service-integrations.md) | Medium   |
| 68  | [Media & portfolio capabilities](../phases/phase-68-media-and-portfolio.md)                                       | Low      |
| 69  | [Weekly recap & statistics](../phases/phase-69-weekly-recap.md)                                                   | Low      |
| 70  | [Shortcuts, languages & demo mode](../phases/phase-70-shortcuts-i18n-demo.md)                                     | Low      |
| 71  | [Phone link & mobile companions](../phases/phase-71-phone-link-and-mobile.md)                                     | Medium   |

**Stage 13 — Insomnia parity and beyond (keep awake)**

| #   | Phase                                                                                                               | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| 72  | [Keep-awake sessions (no root)](../phases/phase-72-keep-awake-sessions.md)                                          | High     |
| 73  | [Lid-closed mode, recovery & power floors](../phases/phase-73-lid-closed-mode-and-recovery.md)                      | High     |
| 74  | [Lid-close actions](../phases/phase-74-lid-close-actions.md)                                                        | Medium   |
| 75  | [Agent continuity: network failover, tmux nudge, browser throttling](../phases/phase-75-agent-continuity-extras.md) | Low      |

## 8. Owner decisions (2026-10-15)

| Question              | Decision                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Assets                | Phoenix uses its **own** assets (Fawkes, outfits, sounds, icons); nothing from Coucou's asset list |
| Scope                 | **All** Coucou and Insomnia features, plus Phoenix improvements                                    |
| Crypto portfolio      | In, as a read-only capability (Phase 68)                                                           |
| Spotify / Apple Music | In, as an optional capability (Phase 68)                                                           |
| Phone apps            | In: Core phone link, then iPhone and Android apps (Phase 71)                                       |
| Lid-closed mode       | In, through an opt-in privileged helper the user installs (Phase 73)                               |

Still open (defaults chosen, change if you disagree): sounds are **off by default** (Phase 59); notetaker and dictation are **off by default** (Phases 64–65); thermal and battery end rules are **on by default** (Phases 72–73).
