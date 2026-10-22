# Phase 96 — Browser Profiles, Sync & Extensions

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and tested with fakes and in-memory databases; every check is simulated. **Not built:** no browser engine, extension sandbox, revocation service or UI, and web partition purge is left to the host. The sync round trip was only run through a fake relay; the exit criterion is not met |
| Depends on | [Phase 93 — Phoenix Mini Browser](phase-93-phoenix-mini-browser.md), [Phase 45 — Cross-Device Context & Sync](phase-45-cross-device-context.md) |
| Unblocks | — |

## Goal

Make the Phoenix browser yours across devices.

## Tasks

- [ ] Several profiles (work, personal, testing). Per-profile partitions and namespaced credentials (purged on remove) are built. Simulated. Unticked: no browser engine or UI; purging a web partition is left to the host.
- [ ] Bookmarks and history synced through Phoenix's encrypted sync (Phase 45). Sync is off at account and profile level; staged remote revisions are applied only on accept. A synced item is capped at about 32 KB. Simulated. Unticked: only a fake relay was used.
- [ ] Import bookmarks from other browsers. Bookmark HTML import is built (http/https only). Simulated. Unticked: not run on a real browser export.
- [ ] Small extension API through capabilities (page actions, content scripts with declared permissions). Only Ed25519-signed extension manifests are built (unapproved by default, fails closed). **No extension sandbox, revocation service or UI exists.**

## Deliverables

- `core/runtime/src/browser-profiles`: profiles, sync, bookmark import, extension manifest verification. Built, 34 tests, simulated evidence only. See [browser-profiles.md](../browser-profiles.md).
- Not built: a browser engine, an extension API runtime or sandbox, UI.

## Exit criteria

- [ ] Bookmarks round-trip between two devices encrypted end to end. **Simulated only:** a two-device round trip through a fake relay and the real `SyncRuntime` passed in tests. No two real devices, relay or browser took part.

## Implementation notes

### What was built

- **Profiles:** per-profile partitions and namespaced credentials, purged on remove.
- **Sync:** off at the account and the profile level; staged remote revisions are applied only on accept; the synced item cap is about 32 KB.
- **Import:** bookmark HTML (http/https only).
- **Extensions:** Ed25519-signed manifests, unapproved by default, fail closed.
- 34 tests, including a two-device round trip with a fake relay through the real `SyncRuntime`. Documentation: [browser-profiles.md](../browser-profiles.md).

### What was not built

A browser engine, an extension sandbox, a revocation service, any UI, signer distribution, and the web partition purge (left to the host).

### What was not run

Any real browser, device pair, relay or extension. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
