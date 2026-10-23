# Browser profiles, sync and extensions (Phase 96)

Module: `core/runtime/src/browser-profiles/index.ts` (`BrowserProfileManager`). Tests: `core/runtime/test/browser-profiles.test.ts` (manager) and `core/runtime/test/browser-profiles-wiring.test.ts` (10, through a real running Core, two Cores sharing a fake relay).

The manager is local-first policy and data logic. It performs no network, browser or OS operation of its own. Core now wires it (see "How it is wired"); the host webview and the sandbox that would run extension code do not exist.

## Profiles and isolation

- `create(name)` makes a profile (work, personal, testing …) with a random `id` and a random `partition`. The host MUST use `partition` as the isolated cookie / cache / local-storage / webview partition, so profiles never share web state. The partition is local only and is never synced.
- Bookmarks (`addBookmark`) and history (`recordVisit`) belong to exactly one profile. Only `http(s)` URLs without embedded credentials are accepted; ids match `[A-Za-z0-9_-]{1,80}`; each list is capped at 10 000 entries (history keeps the newest).
- State is stored through `SettingsStore` under `browser.profiles.v1`. It contains no secrets.
- `remove(id)` deletes the profile, its extensions and every credential saved through `putCredential`. The host must still purge the web partition named by `partition`.

## Per-profile credentials

`putCredential` / `getCredential` / `deleteCredential` store values only in the `SecretStore` (OS keychain in production) under `browser.profile.<profileId>.<name>`. Settings keep just the credential _names_ so `remove` can purge them. Credentials are never part of profile data, sync payloads or logs.

## Bookmark import

`parseBookmarkHtml(html)` parses the Netscape bookmark HTML that browsers export (input is text the user supplied; Phoenix never reads another browser's files). Only safe `http(s)` links survive; others (`javascript:`, `file:`, credentialed URLs, links without `href`) are counted in `skipped`. Ids are a hash of the URL so re-importing merges instead of duplicating. `importBookmarkHtml(profileId, html)` imports into one profile; `importBookmarks` takes an already-parsed list.

## Sync (off by default)

Nothing leaves the device unless **both** are true: the account-level encrypted sync (Phase 45 `SyncRuntime`) is configured and enabled, **and** the profile was opted in with `setSync(id, true)`. New profiles have `syncEnabled: false`.

- `publish(id)` upserts `browser:<id>` (name, bookmarks, history only) into the encrypted sync store and runs a sync. The relay only sees sealed envelopes. Credentials, extensions and partitions are excluded.
- `pull()` downloads remote state into staging. Nothing local changes.
- `remoteProfiles()` lists synced profiles not present on this device; `adopt(id, revision)` creates a local copy (fresh local partition, sync on because the user chose it).
- `preview(id)` shows the staged item. A newer remote revision from another device appears as `conflict`; `accept(id, revision)` applies exactly that revision (bookmarks and history are replaced, local edits discarded) and resolves the staged conflict to the remote side. A stale or mismatched revision is refused. Remote data is validated like local input (URL schemes, duplicates, bounds, matching id) before anything is applied.

`EncryptedProfileSync` is the narrow interface the host binds to `SyncRuntime` (`status`, `upsert`, `inspect`, `resolve`, `sync`).

## Extensions

Small API: `pageAction` and `contentScript`, each tied to declared exact origins (no wildcards, no paths).

1. `install(profileId, signedExtension)` verifies an Ed25519 signature over `canonicalManifest(manifest)` (fixed field order) against a key in the `trustedSigners` map (signer id → SPKI PEM). Unknown manifest fields, untrusted signers, malformed keys/signatures and tampered manifests are rejected. The extension is stored **unapproved**.
2. `approve(profileId, extensionId, true)` is the explicit user approval. Re-installing (e.g. a new version) resets approval.
3. `authorize(profileId, extensionId, permission, origin)` is checked on every operation and fails closed: the extension must be approved, its signer still trusted, the permission and exact origin declared, and the injected `PermissionDecision` (the permission/tool gateway, which also audits) must agree. Without a gateway the answer is always `false`.

The `contentScript` text is data. Only a host-side sandbox that has received a positive `authorize` may run it.

## How it is wired

`BrowserProfilesService` (`core/runtime/src/browser-profiles/service.ts`) constructs the manager in the runtime. It needs the OS secret store (without one the routes answer 503). `ProfileError` was added to the manager so a bad request is a 400 or 404 rather than a fault.

- **Routes** (`core/api/src/browser-profile-routes.ts`, session token only), under `/api/browser/*`: profile CRUD, per-profile sync opt-in, bookmark HTML import (256 KiB body limit), history, write-only credentials `PUT/DELETE …/credentials/:name`, publish, `POST /api/browser/sync/pull`, sync preview / accept / adopt, and extension list / approval / uninstall.
- **Sync** reuses the Phase 45 `SyncRuntime`, and only runs after account sync is configured **and** the profile opted in. The relay holds only sealed envelopes.
- **Credentials** never come back from any route and are deleted with the profile.
- **Delete** returns `purge_partition`: Core cannot clear a webview store that does not exist, so the host must purge the partition named by the profile.
- **Extension signers** come only from `RuntimeOptions.extensionSigners` (default none). No route can add one, so by default no extension can be installed. Installing checks the Ed25519 signature (`POST …/extensions`).
- **Approval.** Approving an extension asks the user through the permission gateway and the request blocks. Withdrawing approval and uninstalling never ask. Every `authorize()` is decided by the gateway; it fails closed, and the kill switch makes it answer no.
- **Privacy.** Profiles, bookmarks, history and credential names are privacy row `browser_profiles`.
- **Settings section:** `apps/web/src/components/BrowserProfilesSettings.tsx` (profiles, sync opt-in, import, publish, other devices, extensions).

Still the host's job: honor `partition` in a webview and purge it on delete, and provide the signer key map from Phoenix-controlled configuration.

## Limitations

- Evidence is simulated: two Cores in one test process share a fake relay and use the real `SyncRuntime` crypto. The exit criterion "bookmarks round-trip between two devices encrypted end to end" is demonstrated only in that simulation, not on real devices or a real relay.
- No browser engine, partition purge, extension sandbox (extension scripts are stored as data and never run), or signer distribution/revocation service exists.
- Sync stores one item per profile (last writer wins after a user-confirmed accept); there is no per-bookmark merge.
- The sync item value is limited by `SyncRuntime` to about 32 KB serialized, so very large profiles cannot be published.
