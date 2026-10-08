# Phase 26 — Issue Tracker Capabilities & v0.2 Release

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 22 — GitHub & CI/CD Capability](phase-22-github-and-cicd-capability.md), [Phase 23 — Frappe / ERPNext Capability](phase-23-frappe-erpnext-capability.md), [Phase 24 — Docker & Editor Capabilities](phase-24-docker-and-editor-capabilities.md), [Phase 25 — Coding-Agent Lifecycle Events](phase-25-coding-agent-lifecycle-events.md) |
| Unblocks | [Phase 27 — Model Adapter & Router](phase-27-model-adapter-and-router.md) |

## Goal

Add Jira / Linear / GitHub Issues awareness and close out v0.2.

## Scope

**In scope**

- Read-only issue/task events
- v0.2 release

**Out of scope**

- Creating issues

## Tasks

- [ ] Issue assigned / status changed events for one or more trackers
- [ ] Verify ≥3 integrations share the same event protocol
- [ ] Per-capability enable/disable verified for all
- [ ] Release v0.2

## Deliverables

- Issue tracker capability
- v0.2 release

## Exit criteria

- [ ] ≥3 integrations on one protocol
- [ ] Source + severity distinguishable
- [ ] Capability failure never crashes Phoenix
- [ ] Gate v0.2 → v0.3 met

## Source documents

- Post-MVP Roadmap v1.0 §4.3, §18

## Notes (honest status)

- **Progress (capability part only; release/gate boxes above are the parent's to tick).** `capabilities/issues` is read-only: one capability (`issues`, permission `network`) with a small `IssueProvider` interface and three providers — GitHub Issues, Linear, Jira Cloud — selected by `config.trackers`; only configured trackers poll and a missing secret or failure degrades that tracker in `health` while the others continue. Shared events: `issues.assigned`, `issues.status_changed` (normalised `open|in_progress|done|cancelled` category plus the raw status name), `issues.unassigned`, and an ephemeral `issues.completed` that drives a short SUCCESS. Assignment and status change appear in the activity feed only (severity `info`); they do not change Fawkes' state and, with the default `min_severity: warning`, do not raise notifications. First poll baselines without replay; cursors use the tracker's own timestamps.
- **Verified for real:** the GitHub provider's parser and baseline/diff ran against live `api.github.com` responses (`microsoft/vscode`, `Thunder-BluePhoenix/Phoenix`; read-only, a handful of calls) and trimmed real responses are committed as fixtures under `capabilities/issues/test/fixtures/` with contract tests. The Phoenix repo currently has only a pull request and no issues, so no real *assignment* event was observed there.
- **Not verified:** Linear and Jira are written from the providers' documentation and tested only against a local mock; they have never run against the real services (no credentials). A Linear personal API key and a Jira Cloud site + account email + API token would close this.

---
Back to [TRACKER](TRACKER.md)
