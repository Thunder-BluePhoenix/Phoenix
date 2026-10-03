# Phase 00 — Pre-Coding Decisions & ADRs

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | 🟨 In progress |
| Depends on | — |
| Unblocks | [Phase 01 — Repository & Open-Source Foundation](phase-01-repo-and-open-source-foundation.md) |

## Goal

Close every open architectural question the PRDs list as 'decide before coding', and record each answer as an ADR so later phases build on fixed ground.

## Scope

**In scope**

- All items in PRD v2.0 §28 'Decisions Required Before Coding'
- Open questions from Fawkes PRD v1.0 §22
- ADR-001 … ADR-010 candidates from Tech Spec §16
- Reconcile state lists across documents (SLEEPING, LISTENING, OFFLINE, USER_ACTION_REQUIRED)

**Out of scope**

- Writing production code
- Final artwork (only the asset *format* is decided here)

## Tasks

- [x] Choose core runtime language (Go vs Python vs Rust) and the core ↔ UI process boundary
- [x] Choose web framework + state management (PRD suggests React / Next.js)
- [ ] Build a throwaway transparent-window prototype to choose the desktop shell (Tauri vs native); use Coucou as an architecture reference only
- [x] Choose local persistence (PRD suggests SQLite) and secret storage (OS keychain)
- [x] Decide local-only vs optional remote Phoenix server
- [x] Define capability authentication (how capabilities prove identity to the event bus)
- [x] Define the initial AI provider abstraction (interface only)
- [ ] Define the first Kage API contract with the Kage maintainers
- [x] Decide the Fawkes asset format (sprite sheet / SVG / Lottie / Rive) and licence for artwork
- [x] Write a canonical Fawkes state list: IDLE, LISTENING, THINKING, WORKING, WAITING, SUCCESS, WARNING, ERROR, RECORDING, DEPLOYING, SLEEPING, OFFLINE — with priority order
- [x] Write ADR-001…ADR-010 into docs/adr/

## Deliverables

- docs/adr/ADR-001 … ADR-010 (+ stack ADRs)
- Desktop transparent-window spike report
- Kage API contract draft v0
- Canonical state list document

## Exit criteria

- [ ] Every §28 decision has an accepted ADR
- [x] Stack is fixed and agreed
- [x] State list is consistent across all future docs

## Notes & risks

- Do not over-research: time-box each decision. The PRDs say 'useful before clever'.
- Coucou / Codex Pets are references only — no assets may be copied.

## Progress log

- 2026-10-03: ADR-0001…0019 written (docs/adr/). Stack fixed: TypeScript/Node 22 + pnpm, React + Vite, Tauri v2, SQLite (node:sqlite).
- Open: Tauri transparent-window spike (ADR-0013 is 'Accepted (pending spike)'); do it at the start of Phase 14.
- Open: Kage API contract v0 is a draft (docs/contracts/kage-api-v0.md) — needs confirmation from Kage maintainers before Phase 15.

## Source documents

- Full System PRD v2.0 §28, §26
- Fawkes PRD v1.0 §13, §22
- Technical Spec Suite 04–14 §16

---
Back to [TRACKER](TRACKER.md)
