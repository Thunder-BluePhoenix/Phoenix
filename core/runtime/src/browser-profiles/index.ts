// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createPublicKey, randomUUID, verify } from "node:crypto";
import type { SecretStore, SettingsStore } from "@phoenix/persistence";

export interface Bookmark { id: string; url: string; title: string; }
export interface Visit { id: string; url: string; title: string; visitedAt: number; }
export interface BrowserProfile {
  id: string;
  name: string;
  /** Host must use this as an isolated cookie/cache/local-storage/webview partition. */
  partition: string;
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
  signature: string;
}
export interface InstalledExtension {
  manifest: ExtensionManifest;
  signer: string;
  approved: boolean;
}
interface State { profiles: BrowserProfile[]; extensions: Record<string, InstalledExtension[]>; }
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
  sync(): Promise<unknown>;
}
export interface PermissionDecision {
  (request: { profileId: string; extensionId: string; permission: ExtensionPermission; origin: string }): Promise<boolean>;
}
const STATE_KEY = "browser.profiles.v1";
const validId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validUrl = (value: string): boolean => {
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
};
const copy = <T>(value: T): T => structuredClone(value);
function requireValid(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function bookmark(value: Bookmark): Bookmark {
  requireValid(validId(value.id) && validUrl(value.url) && typeof value.title === "string" && value.title.length <= 512, "Invalid bookmark");
  return { id: value.id, url: value.url, title: value.title };
}
function visit(value: Visit): Visit {
  bookmark(value);
  requireValid(Number.isSafeInteger(value.visitedAt) && value.visitedAt >= 0, "Invalid visit");
  return { ...bookmark(value), visitedAt: value.visitedAt };
}
function itemsUnique<T extends { id: string }>(items: T[]): boolean { return new Set(items.map((item) => item.id)).size === items.length; }
function originMatches(pattern: string, origin: string): boolean {
  try {
    const target = new URL(origin);
    return target.origin === origin && (target.protocol === "https:" || target.protocol === "http:") && pattern === origin;
  } catch { return false; }
}

/** Local-first data and capability policy. No network, browser or host OS operation occurs here. */
export class BrowserProfileManager {
  constructor(
    private readonly settings: Pick<SettingsStore, "get" | "set">,
    private readonly secrets: SecretStore,
    private readonly syncAdapter?: EncryptedProfileSync,
    private readonly trustedSigners: Readonly<Record<string, string>> = {},
    private readonly permission?: PermissionDecision,
  ) {}
  private state(): State { return this.settings.get<State>(STATE_KEY, { profiles: [], extensions: {} }); }
  private save(state: State): void { this.settings.set(STATE_KEY, state); }
  private profile(state: State, id: string): BrowserProfile {
    const profile = state.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error("Unknown browser profile");
    return profile;
  }
  list(): BrowserProfile[] { return copy(this.state().profiles); }
  create(name: string): BrowserProfile {
    requireValid(typeof name === "string" && name.trim().length > 0 && name.length <= 80, "Invalid profile name");
    const state = this.state();
    const profile: BrowserProfile = { id: randomUUID(), name: name.trim(), partition: randomUUID(), syncEnabled: false, bookmarks: [], history: [] };
    state.profiles.push(profile); this.save(state); return copy(profile);
  }
  remove(id: string): void {
    const state = this.state(); this.profile(state, id);
    state.profiles = state.profiles.filter((profile) => profile.id !== id);
    delete state.extensions[id]; this.save(state);
    // The host is responsible for purging its partition and all associated OS credentials.
  }
  setSync(id: string, enabled: boolean): void {
    requireValid(typeof enabled === "boolean", "Invalid sync preference");
    const state = this.state(); this.profile(state, id).syncEnabled = enabled; this.save(state);
  }
  addBookmark(id: string, input: Bookmark): void {
    const state = this.state(); const profile = this.profile(state, id);
    const entry = bookmark(input);
    profile.bookmarks = [...profile.bookmarks.filter((item) => item.id !== entry.id), entry]; this.save(state);
  }
  recordVisit(id: string, input: Visit): void {
    const state = this.state(); const profile = this.profile(state, id);
    const entry = visit(input);
    profile.history = [...profile.history.filter((item) => item.id !== entry.id), entry]; this.save(state);
  }
  /** Import only an explicitly supplied parsed bookmark list; never read another browser's files. */
  importBookmarks(id: string, entries: Bookmark[]): number {
    requireValid(Array.isArray(entries) && entries.length <= 10000, "Invalid bookmark import");
    const validated = entries.map(bookmark);
    requireValid(itemsUnique(validated), "Duplicate bookmark identifiers");
    const state = this.state(); const profile = this.profile(state, id);
    profile.bookmarks = [...profile.bookmarks.filter((item) => !validated.some((entry) => entry.id === item.id)), ...validated];
    this.save(state); return validated.length;
  }
  /** Credentials are never present in profile/settings/sync records. */
  async putCredential(profileId: string, name: string, value: string): Promise<void> {
    this.profile(this.state(), profileId);
    requireValid(validId(name) && typeof value === "string" && value.length > 0, "Invalid credential");
    await this.secrets.set(`browser.profile.${profileId}.${name}`, value);
  }
  async getCredential(profileId: string, name: string): Promise<string | undefined> {
    this.profile(this.state(), profileId); requireValid(validId(name), "Invalid credential key");
    return this.secrets.get(`browser.profile.${profileId}.${name}`);
  }
  async deleteCredential(profileId: string, name: string): Promise<void> {
    this.profile(this.state(), profileId); requireValid(validId(name), "Invalid credential key");
    await this.secrets.delete(`browser.profile.${profileId}.${name}`);
  }
  private syncReady(id: string): BrowserProfile {
    const profile = this.profile(this.state(), id);
    requireValid(profile.syncEnabled && this.syncAdapter?.status().enabled === true, "Encrypted sync is disabled");
    return profile;
  }
  /** Sync only explicitly opted-in bookmarks/history; excludes credentials, extensions and partition. */
  async publish(id: string): Promise<void> {
    const profile = this.syncReady(id);
    this.syncAdapter!.upsert({ id: `browser:${id}`, scope: "owner", data_class: "context", value: { id, name: profile.name, bookmarks: profile.bookmarks, history: profile.history } });
    await this.syncAdapter!.sync();
  }
  /** Remote data is staged: caller must preview, then accept the exact revision. */
  preview(id: string): SyncItemView | undefined {
    this.syncReady(id);
    const item = this.syncAdapter!.inspect().items.find((entry) => entry.id === `browser:${id}` && entry.scope === "owner");
    return item ? copy(item) : undefined;
  }
  accept(id: string, revision: string): void {
    this.syncReady(id);
    const item = this.preview(id);
    requireValid(!!item && !item.deleted && !item.pending && !item.conflict && item.revision === revision, "Synced profile changed or is conflicted");
    const value: unknown = item!.value;
    requireValid(typeof value === "object" && value !== null && !Array.isArray(value), "Invalid synced profile");
    const record = value as Record<string, unknown>;
    requireValid(record.id === id && typeof record.name === "string" && record.name.length > 0 && record.name.length <= 80 && Array.isArray(record.bookmarks) && Array.isArray(record.history) && record.bookmarks.length <= 10000 && record.history.length <= 10000, "Invalid synced profile");
    const bookmarks = (record.bookmarks as Bookmark[]).map(bookmark);
    const history = (record.history as Visit[]).map(visit);
    requireValid(itemsUnique(bookmarks) && itemsUnique(history), "Duplicate synced entries");
    const state = this.state(); const profile = this.profile(state, id);
    profile.bookmarks = bookmarks; profile.history = history; this.save(state);
  }
  install(profileId: string, extension: SignedExtension): InstalledExtension {
    this.profile(this.state(), profileId);
    const { manifest, signer, signature } = extension;
    requireValid(!!manifest && validId(manifest.id) && validId(manifest.version) && validId(signer) && Array.isArray(manifest.origins) && manifest.origins.length > 0 && manifest.origins.every((origin) => originMatches(origin, origin)) && Array.isArray(manifest.permissions) && manifest.permissions.length > 0 && manifest.permissions.every((item) => item === "pageAction" || item === "contentScript") && (manifest.contentScript === undefined || (typeof manifest.contentScript === "string" && manifest.contentScript.length <= 100000 && manifest.permissions.includes("contentScript"))), "Invalid extension manifest");
    const key = this.trustedSigners[signer];
    requireValid(typeof key === "string" && typeof signature === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(signature), "Untrusted extension signer");
    let valid = false;
    try { valid = verify(null, Buffer.from(JSON.stringify(manifest)), createPublicKey(key), Buffer.from(signature, "base64")); } catch { /* malformed signature/key */ }
    requireValid(valid, "Invalid extension signature");
    const state = this.state();
    const existing = state.extensions[profileId] ?? [];
    const installed: InstalledExtension = { manifest: copy(manifest), signer, approved: false };
    state.extensions[profileId] = [...existing.filter((item) => item.manifest.id !== manifest.id), installed]; this.save(state);
    return copy(installed);
  }
  approve(profileId: string, extensionId: string, approved: boolean): void {
    requireValid(typeof approved === "boolean", "Invalid extension approval");
    const state = this.state(); this.profile(state, profileId);
    const extension = state.extensions[profileId]?.find((item) => item.manifest.id === extensionId);
    requireValid(!!extension, "Unknown extension"); extension!.approved = approved; this.save(state);
  }
  extensions(profileId: string): InstalledExtension[] {
    this.profile(this.state(), profileId); return copy(this.state().extensions[profileId] ?? []);
  }
  /** Gate each operation again; the host must sandbox execution and audit the decision. */
  async authorize(profileId: string, extensionId: string, permission: ExtensionPermission, origin: string): Promise<boolean> {
    this.profile(this.state(), profileId);
    const extension = this.state().extensions[profileId]?.find((item) => item.manifest.id === extensionId);
    if (!extension?.approved || !extension.manifest.permissions.includes(permission) || !extension.manifest.origins.some((pattern) => originMatches(pattern, origin)) || !this.permission) return false;
    return this.permission({ profileId, extensionId, permission, origin });
  }
}
