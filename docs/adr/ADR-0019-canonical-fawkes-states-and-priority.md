# ADR-0019: Canonical Fawkes states and priority

**Status:** Accepted  
**Date:** 2026-10-03

## Context

The vision documents use slightly different state lists (PRD v2.0 §6, Tech Spec §10, AI Evolution §19).

## Decision

Canonical states (highest priority first):

| Priority | State     | Notes                                              |
| -------- | --------- | -------------------------------------------------- |
| 1        | ERROR     | Failure; persists until acknowledged or superseded |
| 2        | WAITING   | User action required (merges USER_ACTION_REQUIRED) |
| 3        | RECORDING | Kage capture active                                |
| 4        | WARNING   | Potential issue                                    |
| 5        | DEPLOYING | Deployment in progress                             |
| 6        | THINKING  | AI processing                                      |
| 7        | LISTENING | Receiving user input                               |
| 8        | WORKING   | Task in progress                                   |
| 9        | SUCCESS   | Transient completion                               |
| 10       | IDLE      | Nothing active                                     |

Modes: **SLEEPING** is a user-selected pause; only ERROR and RECORDING break through it. **OFFLINE** is computed by the UI when core is unreachable.

Independently of the displayed state, the snapshot always carries a `recording` flag so the recording indicator is never hidden by a higher-priority state.

## Consequences

WARNING was not in the PRD priority list; it is placed below RECORDING so privacy indicators win.
