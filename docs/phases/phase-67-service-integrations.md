# Phase 67 — Service Integrations (Vercel, Stripe, n8n, Resend, Notion, Cal.com)

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | — |

## Goal

Bring the services developers run on into Fawkes as capabilities.

## Tasks — parity with Coucou

- [ ] Vercel deployments, Stripe payments, n8n workflows, Resend emails, Notion, Cal.com
- [ ] Each with its own colour/mini Fawkes
- [ ] Pollers paused when nothing is watching

## Tasks — Phoenix improvements

- [ ] Read-only by default; safe actions (re-run, redeploy, pause a workflow) need approval; nothing that moves money or sends email
- [ ] Deploy events feed DEPLOYING/SUCCESS/ERROR and the knowledge graph

## Deliverables

- capabilities/vercel, stripe, n8n, resend, notion, calcom

## Exit criteria

- [ ] Each capability tested against a mock written from the service's docs, and against the real API where a key is available

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
