# Phase 95 — Fawkes Browsing Assistant

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built as code with fakes; every check is simulated. **Not wired:** no `PageReader`, no gateway tools, no approval UI, and no injection suite in `ai/evaluation`. No real page was read or acted on; neither exit criterion is met |
| Depends on | [Phase 93 — Phoenix Mini Browser](phase-93-phoenix-mini-browser.md), [Phase 30 — Policy Gateway & Tool Gateway](phase-30-policy-and-tool-gateway.md) |
| Unblocks | — |

## Goal

Fawkes can read and act on web pages, only with your approval.

## Tasks

- [ ] Summarise a page and answer questions about it (local model by default). Page text is passed as data (a user message JSON) and only a local model is used. Simulated. Unticked: no `PageReader` exists.
- [ ] Act on a page (click, type, submit, log in, download) through the tool gateway: each side effect needs approval. Per-action approval for click, type, submit, navigate and download is built, with a fail-closed pending audit before dispatch. Simulated. Unticked: no gateway tools and no approval UI. Log-in is not covered.
- [ ] Web pages are untrusted data: page text can never instruct Fawkes; prompt-injection test suite. Page text is data only and the page is re-read and the action revalidated before each step. **Unticked:** there is no injection suite in `ai/evaluation`.
- [ ] Never reads or fills passwords or payment details. Protected fields (password, payment, OTP and similar) are refused, but this **depends on adapter-supplied metadata**. Simulated. Unticked.
- [ ] Every action audited with the page URL. Audited with the query string stripped. Simulated. Unticked: no real audit path.

## Deliverables

- `ai/browsing` (`@phoenix/ai-browsing`): page-as-data prompting, approval and audit flow, protected-field refusal. Built, not wired; simulated evidence only. See [browsing-assistant.md](../browsing-assistant.md).
- Not built: browser tools in the tool gateway, injection tests in `ai/evaluation`.

## Exit criteria

- [ ] A multi-step flow on a test site completes with an approval per side effect. **Unmet.** No page reader, gateway tools or approval UI exist, and no real site was used.
- [ ] Injection tests pass. **Unmet.** The injection suite in `ai/evaluation` does not exist.

## Implementation notes

### What was built

- **Page text is data** (a user-message JSON), never instructions; local model only.
- **Per-action approval** for click, type, submit, navigate and download, with a fail-closed pending audit written before dispatch.
- **Re-read and revalidate** before each step; protected fields (password, payment, OTP and similar) refused; query strings stripped from the audit.
- Documentation: [browsing-assistant.md](../browsing-assistant.md).

### Security review

A static read-only review by tools (not a human audit) found that a page could change while the approval dialog was open and retarget an approved action. The page is now re-read and the action re-validated **after** approval and before dispatch (fixed, with a test that failed before).

### What was not built

A `PageReader`, gateway tools, an approval UI, and the injection suite in `ai/evaluation`. Field protection relies on adapter-supplied metadata.

### What was not run

Any real page, site or browser. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
