// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { SecretStore, SettingsStore } from "@phoenix/persistence";
import { isRecord } from "../mcp/guards";
import { pinnedSigners, type ExtensionTrust, type TrustRefusal } from "./signer-registry";

export interface Bookmark {
  id: string;
  url: string;
  title: string;
}
export interface Visit {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}
export interface BrowserProfile {
  id: string;
  name: string;
  /** Host must use this as an isolated cookie/cache/local-storage/webview partition. Never synced. */
  partition: string;
  /** Off by default; a profile only reaches encrypted sync after an explicit opt-in. */
  syncEnabled: boolean;
  bookmarks: Bookmark[];
  history: Visit[];
}
export type ExtensionPermission = "pageAction" | "contentScript";
export interface ExtensionManifest {
  id: string;
  version: string;
  origins: string[];
  permissions: ExtensionPermission[];
  /** Script is data here; only a separately authorized sandboxed host may run it. */
  contentScript?: string;
}
export interface SignedExtension {
  manifest: ExtensionManifest;
  signer: string;
  /** Base64 Ed25519 signature over `canonicalManifest(manifest)`. */
  signature: string;
}
export interface InstalledExtension {
  manifest: ExtensionManifest;
  signer: string;
  /** The install-time signature, re-verified against the signer's current key on every use. */
  signature?: string;
  approved: boolean;
}
/** Why an installed extension is not trusted now; closed set, safe to show and log. */
export type ExtensionRefusal = TrustRefusal | "signature_missing" | "signature_invalid";
/**
 * An installed extension as reported: trust is recomputed from the signer registry on every read,
 * so a later revocation shows at once. `revoked`/`untrusted` extensions report `approved: false`
 * and can never be approved or authorised.
 */
export interface ExtensionView extends Omit<InstalledExtension, "signature"> {
  status: "trusted" | "revoked" | "untrusted";
  reason?: ExtensionRefusal;
}
interface State {
  profiles: BrowserProfile[];
  extensions: Record<string, InstalledExtension[]>;
  /** Credential names (never values) per profile so removal can purge the secret store. */
  credentials?: Record<string, string[]>;
}
export interface SyncItemView {
  id: string;
  scope: string;
  value: unknown;
  deleted: boolean;
  pending: boolean;
  conflict: unknown;
  revision: string;
}
/** Bind this to the encrypted Phase 45 SyncRuntime, never directly to a plaintext relay. */
export interface EncryptedProfileSync {
  status(): { enabled: boolean };
  upsert(input: { id: string; scope: string; data_class: "context"; value: unknown }): unknown;
  inspect(): { items: SyncItemView[] };
  resolve(id: string, scope: string, choice: "remote"): unknown;
  sync(): Promise<unknown>;
}
export interface PermissionDecision {
  (request: {
    profileId: string;
    extensionId: string;
    permission: ExtensionPermission;
    origin: string;
  }): Promise<boolean>;
}
export interface BookmarkImportResult {
  bookmarks: Bookmark[];
  skipped: number;
}

/** Upper bound for bookmarks and history entries per profile (also the sync-accept bound). */
export const MAX_PROFILE_ENTRIES = 10_000;
const MAX_IMPORT_HTML = 2_000_000;
const STATE_KEY = "browser.profiles.v1";
const SYNC_PREFIX = "browser:";
const syncId = (id: string): string => `${SYNC_PREFIX}${id}`;
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validVersion = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,9}\.\d{1,9}\.\d{1,9}(-[0-9A-Za-z.-]{1,40})?$/.test(value);
const validUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
const copy = <T>(value: T): T => structuredClone(value);
/** A refusal with a fixed, safe message; anything else thrown here is a fault, not a bad request. */
export class ProfileError extends Error {
  constructor(
    message: string,
    readonly missing = false,
  ) {
    super(message);
    this.name = "ProfileError";
  }
}
function requireValid(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ProfileError(message, message.startsWith("Unknown "));
}
function bookmark(value: unknown): Bookmark {
  requireValid(
    isRecord(value) &&
      validId(value.id) &&
      validUrl(value.url) &&
      typeof value.title === "string" &&
      value.title.length <= 512,
    "Invalid bookmark",
  );
  const entry = value as unknown as Bookmark;
  return { id: entry.id, url: entry.url, title: entry.title };
}
function visit(value: unknown): Visit {
  const base = bookmark(value);
  const visitedAt = isRecord(value) ? value.visitedAt : undefined;
  requireValid(
    typeof visitedAt === "number" && Number.isSafeInteger(visitedAt) && visitedAt >= 0,
    "Invalid visit",
  );
  return { ...base, visitedAt };
}
function itemsUnique<T extends { id: string }>(items: T[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}
function validOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const target = new URL(value);
    return (
      (target.protocol === "https:" || target.protocol === "http:") &&
      target.origin === value &&
      // WHATWG URL accepts "*" in hosts; origins here are exact, never patterns.
      !/[*%\s]/.test(target.hostname)
    );
  } catch {
    return false;
  }
}

/** Bytes a signer must sign: fixed field order, so key order in the input cannot alter the digest. */
export function canonicalManifest(manifest: ExtensionManifest): string {
  return JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    origins: manifest.origins,
    permissions: manifest.permissions,
    contentScript: manifest.contentScript ?? null,
  });
}
const MANIFEST_KEYS = ["id", "version", "origins", "permissions", "contentScript"];
/** Validates and returns only the known, signed fields; unknown fields are rejected, never stored. */
function normalizeManifest(raw: unknown): ExtensionManifest {
  requireValid(
    isRecord(raw) && Object.keys(raw).every((key) => MANIFEST_KEYS.includes(key)),
    "Invalid extension manifest",
  );
  const manifest = raw as Record<string, unknown>;
  const { id, version, origins, permissions, contentScript } = manifest;
  requireValid(
    validId(id) &&
      validVersion(version) &&
      Array.isArray(origins) &&
      origins.length > 0 &&
      origins.length <= 50 &&
      origins.every(validOrigin) &&
      Array.isArray(permissions) &&
      permissions.length > 0 &&
      permissions.every((item) => item === "pageAction" || item === "contentScript") &&
      (contentScript === undefined ||
        (typeof contentScript === "string" &&
          contentScript.length <= 100_000 &&
          permissions.includes("contentScript"))),
    "Invalid extension manifest",
  );
  return {
    id: id as string,
    version: version as string,
    origins: [...(origins as string[])],
    permissions: [...(permissions as ExtensionPermission[])],
    ...(contentScript === undefined ? {} : { contentScript: contentScript as string }),
  };
}

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (whole, code: string) => {
    if (code === "amp") return "&";
    if (code === "lt") return "<";
    if (code === "gt") return ">";
    if (code === "quot") return '"';
    if (code === "apos") return "'";
    const point = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : whole;
  });
/**
 * Parses the Netscape bookmark HTML that browsers export. Pure text in, data out: it never reads
 * another browser's files, and only http(s) links without embedded credentials are kept.
 */
export function parseBookmarkHtml(html: string): BookmarkImportResult {
  requireValid(
    typeof html === "string" && html.length <= MAX_IMPORT_HTML,
    "Invalid bookmark import",
  );
  const lower = html.toLowerCase();
  const found = new Map<string, Bookmark>();
  let skipped = 0;
  let cursor = 0;
  for (;;) {
    const open = lower.indexOf("<a ", cursor);
    if (open < 0) break;
    const tagEnd = lower.indexOf(">", open);
    if (tagEnd < 0) break;
    const close = lower.indexOf("</a>", tagEnd);
    if (close < 0) break;
    cursor = close + 4;
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(html.slice(open, tagEnd))?.[1];
    const url = href === undefined ? "" : decodeEntities(href).trim();
    if (!validUrl(url)) {
      skipped += 1;
      continue;
    }
    if (found.size >= MAX_PROFILE_ENTRIES) {
      skipped += 1;
      continue;
    }
    const text = decodeEntities(html.slice(tagEnd + 1, close).replace(/<[^>]*>/g, "")).trim();
    const id = createHash("sha256").update(url).digest("hex").slice(0, 32);
    if (!found.has(id)) found.set(id, { id, url, title: (text || url).slice(0, 512) });
  }
  return { bookmarks: [...found.values()], skipped };
}

interface SyncedProfile {
  name: string;
  bookmarks: Bookmark[];
  history: Visit[];
}
function parseSynced(id: string, value: unknown): SyncedProfile {
  requireValid(
    isRecord(value) &&
      value.id === id &&
      typeof value.name === "string" &&
      value.name.trim().length > 0 &&
      value.name.length <= 80 &&
      Array.isArray(value.bookmarks) &&
      Array.isArray(value.history) &&
      value.bookmarks.length <= MAX_PROFILE_ENTRIES &&
      value.history.length <= MAX_PROFILE_ENTRIES,
    "Invalid synced profile",
  );
  const bookmarks = value.bookmarks.map(bookmark);
  const history = value.history.map(visit);
  requireValid(itemsUnique(bookmarks) && itemsUnique(history), "Duplicate synced entries");
  return { name: value.name.trim(), bookmarks, history };
}
type Evaluation = { trusted: true } | { trusted: false; reason: ExtensionRefusal };
/** sha256 hex of the signed bytes: what a registry revocation of a manifest names. */
export function manifestSha256(manifest: ExtensionManifest): string {
  return createHash("sha256").update(canonicalManifest(manifest)).digest("hex");
}
function validSignature(
  manifest: ExtensionManifest,
  signature: string,
  publicKey: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalManifest(manifest)),
      createPublicKey(publicKey),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false; // A malformed key or signature is an invalid signature.
  }
}
function view(extension: InstalledExtension, evaluation: Evaluation): ExtensionView {
  const shown = { manifest: extension.manifest, signer: extension.signer };
  if (evaluation.trusted) return { ...shown, approved: extension.approved, status: "trusted" };
  const revoked =
    evaluation.reason === "signer_revoked" || evaluation.reason === "manifest_revoked";
  return {
    ...shown,
    approved: false,
    status: revoked ? "revoked" : "untrusted",
    reason: evaluation.reason,
  };
}

interface Candidate {
  value: unknown;
  /** True when the revision is a staged remote conflict that must be resolved to the remote side. */
  fromConflict: boolean;
}

/** Local-first data and capability policy. No network, browser or host OS operation occurs here. */
export class BrowserProfileManager {
  constructor(
    private readonly settings: Pick<SettingsStore, "get" | "set">,
    private readonly secrets: SecretStore,
    private readonly syncAdapter?: EncryptedProfileSync,
    /**
     * Who may sign extensions, asked at install and again on every read and `authorize`. A
     * `SignerRegistry` adds revocation and expiry; `pinnedSigners(map)` is a static host map.
     */
    private readonly trust: ExtensionTrust = pinnedSigners({}),
    private readonly permission?: PermissionDecision,
  ) {}
  private state(): State {
    return this.settings.get<State>(STATE_KEY, { profiles: [], extensions: {} });
  }
  private save(state: State): void {
    this.settings.set(STATE_KEY, state);
  }
  private profile(state: State, id: string): BrowserProfile {
    const profile = state.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new ProfileError("Unknown browser profile", true);
    return profile;
  }
  list(): BrowserProfile[] {
    return copy(this.state().profiles);
  }
  create(name: string): BrowserProfile {
    requireValid(
      typeof name === "string" && name.trim().length > 0 && name.length <= 80,
      "Invalid profile name",
    );
    const state = this.state();
    const profile: BrowserProfile = {
      id: randomUUID(),
      name: name.trim(),
      partition: randomUUID(),
      syncEnabled: false,
      bookmarks: [],
      history: [],
    };
    state.profiles.push(profile);
    this.save(state);
    return copy(profile);
  }
  /**
   * Deletes the profile, its extensions and every credential saved through putCredential. The host
   * must still purge its web partition (cookies, cache, storage) named by `partition`.
   */
  async remove(id: string): Promise<void> {
    const state = this.state();
    this.profile(state, id);
    for (const name of state.credentials?.[id] ?? []) {
      await this.secrets.delete(`browser.profile.${id}.${name}`);
    }
    state.profiles = state.profiles.filter((profile) => profile.id !== id);
    delete state.extensions[id];
    delete state.credentials?.[id];
    this.save(state);
  }
  setSync(id: string, enabled: boolean): void {
    requireValid(typeof enabled === "boolean", "Invalid sync preference");
    const state = this.state();
    this.profile(state, id).syncEnabled = enabled;
    this.save(state);
  }
  addBookmark(id: string, input: Bookmark): void {
    const state = this.state();
    const profile = this.profile(state, id);
    const entry = bookmark(input);
    const next = [...profile.bookmarks.filter((item) => item.id !== entry.id), entry];
    requireValid(next.length <= MAX_PROFILE_ENTRIES, "Too many bookmarks");
    profile.bookmarks = next;
    this.save(state);
  }
  /** History keeps the newest MAX_PROFILE_ENTRIES visits; older ones are dropped. */
  recordVisit(id: string, input: Visit): void {
    const state = this.state();
    const profile = this.profile(state, id);
    const entry = visit(input);
    profile.history = [...profile.history.filter((item) => item.id !== entry.id), entry].slice(
      -MAX_PROFILE_ENTRIES,
    );
    this.save(state);
  }
  /** Import only an explicitly supplied parsed bookmark list; never read another browser's files. */
  importBookmarks(id: string, entries: Bookmark[]): number {
    requireValid(
      Array.isArray(entries) && entries.length <= MAX_PROFILE_ENTRIES,
      "Invalid bookmark import",
    );
    const validated = entries.map(bookmark);
    requireValid(itemsUnique(validated), "Duplicate bookmark identifiers");
    const state = this.state();
    const profile = this.profile(state, id);
    const next = [
      ...profile.bookmarks.filter((item) => !validated.some((entry) => entry.id === item.id)),
      ...validated,
    ];
    requireValid(next.length <= MAX_PROFILE_ENTRIES, "Too many bookmarks");
    profile.bookmarks = next;
    this.save(state);
    return validated.length;
  }
  /** Import the text of a browser's exported bookmark HTML; returns how many entries were imported. */
  importBookmarkHtml(id: string, html: string): { imported: number; skipped: number } {
    const parsed = parseBookmarkHtml(html);
    return { imported: this.importBookmarks(id, parsed.bookmarks), skipped: parsed.skipped };
  }
  /** Credentials live only in the secret store, namespaced by profile; never in settings or sync. */
  async putCredential(profileId: string, name: string, value: string): Promise<void> {
    const state = this.state();
    this.profile(state, profileId);
    requireValid(
      validId(name) && typeof value === "string" && value.length > 0,
      "Invalid credential",
    );
    const names = state.credentials?.[profileId] ?? [];
    if (!names.includes(name)) {
      state.credentials = { ...state.credentials, [profileId]: [...names, name] };
      this.save(state);
    }
    await this.secrets.set(`browser.profile.${profileId}.${name}`, value);
  }
  async getCredential(profileId: string, name: string): Promise<string | undefined> {
    this.profile(this.state(), profileId);
    requireValid(validId(name), "Invalid credential key");
    return this.secrets.get(`browser.profile.${profileId}.${name}`);
  }
  async deleteCredential(profileId: string, name: string): Promise<void> {
    const state = this.state();
    this.profile(state, profileId);
    requireValid(validId(name), "Invalid credential key");
    await this.secrets.delete(`browser.profile.${profileId}.${name}`);
    if (state.credentials?.[profileId]?.includes(name)) {
      state.credentials[profileId] = state.credentials[profileId].filter((item) => item !== name);
      this.save(state);
    }
  }
  private adapter(): EncryptedProfileSync {
    requireValid(this.syncAdapter?.status().enabled === true, "Encrypted sync is disabled");
    return this.syncAdapter as EncryptedProfileSync;
  }
  private syncReady(id: string): EncryptedProfileSync {
    const profile = this.profile(this.state(), id);
    requireValid(profile.syncEnabled, "Encrypted sync is disabled");
    return this.adapter();
  }
  /** Sync only explicitly opted-in bookmarks/history; excludes credentials, extensions and partition. */
  async publish(id: string): Promise<void> {
    const adapter = this.syncReady(id);
    const profile = this.profile(this.state(), id);
    adapter.upsert({
      id: syncId(id),
      scope: "owner",
      data_class: "context",
      value: { id, name: profile.name, bookmarks: profile.bookmarks, history: profile.history },
    });
    await adapter.sync();
  }
  /** Download the latest encrypted remote state into staging; no profile data changes until accept/adopt. */
  async pull(): Promise<void> {
    await this.adapter().sync();
  }
  private syncItem(adapter: EncryptedProfileSync, id: string): SyncItemView | undefined {
    const item = adapter
      .inspect()
      .items.find((entry) => entry.id === syncId(id) && entry.scope === "owner");
    return item ? copy(item) : undefined;
  }
  /** Remote data is staged: caller must preview, then accept the exact revision. */
  preview(id: string): SyncItemView | undefined {
    return this.syncItem(this.syncReady(id), id);
  }
  /** Profiles present in synced storage but not created on this device yet. */
  remoteProfiles(): { id: string; name: string; revision: string }[] {
    const adapter = this.adapter();
    const local = new Set(this.state().profiles.map((profile) => profile.id));
    const found: { id: string; name: string; revision: string }[] = [];
    for (const item of adapter.inspect().items) {
      if (item.scope !== "owner" || item.deleted || !item.id.startsWith(SYNC_PREFIX)) continue;
      const id = item.id.slice(SYNC_PREFIX.length);
      if (!validId(id) || local.has(id)) continue;
      try {
        found.push({ id, name: parseSynced(id, item.value).name, revision: item.revision });
      } catch {
        // Malformed remote data is ignored here; accept/adopt would reject it with an error.
      }
    }
    return found;
  }
  private candidate(item: SyncItemView | undefined, revision: string): Candidate {
    requireValid(!!item && typeof revision === "string", "No synced profile");
    if (isRecord(item.conflict)) {
      requireValid(
        item.conflict.deleted === false && item.conflict.revision === revision,
        "Synced profile changed or is conflicted",
      );
      return { value: item.conflict.value, fromConflict: true };
    }
    requireValid(
      !item.conflict && !item.deleted && !item.pending && item.revision === revision,
      "Synced profile changed or is conflicted",
    );
    return { value: item.value, fromConflict: false };
  }
  /**
   * Replace this profile's bookmarks and history with the exact previewed remote revision. A staged
   * remote update (conflict) is accepted by resolving to the remote side, discarding local edits.
   */
  accept(id: string, revision: string): void {
    const adapter = this.syncReady(id);
    const found = this.candidate(this.syncItem(adapter, id), revision);
    const synced = parseSynced(id, found.value);
    if (found.fromConflict) adapter.resolve(syncId(id), "owner", "remote");
    const state = this.state();
    const profile = this.profile(state, id);
    profile.bookmarks = synced.bookmarks;
    profile.history = synced.history;
    this.save(state);
  }
  /**
   * Create a local profile from a remote one on this device. The partition is fresh and local, and
   * sync is enabled for it because the user explicitly chose to adopt it.
   */
  adopt(id: string, revision: string): BrowserProfile {
    const adapter = this.adapter();
    requireValid(validId(id), "Invalid profile id");
    const state = this.state();
    requireValid(!state.profiles.some((profile) => profile.id === id), "Profile already exists");
    const found = this.candidate(this.syncItem(adapter, id), revision);
    const synced = parseSynced(id, found.value);
    if (found.fromConflict) adapter.resolve(syncId(id), "owner", "remote");
    const profile: BrowserProfile = {
      id,
      name: synced.name,
      partition: randomUUID(),
      syncEnabled: true,
      bookmarks: synced.bookmarks,
      history: synced.history,
    };
    state.profiles.push(profile);
    this.save(state);
    return copy(profile);
  }
  /** Verifies the signature and stores the extension unapproved; it cannot run until approve(). */
  install(profileId: string, extension: SignedExtension): ExtensionView {
    this.profile(this.state(), profileId);
    requireValid(isRecord(extension), "Invalid extension manifest");
    const manifest = normalizeManifest(extension.manifest);
    const { signer, signature } = extension;
    requireValid(validId(signer), "Untrusted extension signer");
    const decision = this.trust.resolve(signer, manifestSha256(manifest));
    if (!decision.trusted) {
      requireValid(decision.reason !== "unknown_signer", "Untrusted extension signer");
      throw new ProfileError(`Extension refused: ${decision.reason}`);
    }
    requireValid(
      typeof signature === "string" &&
        signature.length <= 1024 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(signature),
      "Invalid extension signature",
    );
    requireValid(
      validSignature(manifest, signature, decision.publicKey),
      "Invalid extension signature",
    );
    const state = this.state();
    const installed: InstalledExtension = { manifest, signer, signature, approved: false };
    state.extensions[profileId] = [
      ...(state.extensions[profileId] ?? []).filter((item) => item.manifest.id !== manifest.id),
      installed,
    ];
    this.save(state);
    return copy(view(installed, { trusted: true }));
  }
  approve(profileId: string, extensionId: string, approved: boolean): void {
    requireValid(typeof approved === "boolean", "Invalid extension approval");
    const state = this.state();
    this.profile(state, profileId);
    const extension = state.extensions[profileId]?.find((item) => item.manifest.id === extensionId);
    requireValid(!!extension, "Unknown extension");
    const found = extension as InstalledExtension;
    // Only a trusted extension can be approved; withdrawing approval is always allowed.
    requireValid(!approved || this.evaluate(found).trusted, "Untrusted extension signer");
    found.approved = approved;
    this.save(state);
  }
  uninstall(profileId: string, extensionId: string): void {
    const state = this.state();
    this.profile(state, profileId);
    const before = state.extensions[profileId] ?? [];
    requireValid(
      before.some((item) => item.manifest.id === extensionId),
      "Unknown extension",
    );
    state.extensions[profileId] = before.filter((item) => item.manifest.id !== extensionId);
    this.save(state);
  }
  /**
   * Installed extensions with trust recomputed now: a signer or manifest revoked after install
   * reads `revoked` here and reports `approved: false`, whatever was stored.
   */
  extensions(profileId: string): ExtensionView[] {
    this.profile(this.state(), profileId);
    return (this.state().extensions[profileId] ?? []).map((item) =>
      copy(view(item, this.evaluate(item))),
    );
  }
  private evaluate(extension: InstalledExtension): Evaluation {
    const decision = this.trust.resolve(extension.signer, manifestSha256(extension.manifest));
    if (!decision.trusted) return { trusted: false, reason: decision.reason };
    if (extension.signature === undefined) return { trusted: false, reason: "signature_missing" };
    // The stored signature must verify under the signer's key as it is now (rotation included).
    if (!validSignature(extension.manifest, extension.signature, decision.publicKey))
      return { trusted: false, reason: "signature_invalid" };
    return { trusted: true };
  }
  /**
   * Gate each operation again; fails closed. The extension must be approved, still signed by a
   * trusted signer, declare the permission and exact origin, and the permission gateway must agree.
   * The host must sandbox execution and audit the decision.
   */
  async authorize(
    profileId: string,
    extensionId: string,
    permission: ExtensionPermission,
    origin: string,
  ): Promise<boolean> {
    this.profile(this.state(), profileId);
    const extension = this.state().extensions[profileId]?.find(
      (item) => item.manifest.id === extensionId,
    );
    if (
      !extension?.approved ||
      !this.evaluate(extension).trusted ||
      !extension.manifest.permissions.includes(permission) ||
      !validOrigin(origin) || // origins match exactly; there are no wildcards
      !extension.manifest.origins.includes(origin) ||
      !this.permission
    )
      return false;
    return this.permission({ profileId, extensionId, permission, origin });
  }
}
