// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { MemorySecretStore } from "@phoenix/persistence";
import { open, seal, type Envelope, type RelayEntry, type SyncTransport } from "@phoenix/sync";
import { SyncRuntime } from "../src/sync";

class Settings {
  private readonly values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T {
    return (this.values.get(key) as T | undefined) ?? fallback;
  }
  set(key: string, value: unknown) {
    this.values.set(key, structuredClone(value));
  }
}
class Relay implements SyncTransport {
  readonly items = new Map<string, RelayEntry>();
  async list(): Promise<RelayEntry[]> {
    return [...this.items.values()];
  }
  async put(
    _namespace: string,
    envelope: Envelope,
    expected: string | null,
  ): Promise<"stored" | "conflict"> {
    const old = this.items.get(envelope.id);
    if ((old?.generation ?? null) !== expected) return "conflict";
    this.items.set(envelope.id, { envelope, generation: String(Number(old?.generation ?? 0) + 1) });
    return "stored";
  }
}

describe("opt-in queued encrypted sync", () => {
  it("queues offline, encrypts relay payload, detects divergent revisions and requires explicit resolution", async () => {
    const relay = new Relay();
    const first = new SyncRuntime(new Settings() as never, new MemorySecretStore(), () => relay);
    const configured = await first.configure({
      endpoint: "https://relay.example",
      relay_token: "secret",
    });
    const recovery = configured.recovery_key!;
    const second = new SyncRuntime(new Settings() as never, new MemorySecretStore(), () => relay);
    await second.configure({
      endpoint: "https://relay.example",
      relay_token: "secret",
      recovery_key: recovery,
    });
    first.upsert({ id: "tone", scope: "owner", data_class: "preference", value: "quiet" });
    expect(first.status().pending).toBe(1);
    expect(relay.items.size).toBe(0);
    await first.sync();
    const envelope = [...relay.items.values()][0]!.envelope;
    expect(JSON.stringify(envelope)).not.toContain("quiet");
    expect(open(recovery, configured.identity!, envelope).value).toBe("quiet");
    await second.sync();
    expect(second.inspect().items[0]!.value).toBe("quiet");
    first.upsert({ id: "tone", scope: "owner", data_class: "preference", value: "loud" });
    second.upsert({ id: "tone", scope: "owner", data_class: "preference", value: "soft" });
    await first.sync();
    await second.sync();
    expect(second.status().conflicts).toBe(1);
    expect(second.inspect().items[0]!.value).toBe("soft");
    second.resolve("tone", "owner", "remote");
    expect(second.inspect().items[0]!.value).toBe("loud");
  });
  it("does not upload excluded projects or classes", async () => {
    const relay = new Relay();
    const sync = new SyncRuntime(new Settings() as never, new MemorySecretStore(), () => relay);
    await sync.configure({ endpoint: "https://relay.example", relay_token: "secret" });
    sync.upsert({
      id: "a",
      scope: "owner",
      data_class: "context",
      project: "hidden",
      value: "secret",
    });
    sync.exclusions({ excluded_projects: ["hidden"], excluded_classes: ["preference"] });
    await sync.sync();
    expect(relay.items.size).toBe(0);
  });
  it("surfaces missing published records and requires a restore or accept-deletion choice", async () => {
    const relay = new Relay();
    const sync = new SyncRuntime(new Settings() as never, new MemorySecretStore(), () => relay);
    await sync.configure({ endpoint: "https://relay.example", relay_token: "secret" });
    sync.upsert({ id: "tone", scope: "owner", data_class: "preference", value: "quiet" });
    await sync.sync();
    relay.items.clear();
    await sync.sync();
    expect(sync.inspect().items[0]?.conflict).toBe("remote_missing");
    expect(() =>
      sync.upsert({ id: "tone", scope: "owner", data_class: "preference", value: "other" }),
    ).toThrow();
    sync.resolve("tone", "owner", "local");
    await sync.sync();
    expect(relay.items.size).toBe(1);
    relay.items.clear();
    await sync.sync();
    sync.resolve("tone", "owner", "remote");
    expect(sync.inspect().items[0]?.deleted).toBe(true);
    expect(sync.inspect().items[0]?.pending).toBe(false);
    await sync.sync();
    expect(relay.items.size).toBe(0);
  });
  it("syncs only selected existing settings and requires explicit stale-safe local apply", async () => {
    const relay = new Relay();
    const firstSettings = new Settings();
    const secondSettings = new Settings();
    firstSettings.set("pet.settings", { reduced_motion: "on" });
    secondSettings.set("pet.settings", { reduced_motion: "off" });
    firstSettings.set("retrieval.settings", { k: 42 });
    const first = new SyncRuntime(firstSettings as never, new MemorySecretStore(), () => relay);
    const second = new SyncRuntime(secondSettings as never, new MemorySecretStore(), () => relay);
    const configured = await first.configure({
      endpoint: "https://relay.example",
      relay_token: "secret",
    });
    await second.configure({
      endpoint: "https://relay.example",
      relay_token: "secret",
      recovery_key: configured.recovery_key,
    });
    expect(() => first.adapter({ keys: ["memory.text"] })).toThrow();
    expect(() =>
      first.adapter({ keys: ["pet.settings.reduced_motion"], extra: "unsafe" }),
    ).toThrow();
    first.adapter({ keys: ["pet.settings.reduced_motion"] });
    expect(first.inspect().items).toHaveLength(1);
    expect(first.inspect().adapter_sources[0]?.available).toBe(false);
    expect(() =>
      first.adapter({
        keys: ["pet.settings.reduced_motion"],
        refresh: "pet.settings.reduced_motion",
      }),
    ).toThrow("Resolve or sync");
    await first.sync();
    await second.sync();
    expect(secondSettings.get("pet.settings", { reduced_motion: "auto" }).reduced_motion).toBe(
      "off",
    );
    expect(second.inspect().adapter_sources[0]?.available).toBe(false);
    second.adapter({ keys: ["pet.settings.reduced_motion"] });
    expect(second.inspect().items[0]?.value).toBe("on");
    expect(second.status().adapter_keys).toEqual(["pet.settings.reduced_motion"]);
    expect(secondSettings.get("pet.settings", { reduced_motion: "auto" }).reduced_motion).toBe(
      "off",
    );
    const incoming = second.inspect().adapter_sources[0]!;
    expect(incoming.available).toBe(true);
    expect(() =>
      second.apply({ key: incoming.key, revision: incoming.revision, current: "on" }),
    ).toThrow();
    secondSettings.set("pet.settings", { reduced_motion: "auto" });
    expect(() =>
      second.apply({ key: incoming.key, revision: incoming.revision, current: "off" }),
    ).toThrow();
    expect(secondSettings.get("pet.settings", { reduced_motion: "off" }).reduced_motion).toBe(
      "auto",
    );
    second.apply({ key: incoming.key, revision: incoming.revision, current: "auto" });
    expect(secondSettings.get("pet.settings", { reduced_motion: "auto" }).reduced_motion).toBe(
      "on",
    );
    expect(secondSettings.get("retrieval.settings", { k: 20 }).k).toBe(20);
    firstSettings.set("pet.settings", { reduced_motion: "off" });
    first.adapter({
      keys: ["pet.settings.reduced_motion"],
      refresh: "pet.settings.reduced_motion",
    });
    await first.sync();
    await second.sync();
    expect(second.status().conflicts).toBe(1);
    expect(secondSettings.get("pet.settings", { reduced_motion: "auto" }).reduced_motion).toBe(
      "on",
    );
    expect(() =>
      second.apply({ key: incoming.key, revision: incoming.revision, current: "on" }),
    ).toThrow("refresh preview");
    second.resolve("settings:pet.settings.reduced_motion", "owner", "remote");
    expect(secondSettings.get("pet.settings", { reduced_motion: "auto" }).reduced_motion).toBe(
      "on",
    );
    const resolved = second.inspect().adapter_sources[0]!;
    expect(resolved.available).toBe(true);
    second.apply({ key: resolved.key, revision: resolved.revision, current: "on" });
    second.adapter({ keys: [] });
    expect(second.inspect().adapter_sources[0]?.available).toBe(false);
    expect(() =>
      second.apply({ key: resolved.key, revision: resolved.revision, current: "off" }),
    ).toThrow("not selected");
    expect(secondSettings.get("pet.settings", { reduced_motion: "auto" }).reduced_motion).toBe(
      "off",
    );
  });

  it("enforces exclusions and source metadata without copying arbitrary settings", async () => {
    const relay = new Relay();
    const settings = new Settings();
    settings.set("memory.settings", { raw: "PRIVATE_MEMORY_TEXT" });
    const sync = new SyncRuntime(settings as never, new MemorySecretStore(), () => relay);
    expect(() => sync.adapter({ keys: ["pet.settings.reduced_motion"] })).toThrow("disabled");
    await sync.configure({ endpoint: "https://relay.example", relay_token: "secret" });
    sync.exclusions({ excluded_projects: ["private"], excluded_classes: ["context"] });
    expect(() => sync.adapter({ keys: ["retrieval.settings.k"] })).toThrow("excluded");
    sync.adapter({ keys: ["pet.settings.reduced_motion"] });
    expect(() =>
      sync.upsert({
        id: "settings:pet.settings.reduced_motion",
        scope: "owner",
        data_class: "preference",
        value: "off",
      }),
    ).toThrow("adapter source");
    expect(() =>
      sync.upsert({
        id: "settings:retrieval.settings.k",
        scope: "project",
        project: "private",
        data_class: "context",
        value: 42,
      }),
    ).toThrow("adapter source");
    await sync.sync();
    expect(sync.inspect().items.map((item) => item.id)).toEqual([
      "settings:pet.settings.reduced_motion",
    ]);
    expect(JSON.stringify([...relay.items.values()])).not.toContain("PRIVATE_MEMORY_TEXT");
    expect(() =>
      sync.apply({ key: "pet.settings.reduced_motion", revision: "wrong", current: "auto" }),
    ).toThrow();
    expect(() =>
      sync.exclusions({
        excluded_projects: ["private"],
        excluded_classes: ["context", "preference"],
      }),
    ).toThrow("Delete and sync");
    expect(sync.status().adapter_keys).toEqual(["pet.settings.reduced_motion"]);
  });
  it("round trips selected context configuration without project or memory content", async () => {
    const relay = new Relay();
    const firstSettings = new Settings();
    const secondSettings = new Settings();
    firstSettings.set("retrieval.settings", { k: 42, model: "local-model" });
    secondSettings.set("retrieval.settings", { k: 7, model: "second-model" });
    const first = new SyncRuntime(firstSettings as never, new MemorySecretStore(), () => relay);
    const second = new SyncRuntime(secondSettings as never, new MemorySecretStore(), () => relay);
    const identity = await first.configure({
      endpoint: "https://relay.example",
      relay_token: "secret",
    });
    await second.configure({
      endpoint: "https://relay.example",
      relay_token: "secret",
      recovery_key: identity.recovery_key,
    });
    first.exclusions({ excluded_projects: ["private"], excluded_classes: [] });
    first.adapter({ keys: ["retrieval.settings.k"] });
    await first.sync();
    expect(
      open(identity.recovery_key!, identity.identity!, [...relay.items.values()][0]!.envelope),
    ).toMatchObject({
      owner: identity.identity,
      scope: "owner",
      project: null,
      data_class: "context",
      value: 42,
    });
    await second.sync();
    second.adapter({ keys: ["retrieval.settings.k"] });
    const source = second.inspect().adapter_sources[1]!;
    expect(source.available).toBe(true);
    second.apply({ key: source.key, revision: source.revision, current: 7 });
    expect(secondSettings.get("retrieval.settings", { k: 0, model: "" })).toEqual({
      k: 42,
      model: "second-model",
    });
    expect(JSON.stringify([...relay.items.values()])).not.toContain("local-model");
  });
  it("does not revive a deleted selected source without explicit conflict resolution", async () => {
    const relay = new Relay();
    const sync = new SyncRuntime(new Settings() as never, new MemorySecretStore(), () => relay);
    await sync.configure({ endpoint: "https://relay.example", relay_token: "secret" });
    sync.adapter({ keys: ["pet.settings.reduced_motion"] });
    await sync.sync();
    sync.delete("settings:pet.settings.reduced_motion", "owner");
    expect(() =>
      sync.adapter({
        keys: ["pet.settings.reduced_motion"],
        refresh: "pet.settings.reduced_motion",
      }),
    ).toThrow("Resolve or sync");
    expect(sync.inspect().items[0]?.deleted).toBe(true);
  });
  it("rejects encrypted adapter records with invalid owner scope or content", async () => {
    const relay = new Relay();
    const sync = new SyncRuntime(new Settings() as never, new MemorySecretStore(), () => relay);
    const configured = await sync.configure({
      endpoint: "https://relay.example",
      relay_token: "secret",
    });
    for (const badItem of [
      {
        owner: configured.identity!,
        scope: "project:private",
        project: "private",
        value: "raw content",
      },
      { owner: "different-account", scope: "owner", project: null, value: "on" },
    ]) {
      const bad = seal(configured.recovery_key!, configured.identity!, {
        id: "settings:pet.settings.reduced_motion",
        data_class: "preference",
        revision: "bad",
        updated_at: new Date().toISOString(),
        deleted: false,
        ...badItem,
      });
      relay.items.set(bad.id, { envelope: bad, generation: "1" });
      await expect(sync.sync()).rejects.toThrow();
      relay.items.clear();
    }
  });
});
