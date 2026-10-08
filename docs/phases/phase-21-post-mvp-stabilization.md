# Phase 21 — Post-MVP Stabilisation

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | Critical |
| Status | 🟨 In progress |
| Depends on | [Phase 20 — Hardening, E2E, Observability & v0.1 Release](phase-20-hardening-and-v0-1-release.md) |
| Unblocks | [Phase 22 — GitHub & CI/CD Capability](phase-22-github-and-cicd-capability.md), [Phase 23 — Frappe / ERPNext Capability](phase-23-frappe-erpnext-capability.md), [Phase 24 — Docker & Editor Capabilities](phase-24-docker-and-editor-capabilities.md), [Phase 25 — Coding-Agent Lifecycle Events](phase-25-coding-agent-lifecycle-events.md) |

## Goal

Harden the MVP based on real usage before adding breadth (90-day plan, weeks 1–2).

## Scope

**In scope**

- Bug fixing
- State-machine hardening
- Opt-in telemetry/feedback loop
- Desktop + settings polish

**Out of scope**

- New integrations

## Tasks

- [ ] Triage and fix MVP bugs from early users (no early-user reports exist yet)
- [x] Add regression tests for every fixed state-engine bug (no state-engine bug has been found; `core/runtime/test/robustness.test.ts` throws 4,500 hostile events at the runtime over 3 seeds and one of them reproduces the Phase 20 crash)
- [ ] Opt-in, documented telemetry + feedback channel (blocked on a decision: the README promises "no telemetry", so what is sent and where it goes must be chosen by the project)
- [ ] Polish floating Fawkes and settings (90-day plan weeks 5–6)
- [ ] Tune notification noise defaults (partly done, see notes)

## Deliverables

- v0.1.x patch releases

## Exit criteria

- [ ] Core event/state/pet loop stable (gate MVP → v0.2)

## Notes & risks

- Metrics never justify weakening privacy or safety.
- This phase was started before Phase 20 closed (packaging, signing and the release tag are still open), only on items that need no decision and no new integration. The stage gate in the tracker still applies to everything else.
- Notification noise, measured by replaying the demo scenarios and synthetic bursts through the real service with the default preferences (warnings and errors, 30 s duplicate window):
  - The 9 demo scenarios produce 0 or 1 notification each; builds, tests, deploys and agent runs that succeed are silent. The defaults were not changed, since there is no real usage to tune them against.
  - A failure that kept repeating re-alerted every 30 s (a build retried every 10 s for 10 minutes gave 20 alerts). The quiet period now slides: it notifies once and stays quiet until the problem has stopped for 30 s (1 alert). Distinct problems still each notify (40 different failing commands: 40).
  - Not changed: a capability that flaps with a period over 30 s (down 20 s, up 20 s, repeatedly) still notifies on every outage, 90 alerts in an hour. Each outage is a separate event outside the window. Folding those would need a rule about how many outages count as "the same problem", which is a product decision.
  - A problem that returns every 2 minutes also notifies each time (20 over 40 minutes).

- Accessibility audit of the web app in a real browser (headless Chrome against a running Core with errors, a recording, merge conflicts and meetings in many states), both colour schemes, 14 views including the Pet Panel and the notification bell:
  - Found and fixed: text in red, amber, green, blue and orange was below WCAG AA's 4.5:1 in places (as low as 2.36:1 for amber warning badges, 3.27:1 for "Ready"; the white-on-orange primary buttons were 3.58:1; red text on the dark theme was 3.61:1). Text now uses separate `--*-text` variables and the filled primary button uses `--accent-fill`; the original colours stay for borders, dots and rings. After the change, 470 text nodes across the 14 views all pass, lowest 4.51:1.
  - Found and fixed: the "Recording is active" banner's red dot rendered at 0 px wide (an inline element ignores width and height), so that banner had no non-text recording marker. It now draws at 8×8, as the other two recording dots already did.
  - Amber used for borders was 2.36:1 against the light page (WCAG asks 3:1 for non-text UI); the light theme now uses a darker amber for borders. The dark theme keeps the brighter one.
  - Checked and fine: all 44 controls on the Settings page have an accessible name (the first scan reported 17 unlabelled controls because the capability sections are collapsed and my scan read them before they were opened), landmarks, heading order, one `lang`, no images without alt, no text under 11 px, no console errors. Tab reaches every control (the two it skips are radio buttons in a group, one tab stop by design) and every focused control showed an outline or ring.
  - New test `core/runtime/test/web-contrast.test.ts` reads the stylesheets and checks every text, fill and border pair in both themes, plus that no rule uses a raw `color: var(--danger)`-style colour for text. I put each original colour back and confirmed the test fails for it.
  - Not covered: the Fawkes artwork itself (its colours live in `pet/` and are drawn, not text), the speech bubble's border colours in the floating window, and any screen reader. Contrast was computed from computed styles, which cannot see text over an image or gradient (none are used here).
- Reflow and small screens, measured in the same real browser at 320, 360, 390, 420, 460, 461, 480, 768 and 1280 px (320 px is a 1280 px window at 400 % zoom, WCAG 1.4.10), over 6 views each (home, meetings, settings, a meeting, the Pet Panel, the notification bell) = 54 views:
  - Found and fixed: with the recording pill showing, the one-row navbar needs about 456 px. Below that the "Settings" link was clipped (7 px of it visible at 320 px) and the pointer could not hit it. The navbar now wraps to two rows at 460 px and below, with the page links on their own row, and grows instead of keeping a fixed 52 px height. The Pet Panel is positioned from a `--navbar-h` variable so it still starts below the taller bar.
  - Found and fixed: the notification popover was anchored to the bell, near the right edge, so at 320 px it ran 26 px off the left of the screen, cutting the start of every notification (23 elements). On narrow screens it is now anchored to the screen under the bar, like the Pet Panel.
  - After the changes: 0 of 54 views have horizontal scrolling, an element off-screen, an unreachable nav link, or a popup overlapping the bar or running off the bottom.
  - Not done: no automated test covers this. It depends on layout in a real browser, which the happy-dom tests cannot do, so the evidence is the measurement above. Text-only zoom and browser font-size changes were not tried.

## Source documents

- Post-MVP Roadmap v1.0 §18, §19

---
Back to [TRACKER](TRACKER.md)
