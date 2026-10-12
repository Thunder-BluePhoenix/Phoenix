// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { MemorySecretStore } from "@phoenix/persistence";
import { open, type Envelope, type RelayEntry, type SyncTransport } from "@phoenix/sync";
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
});
