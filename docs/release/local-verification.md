# Local verification checklist

Implementation, automated checks and observed native behavior are separate evidence. Record the commit, date, OS/architecture, exact steps, expected and actual results, and any issue for each run. Never include session tokens, credentials, private page contents or meeting recordings in evidence.

## Automated baseline

Use Node >=22.13 and pnpm 10. Run `pnpm check`, `pnpm build:web`, and `cargo test --locked` in `apps/desktop/src-tauri`. Integration tests require permission to listen on loopback. Rust lifecycle tests use a mock runtime: they establish shell decisions, not real window visibility or platform prompts.

Recorded on 2026-11-08 for the local working changes: the full suite on Node 22.19.0 passed 9,671 tests across 479 files (18 tests / 6 files skipped). TypeScript checks, license headers and formatting passed. The web production build passed without warnings; the main application chunk decreased from 603.97 kB to 483.28 kB (minified, before gzip) by deferring secondary screens. Desktop `cargo test --locked --offline --quiet` passed 513 unit tests and 26 mock lifecycle checks on this Mac. These results do not check any native item below. The installed Homebrew Node 25 binary could not start because of a missing simdjson library; verification used an existing working Node installation instead.

## Native desktop and browser

- [ ] Start Core and the desktop app on an unlocked macOS session. Confirm Fawkes appears, drags, hides/shows from the tray, stays reachable after restart and switches between floating and island modes. Repeat placement with an external display and after disconnecting it.
- [ ] For both floating and island Fawkes: single-click shows a live summary without opening a browser; double-click opens the contextual full app exactly once without a delayed summary toggle. Check the Close button and Escape, drag suppression, active task updates, and reduced-motion behavior. Confirm the idle island stays visible and its animation continues when expanded. Browser previews were visually checked at 200×220 (floating) and 360×176 (expanded island); native window stacking and click timing still need this check.
- [ ] Open browser chrome, navigate to a public HTTPS page, use back/forward/reload, and close/reopen tabs. Confirm the controls affect the selected tab. Record the webview/OS versions.
- [ ] With a controlled test page, verify redirects and popups, permission denials, download cancellation and the selected destination, and filtering with shields on/off. Confirm private destinations are refused except an explicitly opened development server. Follow [mini-browser verification limits](../mini-browser.md).
- [ ] Create two browser profiles and use a controlled cookie page to verify isolation, restart persistence and the advertised private-mode behavior. Delete a profile and verify storage removal. Test a browsing action through its approval UI; declining must cause no action, and navigation after approval must invalidate the stale action. Follow [browser profiles](../browser-profiles.md) and [browsing assistant](../browsing-assistant.md).
- [ ] Repeat the applicable native checks on each advertised Windows/Linux platform. A successful compile or mock lifecycle run does not complete these items.

## Audio, capture and integrations

- [ ] Test dictation and voice input with the real microphone: allow, deny and revoke OS permission; cancel and stop capture; verify the recording indicator and intended paste destination. Use nonsensitive sample speech and the configured local speech model. See [dictation](../phases/phase-64-dictation-anywhere.md) and [voice assistant](../voice-assistant.md).
- [ ] Test region capture with a disposable image: cancel, deny/revoke screen permission and explicitly approve one capture. Review the issue draft, decline creation, and verify no issue was sent. See [focus and screenshot](../focus-and-screenshot.md).
- [ ] Run a real coding-agent lifecycle through Fawkes, including an approval and denial, using a disposable repository. Verify events, state changes, cancellation and emergency stop. Sending a prompt may consume account quota; record the selected provider and consent before doing so.
- [ ] Verify configured integrations one at a time against an account or device chosen for testing. Begin with reads. Before testing external writes or paid cloud processing, record the exact intended effect, target and permission. Use the component's documented checks and update its gap row with evidence.

Unchecked items remain unverified. This checklist does not certify a release; use the existing [release gates](../release-gates.md) and version-specific verification plans for release decisions.
