// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { randomUUID } from "node:crypto";
import type { SecretStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  HttpsSyncTransport,
  identity,
  newRecoveryKey,
  open,
  seal,
  type SyncClass,
  type SyncItem,
  type SyncTransport,
} from "@phoenix/sync";

interface LocalEntry {
  item: SyncItem;
  base: string | null;
  pending: boolean;
  conflict: SyncItem | "remote_missing" | null;
}
interface SyncState {
  enabled: boolean;
  owner: string;
  endpoint: string;
  excluded_projects: string[];
  excluded_classes: SyncClass[];
  items: Record<string, LocalEntry>;
}
const STATE_KEY = "sync.state.v1";
const KEY_REF = "sync.recovery.v1";
const TOKEN_REF = "sync.relay-token.v1";
const classes = ["preference", "context", "project_profile"];
const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
const itemKey = (item: Pick<SyncItem, "owner" | "scope" | "id">) =>
  JSON.stringify([item.owner, item.scope, item.id]);

export interface SyncStatus {
  enabled: boolean;
  identity: string | null;
  endpoint: string | null;
  excluded_projects: string[];
  excluded_classes: SyncClass[];
  pending: number;
  conflicts: number;
}
/** Local-first sync. Remote data is staged for inspection, never written into another subsystem. */
export class SyncRuntime {
  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets?: SecretStore,
    private readonly transportFactory: (endpoint: string, token: string) => SyncTransport = (
      endpoint,
      token,
    ) => new HttpsSyncTransport(endpoint, token),
  ) {}
  private inFlight: Promise<unknown> | null = null;
  private state(): SyncState {
    return this.settings.get<SyncState>(STATE_KEY, {
      enabled: false,
      owner: "",
      endpoint: "",
      excluded_projects: [],
      excluded_classes: [],
      items: {},
    });
  }
  private save(state: SyncState): void {
    this.settings.set(STATE_KEY, state);
  }
  private requireIdle(): void {
    if (this.inFlight) throw invalid("Sync in progress; retry after it completes");
  }
  status(): SyncStatus {
    const state = this.state();
    return {
      enabled: state.enabled,
      identity: state.owner || null,
      endpoint: state.endpoint || null,
      excluded_projects: state.excluded_projects,
      excluded_classes: state.excluded_classes,
      pending: Object.values(state.items).filter((e) => e.pending).length,
      conflicts: Object.values(state.items).filter((e) => e.conflict).length,
    };
  }
  async configure(input: Record<string, unknown>) {
    this.requireIdle();
    if (!this.secrets) throw invalid("OS secret storage is required for sync");
    if (
      typeof input.endpoint !== "string" ||
      typeof input.relay_token !== "string" ||
      !input.relay_token ||
      input.relay_token.length > 8192
    )
      throw invalid("HTTPS endpoint and relay_token are required");
    // Validate before saving anything; no plaintext bearer token or recovery key in SQLite.
    new HttpsSyncTransport(input.endpoint, input.relay_token);
    if (input.recovery_key !== undefined && typeof input.recovery_key !== "string")
      throw invalid("Invalid recovery_key");
    const existing = this.state();
    if (existing.enabled) throw invalid("Disable sync before changing identity or relay");
    const storedKey = existing.owner ? await this.secrets.get(KEY_REF) : undefined;
    const recoveryKey = input.recovery_key ?? storedKey ?? newRecoveryKey();
    const owner = identity(recoveryKey);
    if (existing.owner && existing.owner !== owner && Object.keys(existing.items).length)
      throw invalid("Delete local synced items before changing identity");
    if (
      existing.endpoint &&
      existing.endpoint !== input.endpoint &&
      Object.keys(existing.items).length
    )
      throw invalid("Delete local synced items before changing relay");
    await this.secrets.set(KEY_REF, recoveryKey);
    await this.secrets.set(TOKEN_REF, input.relay_token);
    this.save({ ...existing, enabled: true, owner, endpoint: input.endpoint });
    return {
      ...this.status(),
      ...(!storedKey && input.recovery_key === undefined ? { recovery_key: recoveryKey } : {}),
    };
  }
  disable(): SyncStatus {
    this.requireIdle();
    const state = this.state();
    state.enabled = false;
    this.save(state);
    return this.status();
  }
  exclusions(input: Record<string, unknown>) {
    this.requireIdle();
    const projects = input.excluded_projects;
    const dataClasses = input.excluded_classes;
    if (
      !Array.isArray(projects) ||
      projects.some((p) => typeof p !== "string" || !p || p.length > 200) ||
      projects.length > 100 ||
      !Array.isArray(dataClasses) ||
      dataClasses.some((c) => !classes.includes(c))
    )
      throw invalid("Invalid sync exclusions");
    const state = this.state();
    state.excluded_projects = [...new Set(projects as string[])];
    state.excluded_classes = [...new Set(dataClasses as SyncClass[])];
    for (const entry of Object.values(state.items)) {
      if (!entry.item.deleted && entry.base !== null && !this.allowed(state, entry.item))
        throw invalid("Delete and sync existing project/class items before excluding them");
    }
    this.save(state);
    return this.status();
  }
  private allowed(state: SyncState, item: SyncItem): boolean {
    return (
      !state.excluded_classes.includes(item.data_class) &&
      (!item.project || !state.excluded_projects.includes(item.project))
    );
  }
  inspect() {
    const state = this.state();
    return {
      ...this.status(),
      items: Object.values(state.items).map((e) => ({
        ...e.item,
        pending: e.pending,
        conflict: e.conflict,
        base_revision: e.base,
      })),
    };
  }
  upsert(input: Record<string, unknown>) {
    this.requireIdle();
    const state = this.state();
    if (!state.enabled) throw invalid("Sync is disabled");
    const { id, scope, project, data_class, value } = input;
    if (
      typeof id !== "string" ||
      !id ||
      id.length > 200 ||
      typeof scope !== "string" ||
      !scope ||
      scope.length > 200 ||
      (project !== null &&
        project !== undefined &&
        (typeof project !== "string" || !project || project.length > 200)) ||
      !classes.includes(data_class as string) ||
      value === undefined
    )
      throw invalid("Invalid synced item");
    if (JSON.stringify(value).length > 32_000) throw invalid("Synced value too large");
    const key = JSON.stringify([state.owner, scope, id]);
    const previous = state.items[key];
    if (previous?.conflict || previous?.item.deleted)
      throw invalid("Resolve conflict or deletion before changing this item");
    const item: SyncItem = {
      id,
      owner: state.owner,
      scope,
      project: (project as string | null) ?? null,
      data_class: data_class as SyncClass,
      value,
      revision: randomUUID(),
      updated_at: new Date().toISOString(),
      deleted: false,
    };
    if (!this.allowed(state, item)) throw invalid("Item excluded from sync");
    state.items[key] = { item, base: previous?.base ?? null, pending: true, conflict: null };
    this.save(state);
    return state.items[key];
  }
  delete(id: string, scope: string) {
    this.requireIdle();
    const state = this.state();
    const entry = state.items[JSON.stringify([state.owner, scope, id])];
    if (!entry) return { deleted: false };
    if (entry.conflict) throw invalid("Resolve the conflict before deleting this item");
    entry.item = {
      ...entry.item,
      value: null,
      deleted: true,
      revision: randomUUID(),
      updated_at: new Date().toISOString(),
    };
    entry.pending = true;
    this.save(state);
    return { deleted: true, queued: true };
  }
  resolve(id: string, scope: string, choice: "local" | "remote") {
    this.requireIdle();
    const state = this.state();
    const entry = state.items[JSON.stringify([state.owner, scope, id])];
    if (!entry?.conflict) throw invalid("No conflict for this item");
    if (entry.conflict === "remote_missing") {
      if (choice === "remote") {
        entry.item = {
          ...entry.item,
          value: null,
          deleted: true,
          revision: randomUUID(),
          updated_at: new Date().toISOString(),
        };
        entry.pending = false;
      } else if (choice === "local") {
        entry.item = {
          ...entry.item,
          revision: randomUUID(),
          updated_at: new Date().toISOString(),
        };
        entry.pending = true;
      } else throw invalid("Choice must be local or remote");
      entry.base = null;
    } else {
      if (choice === "remote") {
        entry.item = entry.conflict;
        entry.pending = false;
      } else if (choice === "local") {
        entry.item = {
          ...entry.item,
          revision: randomUUID(),
          updated_at: new Date().toISOString(),
        };
        entry.pending = true;
      } else throw invalid("Choice must be local or remote");
      entry.base = entry.conflict.revision;
    }
    entry.conflict = null;
    this.save(state);
    return entry;
  }
  sync(): Promise<unknown> {
    if (this.inFlight) return this.inFlight;
    const run = this.runSync();
    this.inFlight = run;
    void run.then(
      () => {
        this.inFlight = null;
      },
      () => {
        this.inFlight = null;
      },
    );
    return run;
  }
  private async runSync() {
    const state = this.state();
    if (!state.enabled || !this.secrets)
      throw invalid("Sync requires opt-in and OS secret storage");
    const key = await this.secrets.get(KEY_REF);
    const token = await this.secrets.get(TOKEN_REF);
    if (!key || !token || identity(key) !== state.owner)
      throw invalid("Sync credentials unavailable or identity changed");
    const transport = this.transportFactory(state.endpoint, token);
    const remote = await transport.list(state.owner);
    const generations = new Map<string, string>();
    for (const row of remote) {
      const item = open(key, state.owner, row.envelope);
      if (item.owner !== state.owner) throw new Error("Sync owner mismatch");
      if (!this.allowed(state, item) && !item.deleted) continue;
      const id = itemKey(item);
      if (generations.has(id)) throw new Error("Duplicate sync relay item");
      generations.set(id, row.generation);
      const local = state.items[id];
      if (!local) {
        state.items[id] = { item, base: item.revision, pending: false, conflict: null };
        continue;
      }
      if (local.item.revision === item.revision) {
        local.base = item.revision;
        local.pending = false;
        continue;
      }
      if (local.pending && local.base === item.revision) continue;
      if (local.pending || (local.base !== null && local.base !== item.revision)) {
        local.conflict = item;
        continue;
      }
      // Remote revision is never silently adopted on top of an existing item, even when local is clean.
      local.conflict = item;
    }
    for (const [id, entry] of Object.entries(state.items)) {
      if (entry.base !== null && !generations.has(id) && !entry.conflict)
        entry.conflict = "remote_missing";
    }
    this.save(state);
    for (const [id, entry] of Object.entries(state.items)) {
      if (
        !entry.pending ||
        entry.conflict ||
        (!entry.item.deleted && !this.allowed(state, entry.item))
      )
        continue;
      const generation = generations.get(id) ?? null;
      if (generation && entry.base === null) {
        entry.conflict =
          remote
            .map((row) => open(key, state.owner, row.envelope))
            .find((item) => itemKey(item) === id) ?? null;
        this.save(state);
        continue;
      }
      if (!generation && entry.base !== null) {
        entry.conflict = "remote_missing";
        this.save(state);
        continue;
      }
      const result = await transport.put(
        state.owner,
        seal(key, state.owner, entry.item),
        generation,
      );
      if (result === "conflict") {
        const latest = await transport.list(state.owner);
        entry.conflict =
          latest
            .map((row) => open(key, state.owner, row.envelope))
            .find((item) => itemKey(item) === id) ?? "remote_missing";
      } else {
        entry.pending = false;
        entry.base = entry.item.revision;
      }
      this.save(state);
    }
    return this.inspect();
  }
}
