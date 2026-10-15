# Phase 95 — Fawkes Browsing Assistant

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 93 — Phoenix Mini Browser](phase-93-phoenix-mini-browser.md), [Phase 30 — Policy Gateway & Tool Gateway](phase-30-policy-and-tool-gateway.md) |
| Unblocks | — |

## Goal

Fawkes can read and act on web pages, only with your approval.

## Tasks

- [ ] Summarise a page and answer questions about it (local model by default)
- [ ] Act on a page (click, type, submit, log in, download) through the tool gateway: each side effect needs approval
- [ ] Web pages are untrusted data: page text can never instruct Fawkes; prompt-injection test suite
- [ ] Never reads or fills passwords or payment details
- [ ] Every action audited with the page URL

## Deliverables

- Browser tools in the tool gateway
- Injection tests in ai/evaluation

## Exit criteria

- [ ] A multi-step flow on a test site completes with an approval per side effect
- [ ] Injection tests pass

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
