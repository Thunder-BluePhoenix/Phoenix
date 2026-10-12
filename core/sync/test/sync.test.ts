// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  identity,
  newRecoveryKey,
  open,
  seal,
  HttpsSyncTransport,
  type SyncItem,
} from "../src/index";

const item: SyncItem = {
  id: "profile",
  owner: "owner",
  scope: "project:example",
  project: "example",
  data_class: "project_profile",
  value: { preferences: "private text" },
  revision: "r1",
  updated_at: "2026-01-01T00:00:00Z",
  deleted: false,
};

describe("encrypted sync envelopes", () => {
  it("derives the same shared account identity from the recovery key across devices", () => {
    const recovery = newRecoveryKey();
    const restoredOnAnotherDevice = recovery;
    expect(identity(restoredOnAnotherDevice)).toBe(identity(recovery));
    expect(identity(newRecoveryKey())).not.toBe(identity(recovery));
  });
  it("round trips without exposing owner, project or value in relay ciphertext", () => {
    const key = newRecoveryKey();
    const namespace = identity(key);
    const envelope = seal(key, namespace, item);
    expect(JSON.stringify(envelope)).not.toContain("private text");
    expect(JSON.stringify(envelope)).not.toContain("example");
    expect(open(key, namespace, envelope)).toEqual(item);
    expect(open(key, namespace, seal(key, namespace, item))).toEqual(item);
  });
  it("rejects a wrong key and tampered metadata", () => {
    const key = newRecoveryKey();
    const namespace = identity(key);
    const envelope = seal(key, namespace, item);
    expect(() => open(newRecoveryKey(), namespace, envelope)).toThrow();
    expect(() => open(key, namespace, { ...envelope, revision: "r2" })).toThrow();
    expect(() => open(key, namespace, { ...envelope, id: "changed" })).toThrow();
  });
  it("never accepts plaintext relay endpoints", () => {
    expect(() => new HttpsSyncTransport("http://example.com", "token")).toThrow();
    expect(() => new HttpsSyncTransport("https://example.com", "")).toThrow();
  });
  it("stops reading an oversized one-item relay body before JSON parsing", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('{"items":[{"envelope":{"namespace":"owner","ciphertext":"'),
        );
        controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const transport = new HttpsSyncTransport(
      "https://relay.example",
      "token",
      async () => new Response(body),
    );
    await expect(transport.list("owner")).rejects.toThrow("exceeds 4 MiB");
    expect(cancelled).toBe(true);
  });
});
