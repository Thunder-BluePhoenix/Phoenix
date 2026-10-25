# Phase 23 — Frappe / ERPNext Capability

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | High |
| Status | 🟨 Partial: discovery, health polling and site ERROR mapping done and registered in Core; bench restart, build, migration and deploy events not implemented; never run against a real Frappe site (see [gaps register](../gaps.md)) |
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
- [x] Overview panel shows per-site health via the read-only `frappe.sites` command; real bench/browser evidence still pending.
- [x] Tests against a local bench fixture (tmp-dir bench + mock Frappe HTTP server)

## Deliverables

- capabilities/frappe

## Exit criteria

- [x] Frappe site failure drives Fawkes ERROR (shown through the harness against a mock site; two consecutive failed pings, cleared on recovery)

## Notes (honest status)

- `capabilities/frappe` is read-only: it reads `sites/apps.txt`, `sites/common_site_config.json` (`webserver_port`, `default_site`, `serve_default_site` only), lists `sites/*` directories that contain a `site_config.json` (only `stat`ed; opened solely to read `host_name`), and polls `GET <base>/api/method/ping` with `X-Frappe-Site-Name`. It never runs `bench`, never writes, never reads any other value from `site_config.json` (db passwords, encryption keys).
- Base URL per site: an explicit user-configured `sites` override, else only a numeric-loopback `host_name` on the selected bench's configured `webserver_port`, else `http://127.0.0.1:<webserver_port|8000>`. Remote or alternate-port deployments must opt in via a `sites` override. Redirects are not followed; responses are capped at 16 KiB. Event history uses opaque bench ids instead of private bench paths/site URLs; local `sites` command results retain them for the panel.
- A site is reported unhealthy after 2 consecutive failed pings and healthy again on the first success.
- **Never run against a real Frappe site**: no site was running here. Discovery was exercised on the directory layout of real benches (apps.txt and site directory names only); health polling was exercised only against a mock server.
- Not implemented, because Frappe exposes no documented read-only, non-secret endpoint for them: `frappe.bench.restarted`, `frappe.build.completed`, `frappe.migration.completed`, `frappe.deploy.*`. They need a small Frappe-side app or `bench` hook that posts to Phoenix.
- **Evidence (checked 2026-10-25).** The only guest-callable method this capability uses is `frappe.ping`, which in Frappe's source is `@whitelist(allow_guest=True) def ping(): return "pong"` ([frappe/__init__.py](https://github.com/frappe/frappe/blob/develop/frappe/__init__.py)); it carries no uptime or boot time. The [REST API reference](https://docs.frappe.io/framework/user/en/api/rest) documents only token (`api_key:api_secret`), password and OAuth authentication for everything else, and lists no health, uptime, build, migrate or deploy method. `bench migrate` ([reference](https://docs.frappe.io/framework/user/en/bench/reference/migrate)) and `bench build` / `bench restart` are CLI commands whose only documented outputs are terminal output, `after_migrate` hooks and the `touched_tables.json` file, not an HTTP endpoint. The closest data, the System Health Report doctype (`frappe/desk/doctype/system_health_report`), has background-worker, scheduler, database and user fields but none for uptime, restart, last build, last migration or deploy, and requires the System Manager role through an authenticated session, which is outside this capability's no-credential read path (its only secret, `write_token`, is for `task.create` and is documented as a user that may only create Tasks). Frappe Cloud's uptime chart ([docs](https://docs.frappe.io/cloud/sites/monitoring)) is a hosted-service dashboard, not a bench API. Unhealthy-then-healthy is not published as `frappe.bench.restarted`: it is already `frappe.site.unhealthy` / `frappe.site.healthy`, and a restart is not the only cause.

## Source documents

- Post-MVP Roadmap v1.0 §4
- Full System PRD v2.0 Appendix A
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
