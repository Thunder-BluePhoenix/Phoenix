# Phase 23 — Frappe / ERPNext Capability

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | High |
| Status | 🟨 Partial — discovery, health polling and site ERROR mapping done; bench restart / build / migration / deploy events not implemented (see Notes) |
| Depends on | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |
| Unblocks | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md), [Phase 36 — Action Items → Engineering Tasks](phase-36-action-items-to-engineering-tasks.md) |

## Goal

Observe bench, site, build, migration and deployment activity for Frappe developers.

## Scope

**In scope**

- frappe.bench.*, frappe.migration.*, frappe.site.unhealthy, build/deploy events

**Out of scope**

- Creating Frappe records (Phase 36)

## Tasks

- [x] Bench/site discovery and health polling (never run against a real Frappe site; see Notes)
- [ ] Events: site health and bench discovery are done (`frappe.site.unhealthy|healthy|removed`, `frappe.bench.discovered`); bench restart, build, migration completed and deployment are **not implemented** (no honest read-only signal, see Notes)
- [x] Map site.unhealthy → ERROR
- [ ] Panel view for site health — the `sites` command returns everything the view needs; the web view itself is not built yet
- [x] Tests against a local bench fixture (tmp-dir bench + mock Frappe HTTP server)

## Deliverables

- capabilities/frappe

## Exit criteria

- [x] Frappe site failure drives Fawkes ERROR (shown through the harness against a mock site; two consecutive failed pings, cleared on recovery)

## Notes (honest status)

- `capabilities/frappe` is read-only: it reads `sites/apps.txt`, `sites/common_site_config.json` (`webserver_port`, `default_site`, `serve_default_site` only), lists `sites/*` directories that contain a `site_config.json` (only `stat`ed; opened solely to read `host_name`), and polls `GET <base>/api/method/ping` with `X-Frappe-Site-Name`. It never runs `bench`, never writes, never reads any other value from `site_config.json` (db passwords, encryption keys).
- Base URL per site: `sites` override in the capability config, else `host_name`, else `http://127.0.0.1:<webserver_port|8000>`. Only http(s); redirects are not followed; responses are capped at 16 KiB.
- A site is reported unhealthy after 2 consecutive failed pings and healthy again on the first success.
- **Never run against a real Frappe site**: no site was running here. Discovery was exercised on the directory layout of real benches (apps.txt and site directory names only); health polling was exercised only against a mock server.
- Not implemented, because Frappe exposes no read-only signal for them without running `bench` or reading site databases/config: `frappe.bench.restarted`, `frappe.build.completed`, `frappe.migration.completed`, `frappe.deploy.*`. They need a small Frappe-side app or `bench` hook that posts to Phoenix.

## Source documents

- Post-MVP Roadmap v1.0 §4
- Full System PRD v2.0 Appendix A
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
