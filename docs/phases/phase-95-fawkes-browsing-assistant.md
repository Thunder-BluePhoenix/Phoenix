# Phase 95 — Fawkes Browsing Assistant

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built as code with fakes; every check is simulated. **Not wired:** a pure HTML-snapshot `PageReader` and a simulated injection suite now exist, but there are no gateway tools, no approval UI and no real browser source. It was reviewed again after the Phases 86-96 wiring and not wired: it needs a browser to supply documents, registered browser tools and an approval UI, none of which exist, so no Core piece would be real. No real page, site or model was used; neither exit criterion is met |
| Depends on | [Phase 93 — Phoenix Mini Browser](phase-93-phoenix-mini-browser.md), [Phase 30 — Policy Gateway & Tool Gateway](phase-30-policy-and-tool-gateway.md) |
| Unblocks | — |

## Goal

Fawkes can read and act on web pages, only with your approval.

## Tasks

- [ ] Summarise a page and answer questions about it (local model by default). Page text is passed as data (a user message JSON) and only a local model is used. Simulated. The reader (`readPageSnapshot`) turns HTML snapshots into `PublicPage`s but nothing supplies real HTML yet. Unticked.
- [ ] Act on a page (click, type, submit, log in, download) through the tool gateway: each side effect needs approval. Per-action approval for click, type, submit, navigate and download is built, with a fail-closed pending audit before dispatch. Simulated. Unticked: no gateway tools and no approval UI. Log-in is not covered.
- [ ] Web pages are untrusted data: page text can never instruct Fawkes; prompt-injection test suite. Page text is data only and the page is re-read and the action revalidated before each step. A simulated 35-case suite (`ai/evaluation/test/browsing-injection.test.ts`) runs the reader and the real assistant against a gullible scripted model; no real model was measured. **Unticked.**
- [ ] Never reads or fills passwords or payment details. Protected fields (password, payment, OTP and similar) are refused, but this **depends on adapter-supplied metadata**. Simulated. Unticked.
- [ ] Every action audited with the page URL. Audited with the query string stripped. Simulated. Unticked: no real audit path.

## Deliverables

- `ai/browsing` (`@phoenix/ai-browsing`): page-as-data prompting, approval and audit flow, protected-field refusal. Built, not wired; simulated evidence only. See [browsing-assistant.md](../browsing-assistant.md).
- `ai/browsing/src/page-snapshot.ts`: pure reader (hidden/script/comment/form-value removal, field descriptions, safe links, character hygiene, size limits) and an untrusted-content envelope helper. Simulated.
- `ai/evaluation/test/browsing-injection.test.ts`: 35 injection cases against the reader and the real assistant with a gullible scripted model. Simulated; not part of `ALL_SCENARIOS`.
- Not built: browser tools in the tool gateway, the approval UI, a real browser source (Phase 93).

## Exit criteria

- [ ] A multi-step flow on a test site completes with an approval per side effect. **Unmet.** The reader exists but no gateway tools or approval UI do, and no real site was used.
- [ ] Injection tests pass. **Unmet.** A simulated suite exists and passes, but it uses a scripted model and no real browser or site; real-model resistance was not measured.

## Implementation notes

### What was built

- **Page text is data** (a user-message JSON), never instructions; local model only.
- **Per-action approval** for click, type, submit, navigate and download, with a fail-closed pending audit written before dispatch.
- **Re-read and revalidate** before each step; protected fields (password, payment, OTP and similar) refused; query strings stripped from the audit.
- **Page reader** (`readPageSnapshot`): visible text and control descriptions only, no form values, linear tokenizer, size limits.
- **Injection suite** in `ai/evaluation/test`: 35 simulated cases, gullible scripted model.
- Documentation: [browsing-assistant.md](../browsing-assistant.md).

### Security review

A static read-only review by tools (not a human audit) found that a page could change while the approval dialog was open and retarget an approved action. The page is now re-read and the action re-validated **after** approval and before dispatch (fixed, with a test that failed before).

### What was not built

Gateway tools, an approval UI, a real browser source for the reader, wiring into Core, and any measurement of a real model against visible attacker text. The reader cannot see class-hidden or white-on-white text.

### What was not run

Any real page, site, browser or model. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
