# Phase 93 — Phoenix Mini Browser

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 14 — Floating Desktop Fawkes](phase-14-floating-desktop-fawkes.md) |
| Unblocks | [Phase 94 — YouTube Music & Site Connectors](phase-94-youtube-music-and-site-connectors.md), [Phase 95 — Fawkes Browsing Assistant](phase-95-fawkes-browsing-assistant.md), [Phase 96 — Browser Profiles, Sync & Extensions](phase-96-browser-profiles-sync-extensions.md) |

## Goal

A small, private browser that belongs to Fawkes.

## Tasks

- [ ] Window in apps/desktop on the system webview (WKWebView / WebView2 / WebKitGTK): tabs, address bar, back/forward, reload, find, zoom
- [ ] Separate profile, never the user's main browser cookies; private windows
- [ ] Ad and tracker blocking from EasyList/EasyPrivacy (WebKit content rules on macOS, request filtering elsewhere), per-site toggle, blocked count
- [ ] HTTPS upgrade, third-party cookies off, no telemetry
- [ ] Downloads ask first and go to a chosen folder
- [ ] Fawkes in the corner of every tab (state, approvals)
- [ ] Document what fingerprinting protection each webview can and cannot do

## Deliverables

- apps/desktop browser window
- Filter-list updater

## Exit criteria

- [ ] Browsing works on macOS; blocking measured on a test page
- [ ] Browser data is separate from the main browser

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Filter lists keep their licences (GPL-3.0/CC BY-SA) in the inventory.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
