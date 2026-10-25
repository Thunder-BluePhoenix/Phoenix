# Browser profiles, sync and extensions (Phase 96)

Module: `core/runtime/src/browser-profiles/index.ts` (`BrowserProfileManager`). Tests: `core/runtime/test/browser-profiles.test.ts` (manager) and `core/runtime/test/browser-profiles-wiring.test.ts` (10, through a real running Core, two Cores sharing a fake relay).

The manager is local-first policy and data logic. It performs no network, browser or OS operation of its own. Core now wires it (see "How it is wired"). Core never opens a page or clears a webview store; the host shell does that, and nothing here ran on a real webview. No sandbox that runs extension code exists in Core.

## Profiles and isolation

- `create(name)` makes a profile (work, personal, testing …) with a random `id` and a random `partition`. The host MUST use `partition` as the isolated cookie / cache / local-storage / webview partition, so profiles never share web state. The partition is local only and is never synced.
- Bookmarks (`addBookmark`) and history (`recordVisit`) belong to exactly one profile. Only `http(s)` URLs without embedded credentials are accepted; ids match `[A-Za-z0-9_-]{1,80}`; each list is capped at 10 000 entries (history keeps the newest).
- State is stored through `SettingsStore` under `browser.profiles.v1`. It contains no secrets.
- `remove(id)` deletes the profile, its extensions and every credential saved through `putCredential`. The profile's saved **web data** is not in Core: `BrowserProfilesService.remove` puts the profile id on the durable pending-purge queue (below) for the Phoenix browser window to act on. `adopt` refuses the reserved id `private` (always the incognito tab) and any id still on that queue.

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

1. `install(profileId, signedExtension)` asks the manager's trust source (`ExtensionTrust`: a `SignerRegistry`, or `pinnedSigners(map)` for a static host map) whether the signer may sign this manifest, then verifies an Ed25519 signature over `canonicalManifest(manifest)` (fixed field order) against the key it returns. Unknown manifest fields, untrusted/revoked/expired signers, revoked manifests, malformed keys/signatures and tampered manifests are rejected. The extension is stored **unapproved**, with its signature, so it can be re-verified later.
2. `approve(profileId, extensionId, true)` is the explicit user approval. Re-installing (e.g. a new version) resets approval.
3. `authorize(profileId, extensionId, permission, origin)` is checked on every operation and fails closed: the extension must be approved, its signer and manifest hash still trusted **now** (registry re-consulted, signature re-verified under the signer's current key), the permission and exact origin declared, and the injected `PermissionDecision` (the permission/tool gateway, which also audits) must agree. Without a gateway the answer is always `false`.

The `contentScript` text is data. Only a host-side sandbox that has received a positive `authorize` may run it. The extension list, install, approval and uninstall replies never include the script text (`withoutScript` in the service); the only route that returns it is the content-scripts route below.

## Signer registry, distribution and revocation

`core/runtime/src/browser-profiles/signer-registry.ts`. Offline, like the capability registry ([capabilities/registry.md](capabilities/registry.md)): there is **no network code**. Distribution is a signed JSON file that the Core host puts on disk and Core reads.

- **Root key.** An Ed25519 public key (SPKI PEM) pinned by whoever builds Core (`RuntimeOptions.extensionSignerRegistry.rootPublicKey`; `main.ts` reads it from the file named by `PHOENIX_EXTENSION_SIGNER_ROOT_KEY_FILE`). It is never fetched and never read from the document. `PHOENIX_EXTENSION_SIGNER_REGISTRY_FILE` names the registry file; both variables are required together. When set, the registry **replaces** `extensionSigners`.
- **Document.** `{ "registry": {...}, "signature": base64url }`, at most 256 KiB. The signature is Ed25519 over `canonicalJson(registry)` (the repo's `@phoenix/workflows` canonicaliser). Body: `format_version: 1`, `sequence` (integer >= 1), `issued_at`, `expires_at` (ISO UTC milliseconds, lifetime at most 90 days), up to 200 `signers` (`id`, `public_key`, `valid_from`, optional `expires_at`, `status` `active|disabled`) and up to 1000 `revocations` (`kind` `signer|manifest`, `target` = signer id or sha256 hex of `canonicalManifest`, `revoked_at` not after `issued_at`, `reason` from the closed set `key_compromise | malicious_extension | vulnerability | superseded | policy_violation | signer_retired`). Unknown fields anywhere, duplicate ids, non-Ed25519 keys and every other malformed field are refused.
- **Refusal codes** (the whole error message; no ids, bytes or key material): `INVALID_ROOT_KEY, OVERSIZE, MALFORMED, UNKNOWN_FIELD, INVALID_FIELD, DUPLICATE_ID, BAD_SIGNATURE, ROLLBACK, EXPIRED, NOT_YET_VALID, STORAGE`. A refused document leaves the previous one in force.
- **Rollback.** A document must have a `sequence` above the last accepted one. The last accepted sequence and document are persisted in the settings store (`browser.signer-registry.v1`, the same store that holds profile state), tagged with a fingerprint of the root. On start the stored document is **re-verified** against the pinned root, so a doctored row cannot add a signer. Re-reading the identical accepted bytes is a no-op.
- **Expiry.** A document past `expires_at` is not accepted, and once the accepted one expires every extension is refused (`registry_expired`) until a fresher document is loaded. With no document loaded the answer is `registry_missing`. A document issued more than five minutes in the future is refused.
- **Decisions** (`resolve(signer, manifestSha256)`): `unknown_signer, signer_revoked, manifest_revoked, signer_disabled, signer_expired, signer_not_yet_valid, registry_missing, registry_expired`. Revocation outranks everything else.
- **Retroactive revocation.** Trust is recomputed on every `extensions()` read and every `authorize()`. An installed extension whose signer or manifest hash is revoked reads `status: "revoked"` (`reason` is the closed code) with `approved: false`, cannot be approved again, and `authorize()` answers `false`; one that is merely no longer trusted (expired signer or document, key rotation that invalidates its stored signature, an extension stored before signatures were kept) reads `status: "untrusted"`. Withdrawing approval and uninstalling still work. The signature itself is never returned by a route.
- **Loading.** `BrowserProfilesService.loadSignerRegistry()` reads the host file (no symlinks, size-capped) and activates it; Core calls it at start and logs only the error message when it is refused (Core still starts, with extensions untrusted). No HTTP route loads or changes the registry. A running Core picks up a new file only when `loadSignerRegistry()` is called again; there is no file watcher and no scheduled refresh.
- **Settings UI.** The extension list shows "Revoked" / "Signer not trusted" and disables Approve for them (strings machine-translated and unreviewed in the eight non-English locales).

Evidence is simulated: `core/runtime/test/signer-registry.test.ts` (25 tests, keys generated at test time) and two wiring tests in `browser-profiles-wiring.test.ts` that write registry files to a temp directory.

## How it is wired

`BrowserProfilesService` (`core/runtime/src/browser-profiles/service.ts`) constructs the manager in the runtime. It needs the OS secret store (without one the routes answer 503). `ProfileError` was added to the manager so a bad request is a 400 or 404 rather than a fault.

- **Routes** (`core/api/src/browser-profile-routes.ts`, session token only), under `/api/browser/*`: profile CRUD, per-profile sync opt-in, bookmark HTML import (256 KiB body limit), history, write-only credentials `PUT/DELETE …/credentials/:name`, publish, `POST /api/browser/sync/pull`, sync preview / accept / adopt, and extension list / approval / uninstall.
- **Sync** reuses the Phase 45 `SyncRuntime`, and only runs after account sync is configured **and** the profile opted in. The relay holds only sealed envelopes.
- **Credentials** never come back from any route and are deleted with the profile.
- **Delete** returns `{ removed: true, purge_partition, purge: { profile_id, status: "pending" } }` (`purge_partition` is kept for compatibility). Core cannot clear a webview store and the Settings page runs outside the Phoenix browser chrome window, which is the only caller the Rust shell lets use `purge_profile_data`. So Core records the removed profile id in `ProfilePurgeQueue` (`core/runtime/src/browser-profiles/purges.ts`, settings key `browser.profile-purges.v1`: ids `[A-Za-z0-9_-]{1,80}`, deduplicated, at most 2000 (the oldest drops first), a corrupt stored value reads as empty). The browser chrome page (`apps/web/src/browser/BrowserApp.tsx`) reads `GET /api/browser/profile-purges` (`{ pending: string[] }`) on mount and every 5 s, calls the shell's `purge_profile_data` for each id one at a time, and only on success calls `POST /api/browser/profile-purges/:id/done` (idempotent, same id check, returns `{ pending }`). `busy` and `purge_failed` leave the id pending and it is retried on the next tick; a status line shows while a purge runs or has failed. If the browser window is never opened the purge stays pending, and Settings says so ("Saved web data of N removed profile(s) is waiting to be deleted. Open the Phoenix browser to finish."). Both routes are session-token only.
- **Content scripts for the shell.** `GET /api/browser/profiles/:id/content-scripts/:origin` (`:origin` is one percent-encoded path segment such as `https%3A%2F%2Fexample.com`; the router decodes it after splitting on `/`) returns `{ scripts: [{ extension, version, origins, script }] }`. Only exact `https:` origins are served (anything else is a 400, an unknown profile a 404). `BrowserProfileManager.contentScripts` picks installed extensions that declare the `contentScript` permission, have a script and list that exact origin, then calls `authorize(profile, extension, "contentScript", origin)` for each (approval, signer or registry trust re-checked now, signature re-verified, exact origin, permission gateway, which audits). A script is included only after a positive answer; an unapproved, revoked, untrusted, kill-switched or denied extension is simply absent, and an unexpected error fails the whole request rather than returning a partial list. At most 8 scripts per answer. Script text is not logged or audited.
- **Extension signers** come only from the host: `RuntimeOptions.extensionSignerRegistry` (signed registry, above) or else `RuntimeOptions.extensionSigners` (static map, default none, no revocation). No route can add one, so by default no extension can be installed. Installing checks the Ed25519 signature (`POST …/extensions`).
- **Approval.** Approving an extension asks the user through the permission gateway and the request blocks. Withdrawing approval and uninstalling never ask. Every `authorize()` is decided by the gateway; it fails closed, and the kill switch makes it answer no.
- **Privacy.** Profiles, bookmarks, history and credential names are privacy row `browser_profiles`.
- **Settings section:** `apps/web/src/components/BrowserProfilesSettings.tsx` (profiles, sync opt-in, import, publish, other devices, extensions).

Still the host's job: honor the per-profile web store in the webview (the Rust shell keys it by profile id), delete it when `purge_profile_data` is called, inject the returned content scripts, and provide the signer key map from Phoenix-controlled configuration.

## Limitations

- Evidence is simulated: two Cores in one test process share a fake relay and use the real `SyncRuntime` crypto. The exit criterion "bookmarks round-trip between two devices encrypted end to end" is demonstrated only in that simulation, not on real devices or a real relay.
- Everything about the purge hand-off and content scripts is simulated: the Core queue, the routes and the chrome purge loop are tested against Core's real test harness and a fake shell, and nothing ran on a real webview, display or Tauri window, so no web data was ever actually deleted and no script was ever injected into a real page. Extension scripts are stored as data and Core never runs them; there is no extension sandbox in Core. Signer distribution is a host-supplied file; there is no network fetch, no scheduled refresh and no signing tool or issuing service for the registry (the root key holder must produce documents elsewhere). The static `extensionSigners` map still has no revocation.
- Sync stores one item per profile (last writer wins after a user-confirmed accept); there is no per-bookmark merge.
- The sync item value is limited by `SyncRuntime` to about 32 KB serialized, so very large profiles cannot be published.
