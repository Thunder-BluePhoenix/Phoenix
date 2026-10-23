# Phase 96 — Browser Profiles, Sync & Extensions

| Field | Value |
|---|---|
| Stage | Stage 15 — Phoenix browser |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and wired into Core (`BrowserProfilesService`, `/api/browser/*` routes); every check is simulated (fakes, in-memory databases, two Cores sharing a fake relay). **Not built:** no browser engine, partition purge, extension sandbox (scripts are stored as data and never run) or issuing/fetching service for signers. Signer distribution (host-supplied signed file) and revocation are built, simulated. The sync round trip was only run through a fake relay; the exit criterion is not met |
| Depends on | [Phase 93 — Phoenix Mini Browser](phase-93-phoenix-mini-browser.md), [Phase 45 — Cross-Device Context & Sync](phase-45-cross-device-context.md) |
| Unblocks | — |

## Goal

Make the Phoenix browser yours across devices.

## Tasks

- [ ] Several profiles (work, personal, testing). Per-profile partitions and namespaced credentials (write-only through the routes, deleted with the profile) are built and served by routes. Simulated. Unticked: no browser engine; `DELETE profile` returns `purge_partition` because Core cannot clear a webview store that does not exist.
- [ ] Bookmarks and history synced through Phoenix's encrypted sync (Phase 45). Sync is off at account and profile level; staged remote revisions are applied only on accept. A synced item is capped at about 32 KB. Simulated. Unticked: only a fake relay was used.
- [ ] Import bookmarks from other browsers. Bookmark HTML import is built (http/https only). Simulated. Unticked: not run on a real browser export.
- [ ] Small extension API through capabilities (page actions, content scripts with declared permissions). Only Ed25519-signed extension manifests are built (unapproved by default, fails closed); approval asks the user. Signers come only from the host (`RuntimeOptions.extensionSigners` static map or `extensionSignerRegistry`; default none), so by default no extension can be installed. Signers come from a pinned-root signed registry (`extensionSignerRegistry`, offline file) with revocation, expiry and rollback refusal; revocation is retroactive. Simulated only. **No extension sandbox exists.**

## Deliverables

- `core/runtime/src/browser-profiles`: profiles, sync, bookmark import, extension manifest verification; `service.ts` (`BrowserProfilesService`) wires it into Core, and `ProfileError` makes bad requests 400/404 instead of faults. Built, simulated evidence only. See [browser-profiles.md](../browser-profiles.md).
- `core/api/src/browser-profile-routes.ts` (session token only) under `/api/browser/*`: profile CRUD, per-profile sync opt-in, bookmark HTML import (256 KiB body limit), history, write-only credentials `PUT/DELETE …/credentials/:name`, publish, `POST /api/browser/sync/pull`, sync preview/accept/adopt, extension list/approval/uninstall. Needs a secret store (503 otherwise). Privacy row `browser_profiles`.
- Sync reuses the Phase 45 `SyncRuntime` only after account sync is configured and the profile opted in; the relay holds only sealed envelopes. Credentials never come back from any route. Approving an extension asks the user (blocks); withdrawing and uninstalling never ask; every `authorize()` is decided by the gateway (fails closed; the kill switch makes it say no).
- `core/runtime/src/browser-profiles/signer-registry.ts`: signed, versioned, bounded signer registry plus revocation list, verified against a host-pinned Ed25519 root, monotonic `sequence`, bounded expiry; consulted at install and on every read/authorise. Details in [browser-profiles.md](../browser-profiles.md). Simulated evidence only.
- Tests: `core/runtime/test/browser-profiles-wiring.test.ts` (12, two Cores sharing a fake relay, plus two signer-registry file tests) and `core/runtime/test/signer-registry.test.ts` (25, keys generated at test time).
- Not built: a browser engine, partition purge, an extension runtime or sandbox, a tool or service that issues registry documents, any network fetch or scheduled refresh of the registry. Settings section: `apps/web/src/components/BrowserProfilesSettings.tsx`.

## Exit criteria

- [ ] Bookmarks round-trip between two devices encrypted end to end. **Simulated only:** a two-device round trip through a fake relay and the real `SyncRuntime` passed in tests. No two real devices, relay or browser took part.

## Implementation notes

### What was built

- **Profiles:** per-profile partitions and namespaced credentials, purged on remove.
- **Sync:** off at the account and the profile level; staged remote revisions are applied only on accept; the synced item cap is about 32 KB.
- **Import:** bookmark HTML (http/https only).
- **Extensions:** Ed25519-signed manifests, unapproved by default, fail closed. Signer registry with revocation (signer or manifest hash), signer and document expiry, rollback refusal; installed extensions flip to `revoked` on the next read. New Settings strings are machine-translated and unreviewed.
- 34 manager tests, including a two-device round trip with a fake relay through the real `SyncRuntime`, plus the 10 wiring tests above. Documentation: [browser-profiles.md](../browser-profiles.md).

### What was not built

A browser engine, an extension sandbox, a registry issuing tool, network fetch/refresh of the registry, and the web partition purge (Core returns `purge_partition`; the host must act on it).

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
