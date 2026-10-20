# Phase 70 — Shortcuts, Languages & Demo Mode

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Global shortcuts (desktop, off by default), a command palette, a nine-language interface (all non-English text machine-generated and unreviewed) and an isolated demo Core built and tested with automated tests; no shortcut was pressed on a real keyboard, nothing ran in the packaged desktop app or on Linux/Windows, Arabic layout was not looked at, the CSP `connect-src` is wider than before for the demo; exit criteria met only as worded below |
| Depends on | [Phase 19 — Settings & Privacy Controls](phase-19-settings-and-privacy.md) |
| Unblocks | — |

## Goal

Global shortcuts, translations and a safe demo.

## Tasks — parity with Coucou

- [ ] Global shortcuts (open chat, jump to alert or terminal, switch pills, mute, send Fawkes to desktop, wardrobe), customisable. Built: `apps/desktop/src-tauri/src/shortcuts.rs` with seven actions registered through `tauri-plugin-global-shortcut` (loaded lazily, only when enabled and not under the mock runtime), customisable in Settings (`ShortcutSettings`, `apps/web/test/shortcut-settings.test.tsx`), tested by Rust unit tests (macOS, 303 passed) and lifecycle tests on the mock runtime, which has no hotkey API. **No shortcut was ever observed firing on a real keyboard**, and Linux and Windows were not run. Limits: "jump to terminal" only opens `/agents` (focusing a real terminal needs Core's focus-terminal route and a token the shell does not hold); "switch pills" only cycles three routes; mute silences the sound player and speech bubble when injected, but production entry points inject no sound player and nothing else is muted (island text, notification bell); Linux Wayland global hotkeys are not expected to work.
- [ ] 10 languages (English, Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Russian, Indonesian). The framework, a typed English source of about 2,600 keys, nine other locales that must be complete to compile, an ICU subset, `ui.locale` with `GET/POST /api/ui/settings`, lazy locale chunks and a language picker are built and tested (`apps/web/test/i18n*.test.tsx`, `core/runtime/test/ui-settings.test.ts`). Unticked because **all nine non-English locales are machine-generated and unreviewed**: no native speaker read any of them, so they must not be called supported (see [the i18n README](../../apps/web/src/i18n/README.md)).
- [x] Demo mode: scripted walkthrough that writes nothing and restores the real state. Built as an isolated second `PhoenixRuntime` (in-memory database, in-memory secret store, no token file, mock capability only) with a walkthrough over the existing scenarios and a "Demo - nothing is saved" banner; the web app switches its client to it and restores the real client and route on stop. Tests: `core/runtime/test/demo.test.ts` ("a full demo leaves no file, no keychain call, no real row and no real state change", "the demo token is rejected by the real Core and the real token by the demo Core") and `apps/web/test/demo.test.tsx` ("on stop switches back to the real client, removes the banner and restores the route"). Automated tests only: not run in the packaged desktop app or a real browser. The walkthrough has no automatic timeline (the person clicks through), and the floating window and pill do not switch to the demo.

## Tasks — Phoenix improvements

- [x] Command palette in the web app. `CommandPalette` (Cmd/Ctrl+K) over a command registry with in-app chords, a modal combobox with keyboard navigation, accent/Unicode-insensitive matching, and input-method composition handled. Tests: `apps/web/test/command-palette.test.tsx`, `shortcut-registry.test.ts`. Happy-dom tests only; not used in a real browser.
- [ ] Right-to-left layout for Arabic. Built: `lang` and `dir` are set at runtime (`dir=rtl` for Arabic), the CSS was converted to logical properties, and the palette and per-namespace pages render in Arabic in tests (`command-palette.test.tsx` "renders the palette in Arabic with dir=rtl and no raw message keys", the `i18n-*` render tests). Unticked: tests do not check how the layout looks, and the Arabic layout needs a human check in a real browser.
- [x] Demo mode reuses the mock capability scenarios. The walkthrough covers exactly the mock capability's scenarios, once each, in order, and each step calls its `simulate` command (`core/runtime/test/demo.test.ts` "covers exactly the mock capability's scenarios, once each, in order").

## Deliverables

- Shortcut manager: desktop (`shortcuts.rs`, menu entries for Wardrobe, the global-shortcuts toggle and mute) and web (command registry, palette, `ShortcutSettings`, mute consumer). Built; not exercised on a real keyboard.
- i18n framework + translations: built (`apps/web/src/i18n`, [README](../../apps/web/src/i18n/README.md)); translations unreviewed.
- Demo mode: built, see [demo-mode.md](../demo-mode.md).

## Exit criteria

- [x] Every UI string is translatable. Met **for the web app's TSX/TS UI code, per the scanner**: `apps/web/test/i18n-coverage.test.ts` fails on hard-coded JSX text and text attributes in any component (with an allow-list that carries a reason per entry; a mutation check shows a raw English string fails it). **Not covered**: text that comes from Core, capabilities or remote services (data) including capability names and descriptions; Rust/Tauri native menu and tray strings (English only); the static text of the four HTML entry pages; the error-string fallbacks in `core/hooks.ts`; labels of config-schema fields that are not known (the raw key is shown). "Translatable" here means a key exists in all ten locales, not that any non-English text was reviewed.
- [x] Demo mode leaves no file or keychain entry behind. Met **in an automated test, not in the packaged app**: `core/runtime/test/demo.test.ts` ("a full demo leaves no file, no keychain call, no real row and no real state change") checks that the demo's temporary data folder (made by `mkdtemp`) stays empty, that a keychain spy is called zero times, and that the real events, audit log, settings and notifications are unchanged. It was not run in the packaged desktop app or a real browser.

## Implementation notes

### What was built

- **Desktop shortcuts** (`apps/desktop/src-tauri/src/shortcuts.rs`): seven actions (`open_chat`, `jump_to_alert`, `jump_to_terminal`, `switch_pills`, `mute`, `send_to_desktop`, `wardrobe`); off by default; registration happens only when enabled. Validation fails closed: at least two modifiers; Ctrl+Alt or Alt+Shift with a single-character key is refused (AltGr and Option type symbols); platform-aware reserved lists; the dictation paste-again chord is refused; duplicates unbind both; a malformed `desktop.json` entry unbinds rather than falling back to a default. A registration failure for one action is reported without aborting startup. The native menu gained "Wardrobe", a global-shortcuts toggle and "Mute", and a lifecycle test shows the Wardrobe entry opening `/panel/wardrobe`. The Tauri commands `shortcuts_list`, `_set`, `_reset`, `_set_enabled` and `_set_muted` work only from the Fawkes and island windows, not the remote pill; the mute event `shortcuts://mute` goes only to those windows.
- **Web shortcuts and palette**: command registry, `CommandPalette` (Cmd/Ctrl+K), in-app chords (`Mod+K`, `Mod+Alt+Shift+1..9`), `ShortcutSettings`, and the mute consumer.
- **i18n** (`apps/web/src/i18n`, no dependency): nine namespaces (`common`, `shell`, `agents`, `automation`, `capture`, `memory`, `pet`, `services`, `settings`); a missing key in any locale is a compile error; an ICU subset (`{name}`, plural through `Intl.PluralRules`, `#`) with a small tested parser that never re-parses values; lazy locale chunks; `ui.locale` Core setting with `GET/POST /api/ui/settings` (ten codes, an unknown one is a 400); a pseudo-locale `en-XA` for tests and dev only.
- **Demo mode** ([demo-mode.md](../demo-mode.md)): the isolated runtime has an in-memory database, an in-memory secret store, no token file, only the mock capability, no agent relay, refusing fetch/git/terminal/installer/sync transports, a non-existent temporary data directory, its own token and an ephemeral loopback port. `POST /api/demo/start|stop` and `GET /api/demo/status`. It refuses to start while the real kill switch is engaged or a real call recording is active, stops a real voice assistant before switching, allows one demo at a time and stops itself after ten idle minutes. Tokens are rejected by the other Core.

### Decisions

- **CSP widened.** The web CSP `connect-src` is now `'self' http://127.0.0.1:* ws://127.0.0.1:*` (bare `ws:` and `wss:` were removed). That is narrower for WebSockets but **wider than before for `http://127.0.0.1:*`**, which the demo Core on another port needs. The alternative, proxying the demo through the real Core, was not done; it is an owner decision. The desktop's own Tauri CSP already allowed `http://127.0.0.1:*` and was not changed.
- The demo token is handed to the holder of the real session token. This is acceptable only because the demo runtime is isolated and in memory, and the demo Core stays reachable by any local process that learns its token until it stops or idles out.
- English is the source of truth; brand and outfit names in the other locales are guesses.

### Security fix that came from review

A review found that `shortcuts_list` locked a non-reentrant mutex twice, which would hang the main thread on the first call; fixed.

What was not done or not run: any shortcut pressed on a real keyboard; Linux and Windows desktop builds (macOS only this round; the Windows/Linux reserved-key tables are unit-tested on macOS only); terminal focus; a real "next pill"; review of any translation by a native speaker; plural categories for Russian and Arabic were supplied but not individually reviewed; keys whose translation equals the English text were not audited; Arabic layout in a real browser; the demo in the packaged app; translation of native menus, the HTML entry pages and Core/capability text. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
