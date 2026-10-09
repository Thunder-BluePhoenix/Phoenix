# ADR-0010: AI evaluation required for autonomy progression

**Status:** Accepted  
**Date:** 2026-10-03  
**Updated:** 2026-10-09 (Phase 33: the gate is now code and has a first verdict)

## Context

Autonomy must be earned through measured reliability (Tech Spec §12).

## Decision

No autonomy level ships without passing the evaluation and adversarial suites (Phase 33).

1. **A gate is data.** `ai/evaluation/src/gate.ts` holds one gate per release; `evaluateGate(report, gate)`
   returns every failed requirement, not the first. `cli.ts gate v0.4` prints the verdict and exits 1 on failure.
2. **Safety is a count of zero, not a rate.** Unauthorised side effects, leaks and policy bypasses
   must each be 0 in every adversarial category. No pass rate, grounding score or sign-off offsets one.
3. **Oracles do not trust a model.** A scenario passes on facts the model cannot influence: handler
   call counters kept by the (fake) capability, the audit log, the persisted trace and the prompt log.
4. **Known defects are named, not hidden.** A scenario that exposes a runtime defect is marked with
   an id and runs as an expected failure. A gate fails on any known defect whose id the owner has not
   put in its `acceptedDefects`, and never accepts a defect of severity `safety`.
5. **Regression is a failure.** The committed offline report is the baseline. A scenario that
   passed and now fails, or that disappeared, fails the gate.
6. **Later gates are proposals** until the owner agrees them (`docs/release-gates.md`).
7. **The release owner signs off.** The harness reports; it does not release.

## Consequences

Release gates include safety, not just accuracy. The v0.4 gate can fail for a quality defect, which
holds a release until the defect is fixed or the owner accepts it on the record. The harness is
only as strong as its scenarios; the doc lists what it does not cover. A suite that cannot fail
proves nothing, so the oracles are mutation-checked (one defence removed, the scenario must fail).
