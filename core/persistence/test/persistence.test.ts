// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import {
  DatabaseInUseError,
  DatabaseTooNewError,
  DeadLetterStore,
  EventStore,
  lockDatabaseFile,
  MemorySecretStore,
  MIGRATIONS,
  migrate,
  openDatabase,
  schemaVersion,
} from "../src";

const ev = (type = "build.started", source = "terminal") =>
  createEvent({ event_type: type, source, severity: "info" });

describe("database", () => {
  it("applies migrations once and survives reopen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "phoenix-db-")), "nested", "phoenix.sqlite");
    const db = openDatabase(path);
    expect(schemaVersion(db)).toBe(MIGRATIONS.at(-1)?.version);
    expect(migrate(db)).toBe(0);
    new EventStore(db).append(ev());
    db.close();

    const reopened = openDatabase(path);
    expect(new EventStore(reopened).count()).toBe(1);
    reopened.close();
  });

  it("refuses a database written by a newer Phoenix, and leaves it as it was", () => {
    const path = join(mkdtempSync(join(tmpdir(), "phoenix-db-")), "phoenix.sqlite");
    const newest = MIGRATIONS.at(-1)!.version;
    const db = openDatabase(path);
    db.prepare("INSERT INTO schema_migrations VALUES (?, 'from_the_future', 'x')").run(newest + 1);
    db.close();

    expect(() => openDatabase(path)).toThrow(DatabaseTooNewError);
    expect(() => openDatabase(path)).toThrow(/newer Phoenix.*schema \d+/);
    const check = new DatabaseSync(path);
    expect(schemaVersion(check)).toBe(newest + 1);
    check.close();
  });
});

describe("lockDatabaseFile", () => {
  const freshPath = () => join(mkdtempSync(join(tmpdir(), "phoenix-lock-")), "phoenix.sqlite");

  it("lets only one Core use a data directory at a time", () => {
    const path = freshPath();
    const release = lockDatabaseFile(path);
    expect(() => lockDatabaseFile(path)).toThrow(DatabaseInUseError);
    expect(() => lockDatabaseFile(path)).toThrow(/Another Phoenix Core is already using/);
    release();

    // Once the first one stops, the directory is free again.
    lockDatabaseFile(path)();
  });

  it("leaves the database itself readable by other tools while Core runs", () => {
    const path = freshPath();
    const release = lockDatabaseFile(path);
    const db = openDatabase(path);
    new EventStore(db).append(ev());
    const reader = new DatabaseSync(path, { readOnly: true });
    expect(reader.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 1 });
    reader.close();
    db.close();
    release();
  });

  it("does not lock in-memory databases", () => {
    lockDatabaseFile(":memory:")();
    lockDatabaseFile(":memory:")();
  });
});

describe("EventStore", () => {
  it("appends, deduplicates and lists newest first", () => {
    const store = new EventStore(openDatabase(":memory:"));
    const a = ev();
    expect(store.append(a)).toBe(1);
    expect(store.append(a)).toBeNull();
    expect(store.has(a.event_id)).toBe(true);
    store.append(ev("kage.meeting.started", "kage"));
    expect(store.recent().map((r) => r.event.event_type)).toEqual([
      "kage.meeting.started",
      "build.started",
    ]);
  });

  it("filters by source, type prefix and afterSeq", () => {
    const store = new EventStore(openDatabase(":memory:"));
    store.append(ev("kage.meeting.started", "kage"));
    store.append(ev("kage.summary.ready", "kage"));
    store.append(ev("build.failed", "terminal"));
    expect(store.recent({ source: "kage" })).toHaveLength(2);
    expect(store.recent({ type: "kage.meeting.*" })).toHaveLength(1);
    expect(store.recent({ type: "build.failed" })).toHaveLength(1);
    expect(store.recent({ afterSeq: 2 }).map((r) => r.seq)).toEqual([3]);
  });

  it("does not treat SQL wildcards in a type filter as wildcards", () => {
    const store = new EventStore(openDatabase(":memory:"));
    store.append(ev("ab.c", "x"));
    expect(store.recent({ type: "a_.*" })).toHaveLength(0);
  });

  it("prunes beyond the history limit", () => {
    const store = new EventStore(openDatabase(":memory:"), 50);
    for (let i = 0; i < 120; i++) store.append(ev());
    store.prune();
    expect(store.count()).toBe(50);
  });
});

describe("DeadLetterStore", () => {
  it("records failed deliveries", () => {
    const dl = new DeadLetterStore(openDatabase(":memory:"));
    const e = ev();
    dl.add(e, "state-engine", "boom", 3);
    expect(dl.list()[0]).toMatchObject({
      eventId: e.event_id,
      subscriber: "state-engine",
      attempts: 3,
    });
  });
});

describe("MemorySecretStore", () => {
  it("stores and deletes", async () => {
    const s = new MemorySecretStore();
    await s.set("github", "v");
    expect(await s.get("github")).toBe("v");
    await s.delete("github");
    expect(await s.get("github")).toBeUndefined();
  });
});

describe("SettingsStore", () => {
  it("round-trips JSON values with a fallback", async () => {
    const { SettingsStore } = await import("../src");
    const s = new SettingsStore(openDatabase(":memory:"));
    expect(s.get("pet.sleeping", false)).toBe(false);
    s.set("pet.sleeping", true);
    s.set("pet.sleeping", { nested: [1] });
    expect(s.get("pet.sleeping", null)).toEqual({ nested: [1] });
    s.delete("pet.sleeping");
    expect(s.get("pet.sleeping", "x")).toBe("x");
  });
});
