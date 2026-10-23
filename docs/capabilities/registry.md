# Local capability registry (index format 1)

The registry is a **signed local catalogue and pre-install disclosure**, not a remote marketplace. Nothing in index validation executes a capability or contacts a URL. Executable third-party installation is currently **refused**: loopback HTTP and a separate Node process are not an OS sandbox. A verified archive is not an installed capability. Existing runtime external registration is independent of registry verification; it must not be presented as sandboxed or as a registry install.

## Trust and index format

The host administrator explicitly provisions Ed25519 public keys under stable `key_id` values. Do not accept a public key from the HTTP request, the signed index, an artifact, or an automatically discovered marketplace. There is no bundled implicit trust anchor. Key rotation/revocation must be managed by the host: remove a compromised key from configuration and invalidate previously loaded indexes. Registry indexes should be obtained through a deliberately configured local directory; there is no network discovery or fetching. Do not expose an unsigned index as a verified index.

The UTF-8 index (maximum 1 MiB) is a JSON object with exactly `index`, `key_id`, `signature`. The URL-safe, unpadded Base64 `signature` is Ed25519 over UTF-8 of `index` serialized with recursively sorted object keys, JSON strings/numbers and preserved array order. Duplicate JSON object keys and ambiguous number representations are not permitted by the signing process; publishers should emit canonical JSON. `index` has exactly `format_version: 1` and `entries` (up to 1000). Each entry has exactly:

- `id`, `version`, and a complete protocol v1 `manifest` with matching ID/version;
- `permissions` and `data_categories`, exact set matches of manifest disclosures; data categories must be explicitly declared, including an empty array;
- `license`, exactly matching the manifest SPDX identifier;
- `compatibility`: minimum semver `sdk` and `core` within the host's same major version, plus exact protocol major `"1"` (matching the manifest's optional `compatibility.protocol`, whose omission means `"1"`);
- `artifact`: safe basename `file`, lowercase hex `sha256`, and nonzero `size` (at most 50 MiB);
- `security`: `contact` (`mailto:`) and HTTPS `advisory_url`.

For example, a publisher may construct an entry with `id: "example"`, `version: "1.0.0"`, an equivalent manifest, `permissions: ["network"]`, `data_categories: ["repository_metadata"]`, `license: "MIT"`, `compatibility: {"sdk":"0.1.0","core":"0.1.0","protocol":"1"}`, `artifact: {"file":"example.tar","sha256":"<64 lowercase hex digits>","size":32}`, and `security: {"contact":"mailto:security@example.org","advisory_url":"https://example.org/advisories"}`. The value is **illustrative and not signed**; never add its key to production trust configuration. Tests generate a fresh local key pair, sign an index in memory and hash an inert file.

`RegistryService.loadIndex(bytes)` verifies the configured signer before validating entries. `preview(verifiedIndex,id,version)` returns full manifest, permission descriptions, data categories, licence and `installable: false`; UI must display disclosures **before** any future install confirmation. `verifyLocalArtifact` opens a local regular file without following its final symlink and checks exact byte length and SHA-256 via streaming; it does not unpack, evaluate or install. Use a dedicated trusted directory with no attacker-write access (intermediate directory symlinks and concurrent replacement of trusted directories are outside this verifier's protection). Never treat hashes or signatures as proof of harmless code.

## Data-only skin packs

Index format 1 also accepts a discriminated `kind: "skin-pack"` entry. It has **exactly** `kind`, outfit-format `id`, semver `version`, `name`, `description`, artwork `license: "CC-BY-4.0"`, `compatibility` (`core` semver and protocol `"1"`), and `artifact` (`file`, lowercase SHA-256 and nonzero size at most 100 kB). It has no executable manifest, permissions, data categories or security links. This artwork policy is separate from, and does not extend, the executable GPL-compatibility allowlist.

The host must configure `PHOENIX_REGISTRY_TRUSTED_KEY_FILE`, `PHOENIX_REGISTRY_INDEX_FILE`, and `PHOENIX_REGISTRY_ARTIFACT_DIR` together. A skin install route accepts only the selected ID/version and no body, re-verifies the signed index, opens a safe-basename artifact from that host-owned directory with `O_NOFOLLOW`, confirms its realpath remains within the directory, and checks exact size and SHA-256 before strict UTF-8 JSON and `phoenix-outfit` validation. It never downloads, executes, loads or evaluates an artifact.

`POST /api/registry/skins/:id/:version/install` is authenticated and distinct from the permanently denied executable install route. It requires a PermissionGateway `write` confirmation naming the precise skin, version, licence, signer/index provenance and digest; the gateway audits authorization and the installed/failed outcome and refuses on a kill switch or missing grant. Core then calls `AppearanceRuntime.importPack`, retaining its built-in-ID, pack-count, byte-quota, persistence and wardrobe-change-event safeguards. The browser displays the data-only classification, licence, signer/index hash and artifact digest/size before sending this dedicated request; the Core approval is still required. This is local signed-fixture behavior only, not a community registry or real skin source.

## Licence policy

Phoenix is GPL-3.0-or-later. The reviewed, simple SPDX allowlist is GPL-3.0-only/or-later, LGPL-3.0-only/or-later, MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC. Unknown identifiers, licence expressions, proprietary licences, AGPL, and MPL are refused conservatively; the allowlist is a policy gate, **not** legal advice or a grant of redistribution rights. The publisher must provide source, copyright notices, dependency licences and any applicable reciprocal obligations separately. Changing the policy requires a legal/security review. Validating metadata cannot attest that an archive actually uses the declared licence.

## Reporting and health

Manifest `healthcheck` is a runtime poll contract only; a registry cannot remotely assess health without running code. For suspected malware, leaked credentials, inaccurate disclosures, or vulnerable capabilities: contact the entry's `security.contact` privately, include capability ID/version, digest and reproducible evidence without secrets; notify Phoenix maintainers through the repository's private security advisory channel. Maintainers should acknowledge, triage impact, revoke the signing key or remove the affected index entry, warn affected users, publish remediation and a public advisory at `advisory_url` after coordinated disclosure. Do not put exploit payloads or personal data in a public index. Indexes have no online revocation mechanism and cached copies remain trusted until the host removes the key/reloads the index; this is a release blocker for an open marketplace.

## v0.9 gate

The registry intentionally does **not** deliver executable third-party installs, automatic updates, a remote catalogue, key distribution, runtime isolation, artifact licence audits, key revocation distribution, or an end-user consent flow. A secure sandbox with enforced filesystem, network, process and credential isolation, publisher review, authenticated UI consent and threat-model review are required before changing `installable` or adding an install route. SDK/Core stability and external-user release validation remain separate release gates; do not describe a catalogue preview as the v0.9 release.
