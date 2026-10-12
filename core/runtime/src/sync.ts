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

/** An allowlist of existing, non-content settings; no meeting, person or memory payloads. */
const sources = {
  "pet.settings.reduced_motion": {
    data_class: "preference",
    storage: "pet.settings",
    field: "reduced_motion",
    fallback: "auto",
  },
  "retrieval.settings.k": {
    data_class: "context",
    storage: "retrieval.settings",
    field: "k",
    fallback: 20,
  },
} as const;
export type SyncSource = keyof typeof sources;
const sourceKeys = Object.keys(sources) as SyncSource[];
const sourceId = (key: SyncSource) => `settings:${key}`;
function validSourceValue(key: SyncSource, value: unknown): boolean {
  return key === "pet.settings.reduced_motion"
    ? value === "auto" || value === "on" || value === "off"
    : typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 200;
}

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
  adapter_keys?: SyncSource[];
  items: Record<string, LocalEntry>;
}
const STATE_KEY = "sync.state.v1";
const KEY_REF = "sync.recovery.v1";
const TOKEN_REF = "sync.relay-token.v1";
const classes = ["preference", "context", "project_profile"];
const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
const itemKey = (item: Pick<SyncItem, "owner" | "scope" | "id">) =>
  JSON.stringify([item.owner, item.scope, item.id]);
const validAdapterItem = (item: SyncItem): boolean => {
  if (!item.id.startsWith("settings:")) return true;
  const source = sourceKeys.find((key) => sourceId(key) === item.id);
  return (
    !!source &&
    item.scope === "owner" &&
    item.project === null &&
    item.data_class === sources[source].data_class &&
    (item.deleted ? item.value === null : validSourceValue(source, item.value))
  );
};

export interface SyncStatus {
  enabled: boolean;
  /** Shared recovery-key account, not a device id. */
  identity: string | null;
  endpoint: string | null;
  excluded_projects: string[];
  excluded_classes: SyncClass[];
  adapter_keys: SyncSource[];
  pending: number;
  conflicts: number;
}
/** Local-first sync: remote rows remain staged; selected settings apply only after explicit review. */
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
      adapter_keys: [],
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
      adapter_keys: state.adapter_keys ?? [],
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
    const next = {
      ...state,
      excluded_projects: [...new Set(projects as string[])],
      excluded_classes: [...new Set(dataClasses as SyncClass[])],
    };
    for (const entry of Object.values(state.items)) {
      if (!entry.item.deleted && entry.base !== null && !this.allowed(next, entry.item))
        throw invalid("Delete and sync existing project/class items before excluding them");
    }
    next.adapter_keys = (next.adapter_keys ?? []).filter(
      (key) => !next.excluded_classes.includes(sources[key].data_class),
    );
    this.save(next);
    return this.status();
  }
  private allowed(state: SyncState, item: SyncItem): boolean {
    return (
      !state.excluded_classes.includes(item.data_class) &&
      (!item.project || !state.excluded_projects.includes(item.project))
    );
  }
  private sourceValue(key: SyncSource): unknown {
    const source = sources[key];
    const stored = this.settings.get<Record<string, unknown>>(source.storage, {});
    const value = stored?.[source.field] ?? source.fallback;
    if (!validSourceValue(key, value)) throw invalid(`Invalid local setting ${key}`);
    return value;
  }
  /** Selecting allowlisted sources is deliberate and never imports content records. */
  adapter(input: Record<string, unknown>): SyncStatus {
    this.requireIdle();
    if (Object.keys(input).some((field) => field !== "keys" && field !== "refresh"))
      throw invalid("Invalid sync adapter fields");
    const keys = input.keys;
    if (!Array.isArray(keys) || keys.some((key) => !sourceKeys.includes(key)))
      throw invalid("Invalid sync adapter selection");
    const refresh = input.refresh;
    if (
      refresh !== undefined &&
      (typeof refresh !== "string" ||
        !keys.includes(refresh) ||
        !sourceKeys.includes(refresh as SyncSource))
    )
      throw invalid("Invalid sync adapter refresh");
    const state = this.state();
    if (!state.enabled) throw invalid("Sync is disabled");
    const selected = [...new Set(keys as SyncSource[])];
    if (selected.some((key) => state.excluded_classes.includes(sources[key].data_class)))
      throw invalid("Source class is excluded");
    for (const key of selected) {
      if ((state.adapter_keys ?? []).includes(key) && key !== refresh) continue;
      const entry = state.items[JSON.stringify([state.owner, "owner", sourceId(key)])];
      if (entry?.conflict || entry?.item.deleted || entry?.pending)
        throw invalid("Resolve or sync the source before publishing it again");
      if (entry && (!validAdapterItem(entry.item) || entry.item.owner !== state.owner))
        throw invalid("Invalid local adapter source");
      this.sourceValue(key);
    }
    for (const key of selected) {
      if ((state.adapter_keys ?? []).includes(key) && key !== refresh) continue;
      const source = sources[key];
      const value = this.sourceValue(key);
      const entry = state.items[JSON.stringify([state.owner, "owner", sourceId(key)])];
      if (
        entry &&
        (Object.is(entry.item.value, value) || !(state.adapter_keys ?? []).includes(key))
      )
        continue;
      this.upsertInternal(
        { id: sourceId(key), scope: "owner", data_class: source.data_class, value },
        true,
      );
    }
    state.adapter_keys = selected;
    this.save(state);
    return this.status();
  }
  /** Explicit apply checks the currently observed source to prevent a stale preview overwriting edits. */
  apply(input: Record<string, unknown>): SyncStatus {
    this.requireIdle();
    if (Object.keys(input).some((field) => !["key", "revision", "current"].includes(field)))
      throw invalid("Invalid source apply fields");
    const { key, revision, current } = input;
    if (
      typeof key !== "string" ||
      !sourceKeys.includes(key as SyncSource) ||
      typeof revision !== "string"
    )
      throw invalid("Invalid source or revision");
    const sourceKey = key as SyncSource;
    const state = this.state();
    if (!state.enabled || !(state.adapter_keys ?? []).includes(sourceKey))
      throw invalid("Source is not selected for sync");
    const source = sources[sourceKey];
    if (state.excluded_classes.includes(source.data_class))
      throw invalid("Source class is excluded");
    const entry = state.items[JSON.stringify([state.owner, "owner", sourceId(sourceKey)])];
    if (
      !entry ||
      entry.conflict ||
      entry.pending ||
      entry.item.deleted ||
      entry.item.revision !== revision ||
      entry.item.owner !== state.owner ||
      entry.item.scope !== "owner" ||
      entry.item.project !== null ||
      entry.item.data_class !== source.data_class ||
      entry.base !== entry.item.revision ||
      !validSourceValue(sourceKey, entry.item.value)
    )
      throw invalid("Synced source changed; refresh preview before applying");
    if (!validSourceValue(sourceKey, current) || !Object.is(this.sourceValue(sourceKey), current))
      throw invalid("Local setting changed; refresh preview before applying");
    const stored = this.settings.get<Record<string, unknown>>(source.storage, {});
    this.settings.set(source.storage, { ...stored, [source.field]: entry.item.value });
    return this.status();
  }

  inspect() {
    const state = this.state();
    return {
      ...this.status(),
      adapter_sources: sourceKeys.map((key) => {
        const entry = state.items[JSON.stringify([state.owner, "owner", sourceId(key)])];
        const selected = (state.adapter_keys ?? []).includes(key);
        const current = selected ? this.sourceValue(key) : null;
        return {
          key,
          selected,
          current,
          revision: selected ? (entry?.item.revision ?? null) : null,
          available:
            selected &&
            !!entry &&
            !entry.pending &&
            !entry.conflict &&
            !entry.item.deleted &&
            entry.base === entry.item.revision &&
            entry.item.owner === state.owner &&
            entry.item.scope === "owner" &&
            entry.item.project === null &&
            !state.excluded_classes.includes(sources[key].data_class) &&
            validSourceValue(key, entry.item.value) &&
            !Object.is(current, entry.item.value),
        };
      }),
      items: Object.values(state.items).map((e) => ({
        ...e.item,
        pending: e.pending,
        conflict: e.conflict,
        base_revision: e.base,
      })),
    };
  }
  upsert(input: Record<string, unknown>) {
    return this.upsertInternal(input, false);
  }
  private upsertInternal(input: Record<string, unknown>, sourceAdapter: boolean) {
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
    if (
      id.startsWith("settings:") &&
      (!sourceAdapter ||
        !sourceKeys.some(
          (source) => sourceId(source) === id && data_class === sources[source].data_class,
        ) ||
        scope !== "owner" ||
        project != null ||
        !validSourceValue(id.slice(9) as SyncSource, value))
    )
      throw invalid("Invalid adapter source item");
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
    if (id.startsWith("settings:") && scope !== "owner")
      throw invalid("Invalid adapter source scope");
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
      if (!validAdapterItem(item)) throw new Error("Invalid sync adapter source item");
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
