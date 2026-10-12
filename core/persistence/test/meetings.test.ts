// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KeychainSecretStore, MeetingStore, openDatabase } from "../src";

describe("MeetingStore", () => {
  const store = () => new MeetingStore(openDatabase(":memory:"));
  const base = { capabilityId: "kage", externalId: "1", status: "processing" };

  it("merges updates without erasing known fields", () => {
    const s = store();
    s.upsert({ ...base, title: "Standup", participants: ["Ada"] });
    expect(s.upsert({ ...base, status: "ready", durationSeconds: 60 })).toMatchObject({
      id: "kage:1",
      title: "Standup",
      status: "ready",
      participants: ["Ada"],
      duration_seconds: 60,
      has_transcript: false,
    });
    s.setTranscript("kage:1", { text: "hi" });
    expect(s.get("kage:1")!.has_transcript).toBe(true);
    expect(s.transcript("kage:1")).toEqual({ text: "hi" });
  });

  it("delete purges content and blocks re-import", () => {
    const s = store();
    s.upsert({ ...base, title: "Private" });
    s.setSummary("kage:1", { text: "secret" });
    expect(s.delete("kage:1")).toBe(true);
    expect(s.upsert({ ...base, status: "ready" })).toBeNull();
    s.setSummary("kage:1", { text: "again" });
    expect([s.get("kage:1"), s.summary("kage:1"), s.delete("kage:1")]).toEqual([null, null, false]);
    expect(s.list()).toEqual([]);
  });

  it("enumerates more than 500 active and archived meetings with tied timestamps after reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-meeting-pages-"));
    const path = join(dir, "meetings.db");
    try {
      const db = openDatabase(path);
      const s = new MeetingStore(db);
      for (let n = 0; n < 1004; n++) {
        const id = String(n).padStart(4, "0");
        s.upsert({
          capabilityId: "kage",
          externalId: id,
          status: "ready",
          startedAt: "2026-10-01T00:00:00Z",
        });
        if (n % 2) s.archive(`kage:${id}`);
      }
      expect(s.list()).toHaveLength(100);
      expect(s.list({ limit: 1000 })).toHaveLength(500);
      expect(s.list({ archived: true, limit: 1000 })).toHaveLength(500);
      db.close();

      const reopened = openDatabase(path);
      const again = new MeetingStore(reopened);
      expect(again.listAll().map((m) => m.id)).toEqual(
        Array.from({ length: 1004 }, (_, n) => `kage:${String(n).padStart(4, "0")}`),
      );
      expect(again.listAll().filter((m) => m.archived_at !== null)).toHaveLength(502);
      again.archive("kage:1002");
      again.archive("kage:1003", false);
      again.delete("kage:0000");
      expect(again.listAll()).toHaveLength(1003);
      expect(again.listAll().filter((m) => m.archived_at !== null)).toHaveLength(502);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Touches the real OS keychain, so it is opt-in: PHOENIX_TEST_KEYCHAIN=1 pnpm test
describe.runIf(process.env.PHOENIX_TEST_KEYCHAIN === "1")("KeychainSecretStore", () => {
  it("round-trips a value with quotes and spaces, then deletes it", async () => {
    const k = new KeychainSecretStore();
    const ref = `phoenix.selftest.${Date.now()}`;
    const value = `p@ss "w0rd" \\x $HOME`;
    await k.set(ref, value);
    expect(await k.get(ref)).toBe(value);
    await k.delete(ref);
    expect(await k.get(ref)).toBeUndefined();
  });
});
