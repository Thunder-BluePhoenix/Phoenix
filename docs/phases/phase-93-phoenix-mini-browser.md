# Phase 93 — Phoenix Mini Browser

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Only a TypeScript policy engine exists (80 tests). **No browser exists:** no webview, tabs, address bar or `MiniBrowser.tsx`, and no Rust or Tauri change. It was reviewed again after the Phases 86-96 wiring and not wired: a policy running in page JavaScript would protect nothing, so enforcement must be in Rust. Neither exit criterion is met |
| Depends on | [Phase 14 — Floating Desktop Fawkes](phase-14-floating-desktop-fawkes.md) |
| Unblocks | [Phase 94 — YouTube Music & Site Connectors](phase-94-youtube-music-and-site-connectors.md), [Phase 95 — Fawkes Browsing Assistant](phase-95-fawkes-browsing-assistant.md), [Phase 96 — Browser Profiles, Sync & Extensions](phase-96-browser-profiles-sync-extensions.md) |

## Goal

A small, private browser that belongs to Fawkes.

## Tasks

- [ ] Window in apps/desktop on the system webview (WKWebView / WebView2 / WebKitGTK): tabs, address bar, back/forward, reload, find, zoom. **Not built.** No webview, tabs, address bar or `MiniBrowser.tsx`.
- [ ] Separate profile, never the user's main browser cookies; private windows. Only an in-memory profile model exists in the policy engine. No browser uses it.
- [ ] Ad and tracker blocking from EasyList/EasyPrivacy (WebKit content rules on macOS, request filtering elsewhere), per-site toggle, blocked count. An adblock-syntax subset matcher with a **small starter list (not EasyList)** is built, and so are the user-triggered filter-list updater in Core (EasyList and EasyPrivacy, off until downloaded and switched on), a per-site off-list, a global switch, a per-site blocked counter and a Settings card ([filter-lists.md](../filter-lists.md)). None of it blocks anything in a real page: there is no browser window, so the blocked count is always 0 outside tests, and cosmetic rules are ignored.
- [ ] HTTPS upgrade, third-party cookies off, no telemetry. The http → https upgrade is in the navigation policy; permissions are default-deny. Nothing enforces this in a real browser.
- [ ] Downloads ask first and go to a chosen folder. Not built.
- [ ] Fawkes in the corner of every tab (state, approvals). Not built.
- [ ] Document what fingerprinting protection each webview can and cannot do. Not done.

## Deliverables

- `apps/web/src/core/browser`: navigation policy, adblock matcher with a starter list, default-deny permissions, in-memory profile. Built as TypeScript only; simulated evidence. See [mini-browser.md](../mini-browser.md), which lists the Rust, Cargo and capability changes still to be made.
- `core/runtime/src/filter-lists/`, `apps/web/src/core/browser/shields.ts`, `apps/web/src/components/ShieldsSettings.tsx`: the filter-list updater (one GET per press of Update, pinned hosts), stored lists, shields settings and counts. Tests never contact easylist.to. See [filter-lists.md](../filter-lists.md).
- Not built: the browser window, applying a list to any real page, cosmetic filtering, scheduled list refresh.
- `apps/web/src/browser/`, `apps/web/browser.html` (Vite entry `browser`), `apps/web/test/browser-chrome.test.tsx`: the browser **chrome page** (tab strip, address bar with `classifyAddress`, back/forward/reload, zoom, per-site Shields toggle and blocked count, confirmation panel before a port-radar loopback open) behind one typed bridge, `shell.ts`, with a fake shell for tests. 25 tests against the fake shell; **nothing ran in a real window or webview**, and the content webviews and enforcement are the Rust side's job. See [mini-browser.md](../mini-browser.md#chrome-ui-appswebsrcbrowser-vite-entry-browser).

## Exit criteria

- [ ] Browsing works on macOS; blocking measured on a test page. **Unmet.** There is no browser.
- [ ] Browser data is separate from the main browser. **Unmet.** No browser stores any data; only an in-memory profile model exists.

## Implementation notes

### What was built

- **Navigation policy:** `file:` and internal schemes refused; credentials in a URL refused; private-network targets refused, including obfuscated IPv4 and IPv4-in-IPv6, except a typed URL to an explicitly listed site; bad ports refused; http upgraded to https.
- **Adblock matcher:** a subset of adblock syntax with a small starter list (not EasyList), now regex-free and capped so a hostile list cannot make it slow.
- **Filter-list updater, shields, blocked count:** built as Core routes, settings and pure TypeScript; honest simulation with a loopback fake list server in tests. Nothing is downloaded automatically and nothing is blocked in a real page.
- **Permissions:** default-deny. **Profile:** in memory only.
- 80 tests. Documentation: [mini-browser.md](../mini-browser.md).

### Deviations

- The phase asked for a browser window; only the policy engine exists. EasyList/EasyPrivacy are not bundled: they can be downloaded by the user through the updater, and no browser window applies them. Cosmetic filtering is not implemented.

### What was not built

The webview, tabs, address bar, `MiniBrowser.tsx`, any Rust or Tauri change, downloads, native blocking. **DNS rebinding cannot be handled in TypeScript** and needs Rust enforcement. The blocked count is always 0 outside tests; the filter-list updater downloads lists but nothing applies them to a page.

### What was not run

Any browsing. [mini-browser.md](../mini-browser.md) lists the Rust, Cargo and capability changes that must be made. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Filter lists keep their licences (GPL-3.0/CC BY-SA) in the inventory.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
