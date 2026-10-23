// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's owner of Phase 96 browser profiles. It binds the manager to what Core already has: the
// settings store, the OS secret store, the Phase 45 encrypted sync, and the permission gateway.
//
// What this does not do: there is no browser engine in this build, so nothing here opens a page,
// holds cookies or runs an extension. `partition` is only a name the future webview must use,
// and removing a profile can delete Phoenix's own record of it but cannot clear a webview store
// that does not exist yet (the reply says so). Extension code is stored as data and never runs.
// Credentials are write-only through the API: nothing returns a stored value.
import type { AuditLog, PermissionGateway } from "@phoenix/permissions";
import type { SecretStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { localFile } from "../registry";
import {
  BrowserProfileManager,
  ProfileError,
  type BrowserProfile,
  type EncryptedProfileSync,
  type ExtensionPermission,
  type ExtensionView,
  type SyncItemView,
} from "./index";
import {
  MAX_SIGNER_REGISTRY_BYTES,
  pinnedSigners,
  SignerRegistry,
  SignerRegistryError,
  type SignerRegistryStatus,
} from "./signer-registry";

/** A profile as the API shows it: no history (it can be large) and no credential names. */
export interface ProfileSummary {
  id: string;
  name: string;
  partition: string;
  syncEnabled: boolean;
  bookmarks: number;
  history: number;
  extensions: number;
}

export interface ProfileDetail extends ProfileSummary {
  bookmarkList: BrowserProfile["bookmarks"];
}

export interface BrowserProfilesDependencies {
  settings: SettingsStore;
  secrets: SecretStore | undefined;
  sync: EncryptedProfileSync;
  permissions: Pick<PermissionGateway, "authorize" | "recordOutcome">;
  audit: Pick<AuditLog, "record">;
  /**
   * Signer id → Ed25519 public key (SPKI PEM) of the people allowed to sign extensions. Supplied
   * by whoever builds Core, never by the API, so an API caller cannot make itself a signer.
   * Empty by default: with no signer, no extension can be installed.
   */
  signers?: Readonly<Record<string, string>>;
  /**
   * Signed signer registry (docs/browser-profiles.md): when set it replaces `signers`, adds
   * revocation and expiry, and an extension is untrusted until a valid document is loaded.
   * `rootPublicKey` (Ed25519, SPKI PEM) is pinned by whoever builds Core; `registryFile` is a
   * local file the host chose, read with `loadSignerRegistry()`. Never supplied by the API.
   */
  signerRegistry?: { rootPublicKey: string; registryFile: string; now?: () => number };
}

function summary(profile: BrowserProfile, extensions: number): ProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    partition: profile.partition,
    syncEnabled: profile.syncEnabled,
    bookmarks: profile.bookmarks.length,
    history: profile.history.length,
    extensions,
  };
}

/** Maps the manager's refusals onto API errors; anything unexpected stays a fault. */
function translated<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    return rethrow(error);
  }
}

function rethrow(error: unknown): never {
  if (error instanceof ProfileError)
    throw new PhoenixError(
      error.missing ? ErrorCode.RESOURCE_NOT_FOUND : ErrorCode.INVALID_REQUEST,
      error.message,
    );
  throw error;
}

export class BrowserProfilesService {
  private readonly manager: BrowserProfileManager | undefined;
  private readonly signerRegistry: SignerRegistry | undefined;

  constructor(private readonly d: BrowserProfilesDependencies) {
    // Credentials need the OS secret store; without one the whole feature stays out of reach
    // rather than falling back to storing them anywhere else.
    this.signerRegistry = d.signerRegistry
      ? new SignerRegistry({
          rootPublicKey: d.signerRegistry.rootPublicKey,
          store: d.settings,
          ...(d.signerRegistry.now ? { now: d.signerRegistry.now } : {}),
        })
      : undefined;
    this.manager = d.secrets
      ? new BrowserProfileManager(
          d.settings,
          d.secrets,
          d.sync,
          this.signerRegistry ?? pinnedSigners(d.signers ?? {}),
          (request) => this.decide(request),
        )
      : undefined;
  }

  available(): boolean {
    return this.manager !== undefined;
  }

  /**
   * Reads the host-chosen registry file and activates it if it verifies against the pinned root.
   * No path or document text leaves here: a refusal is the closed code only. Revocation applies to
   * already-installed extensions at once (their `status` becomes `revoked`).
   */
  async loadSignerRegistry(): Promise<{ changed: boolean; sequence: number }> {
    const registry = this.signerRegistry;
    const file = this.d.signerRegistry?.registryFile;
    if (!registry || !file)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Signer registry not configured");
    try {
      const loaded = registry.load(await localFile(file, MAX_SIGNER_REGISTRY_BYTES));
      if (loaded.changed) this.note("signer_registry_loaded", { sequence: loaded.sequence });
      return loaded;
    } catch (error) {
      if (error instanceof SignerRegistryError) {
        this.note("signer_registry_refused", { code: error.code });
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          `Signer registry verification failed: ${error.code}`,
        );
      }
      // Do not expose the configured path or filesystem detail.
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Signer registry file unavailable");
    }
  }

  /** Null when no registry is configured (the static `signers` map, if any, is in force). */
  signerRegistryStatus(): SignerRegistryStatus | null {
    return this.signerRegistry?.status() ?? null;
  }

  /** Counts for the privacy inventory. */
  counts(): { profiles: number; bookmarks: number; history: number; extensions: number } {
    const profiles = this.manager?.list() ?? [];
    return {
      profiles: profiles.length,
      bookmarks: profiles.reduce((n, p) => n + p.bookmarks.length, 0),
      history: profiles.reduce((n, p) => n + p.history.length, 0),
      extensions: profiles.reduce((n, p) => n + (this.manager?.extensions(p.id).length ?? 0), 0),
    };
  }

  list(): ProfileSummary[] {
    const manager = this.need();
    return manager.list().map((p) => summary(p, manager.extensions(p.id).length));
  }

  get(id: string): ProfileDetail {
    const manager = this.need();
    const profile = translated(() => manager.list().find((p) => p.id === id));
    if (!profile) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown browser profile");
    return {
      ...summary(profile, manager.extensions(id).length),
      bookmarkList: profile.bookmarks,
    };
  }

  create(input: unknown): ProfileSummary {
    const name = field(input, "name");
    const profile = translated(() => this.need().create(name as string));
    this.note("create", { profile: profile.id });
    return summary(profile, 0);
  }

  async remove(id: string): Promise<{ removed: true; purge_partition: string }> {
    const manager = this.need();
    const partition = this.get(id).partition;
    try {
      await manager.remove(id);
    } catch (error) {
      rethrow(error);
    }
    this.note("remove", { profile: id });
    // The webview that would hold this partition does not exist yet; the caller must purge it.
    return { removed: true, purge_partition: partition };
  }

  setSync(id: string, input: unknown): ProfileSummary {
    const enabled = field(input, "enabled");
    translated(() => this.need().setSync(id, enabled as boolean));
    this.note("sync_opt", { profile: id, enabled: enabled === true });
    return this.get(id);
  }

  addBookmark(id: string, input: unknown): ProfileDetail {
    translated(() => this.need().addBookmark(id, input as never));
    return this.get(id);
  }

  importBookmarks(id: string, input: unknown): { imported: number; skipped: number } {
    const html = field(input, "html");
    const result = translated(() => this.need().importBookmarkHtml(id, html as string));
    this.note("import_bookmarks", { profile: id, imported: result.imported });
    return result;
  }

  recordVisit(id: string, input: unknown): void {
    translated(() => this.need().recordVisit(id, input as never));
  }

  async putCredential(id: string, name: string, input: unknown): Promise<{ stored: true }> {
    const value = field(input, "value");
    try {
      await this.need().putCredential(id, name, value as string);
    } catch (error) {
      rethrow(error);
    }
    this.note("credential_set", { profile: id, name });
    return { stored: true };
  }

  async deleteCredential(id: string, name: string): Promise<{ deleted: true }> {
    try {
      await this.need().deleteCredential(id, name);
    } catch (error) {
      rethrow(error);
    }
    this.note("credential_deleted", { profile: id, name });
    return { deleted: true };
  }

  // ── Encrypted sync ────────────────────────────────────────────────────────

  async publish(id: string): Promise<{ published: true }> {
    try {
      await this.need().publish(id);
    } catch (error) {
      rethrow(error);
    }
    this.note("publish", { profile: id });
    return { published: true };
  }

  async pull(): Promise<{ remote: { id: string; name: string; revision: string }[] }> {
    const manager = this.need();
    try {
      await manager.pull();
      return { remote: manager.remoteProfiles() };
    } catch (error) {
      return rethrow(error);
    }
  }

  preview(id: string): SyncItemView | null {
    return translated(() => this.need().preview(id)) ?? null;
  }

  accept(id: string, input: unknown): ProfileDetail {
    const revision = field(input, "revision");
    translated(() => this.need().accept(id, revision as string));
    this.note("accept", { profile: id });
    return this.get(id);
  }

  adopt(id: string, input: unknown): ProfileSummary {
    const revision = field(input, "revision");
    const profile = translated(() => this.need().adopt(id, revision as string));
    this.note("adopt", { profile: id });
    return summary(profile, 0);
  }

  // ── Extensions ────────────────────────────────────────────────────────────

  extensions(id: string): ExtensionView[] {
    return translated(() => this.need().extensions(id));
  }

  install(id: string, input: unknown): ExtensionView {
    const installed = translated(() => this.need().install(id, input as never));
    this.note("extension_install", { profile: id, extension: installed.manifest.id });
    return installed;
  }

  /**
   * Approving is what lets an extension be authorised at all, so it is a user decision that asks.
   * Withdrawing approval only removes access and never asks.
   */
  async approve(id: string, extensionId: string, input: unknown): Promise<ExtensionView[]> {
    const approved = field(input, "approved");
    const manager = this.need();
    if (approved === true) {
      const found = translated(() => manager.extensions(id)).find(
        (e) => e.manifest.id === extensionId,
      );
      if (!found) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown extension");
      const action = await this.d.permissions.authorize({
        capabilityId: "browser-profiles",
        command: "extension.approve",
        permissions: [],
        sideEffect: "execute",
        summary: `Approve the browser extension ${found.manifest.id} ${found.manifest.version} for ${found.manifest.origins.join(", ")} (${found.manifest.permissions.join(", ")})? It cannot run anywhere else.`,
        details: { profile: id, extension: found.manifest.id },
      });
      translated(() => manager.approve(id, extensionId, true));
      this.d.permissions.recordOutcome(action, "succeeded");
    } else {
      translated(() => manager.approve(id, extensionId, false));
      this.note("extension_unapproved", { profile: id, extension: extensionId });
    }
    return manager.extensions(id);
  }

  uninstall(id: string, extensionId: string): ExtensionView[] {
    translated(() => this.need().uninstall(id, extensionId));
    this.note("extension_uninstall", { profile: id, extension: extensionId });
    return this.need().extensions(id);
  }

  /**
   * Asks whether an approved extension may use one permission on one origin. The host sandbox that
   * would run its script must call this each time; nothing here runs the script.
   */
  async authorize(
    id: string,
    extensionId: string,
    permission: ExtensionPermission,
    origin: string,
  ): Promise<boolean> {
    return this.need().authorize(id, extensionId, permission, origin);
  }

  /** The gateway decides every extension operation, and its audit row is the record of it. */
  private async decide(request: {
    profileId: string;
    extensionId: string;
    permission: ExtensionPermission;
    origin: string;
  }): Promise<boolean> {
    try {
      const action = await this.d.permissions.authorize({
        capabilityId: "browser-profiles",
        command: `extension.${request.permission}`,
        permissions: [],
        sideEffect: "read",
        summary: `Let extension ${request.extensionId} use ${request.permission} on ${request.origin}`,
        details: { profile: request.profileId, extension: request.extensionId },
      });
      this.d.permissions.recordOutcome(action, "succeeded");
      return true;
    } catch {
      return false;
    }
  }

  private need(): BrowserProfileManager {
    if (!this.manager)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "Browser profiles need the OS credential store",
      );
    return this.manager;
  }

  private note(change: string, details: Record<string, string | number | boolean>): void {
    this.d.audit.record({
      actor: "user",
      action: `browser_profiles.${change}`,
      capabilityId: "browser-profiles",
      decision: "info",
      details,
    });
  }
}

/** One required key of a JSON object body, passed on unchanged for the manager to validate. */
function field(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object" || !(key in input))
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, `"${key}" is required`);
  return (input as Record<string, unknown>)[key];
}
