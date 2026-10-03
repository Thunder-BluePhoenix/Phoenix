# Phase 19 — Settings & Privacy Controls

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | ✅ Done |
| Depends on | [Phase 09 — Pet Panel, Activity Feed & Notifications](phase-09-pet-panel-activity-notifications.md), [Phase 12 — Capability Manager & Manifest](phase-12-capability-manager.md) |
| Unblocks | [Phase 20 — Hardening, E2E, Observability & v0.1 Release](phase-20-hardening-and-v0-1-release.md) |

## Goal

Give users full control over appearance, behaviour, integrations, notifications, privacy and retention.

## Scope

**In scope**

- Settings: PetSettings, CapabilitySettings, PrivacySettings
- Retention + deletion controls
- Telemetry opt-in
- Per-capability permission view

## Tasks

- [x] PetSettings: reduced motion (auto / on / off, stored in core so every Fawkes view shares it), pause, quiet mode. Desktop options arrive with Phase 14
- [x] CapabilitySettings: enable/disable/restart, configuration form generated from `config_schema`, credentials from the new manifest `secrets` field (OS keychain), permissions with per-permission revoke, data categories
- [x] PrivacySettings: storage location, counts and retention per data class (events, notifications, meetings; pruned now and hourly), delete-all with confirmation (audited), credential names. External AI: stated that Phoenix has none yet; the opt-in toggle lands with the first AI feature (Phase 27) rather than as a control that does nothing
- [x] Notification preferences: quiet mode, minimum severity, mute per capability
- [x] Telemetry: Phoenix has none; stated in Settings and the README
- [x] Emergency 'disable all capabilities' button (Settings and Pet Panel)

## Deliverables

- Settings UI

## Exit criteria

- [x] FR-014 satisfied
- [x] User can revoke any permission and delete any stored data (the audit log is deliberately kept as the record of those deletions)

## Implementation notes

- Settings page at `#/settings`; the navbar is now Meetings · Settings, with the 🐦‍🔥 icon linking home.
- New API: `GET/POST /api/pet/settings`, `GET /api/privacy`, `POST /api/privacy/retention`, `POST /api/privacy/delete`.
- Verified in the running app: reduced motion applied to the live Fawkes, Kage configured and its API key saved to and removed from the macOS keychain through the UI (zero copies in Phoenix's database files).

## Source documents

- Full System PRD v2.0 §5.3, §19
- Fawkes PRD v1.0 FR-014, §15

---
Back to [TRACKER](TRACKER.md)
