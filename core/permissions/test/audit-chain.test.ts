// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Database } from "@phoenix/persistence";
import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS_HASH, AuditLog, auditEntryHash } from "../src";

function setup() {
  const db = openDatabase(":memory:");
  let t = Date.UTC(2026, 0, 1);
  const log = new AuditLog(db, () => (t += 1000));
  return { db, log };
}

function fill(log: AuditLog, n: number): number[] {
  return Array.from({ length: n }, (_, i) =>
    log.record({
      actor: "user",
      action: `test.action.${i}`,
      capabilityId: i % 2 ? "git" : undefined,
      decision: "allowed",
      details: { n: i, nested: { b: 1, a: [i] } },
    }),
  ).map((e) => e.id);
}

describe("audit hash chain", () => {
  it("verifies an intact chain and anchors the first row on the genesis constant", () => {
    const { db, log } = setup();
    fill(log, 5);
    expect(log.verify()).toEqual({ ok: true, checked: 5, firstBadId: null, unchainedPrefix: 0 });
    const rows = db.prepare("SELECT prev_hash, entry_hash FROM audit_log ORDER BY id").all() as {
      prev_hash: string;
      entry_hash: string;
    }[];
    expect(rows[0]!.prev_hash).toBe(AUDIT_GENESIS_HASH);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prev_hash).toBe(rows[i - 1]!.entry_hash);
  });

  it("verifies an empty log", () => {
    expect(setup().log.verify()).toEqual({
      ok: true,
      checked: 0,
      firstBadId: null,
      unchainedPrefix: 0,
    });
  });

  it("keeps record()'s return shape and list() unchanged", () => {
    const { log } = setup();
    const e = log.record({ actor: "a", action: "x", decision: "info", details: { k: "v" } });
    expect(Object.keys(e).sort()).toEqual(["action", "actor", "decision", "details", "id", "ts"]);
    expect(log.list()[0]).toEqual(e);
  });

  it.each([
    ["details", "UPDATE audit_log SET details = '{\"n\":999}' WHERE id = ?"],
    ["action", "UPDATE audit_log SET action = 'forged' WHERE id = ?"],
    ["decision", "UPDATE audit_log SET decision = 'denied' WHERE id = ?"],
    ["actor", "UPDATE audit_log SET actor = 'someone' WHERE id = ?"],
    ["ts", "UPDATE audit_log SET ts = '2000-01-01T00:00:00.000Z' WHERE id = ?"],
    ["capability_id", "UPDATE audit_log SET capability_id = 'other' WHERE id = ?"],
    ["entry_hash", "UPDATE audit_log SET entry_hash = 'deadbeef' WHERE id = ?"],
    ["prev_hash", "UPDATE audit_log SET prev_hash = 'deadbeef' WHERE id = ?"],
    ["hashes cleared", "UPDATE audit_log SET prev_hash = NULL, entry_hash = NULL WHERE id = ?"],
  ])("detects an edited %s at that row", (_name, sql) => {
    const { db, log } = setup();
    const ids = fill(log, 6);
    const target = ids[3]!;
    db.prepare(sql).run(target);
    expect(log.verify()).toEqual({
      ok: false,
      checked: 3,
      firstBadId: target,
      unchainedPrefix: 0,
    });
  });

  it("detects a deleted middle row at the row that followed it", () => {
    const { db, log } = setup();
    const ids = fill(log, 6);
    db.prepare("DELETE FROM audit_log WHERE id = ?").run(ids[2]!);
    expect(log.verify()).toMatchObject({ ok: false, checked: 2, firstBadId: ids[3] });
  });

  it("detects reordered rows", () => {
    const { db, log } = setup();
    const ids = fill(log, 6);
    // Swap the positions of rows 2 and 3 (ids exchanged through a free id).
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("UPDATE audit_log SET id = 100 WHERE id = ?").run(ids[2]!);
    db.prepare("UPDATE audit_log SET id = ? WHERE id = ?").run(ids[2]!, ids[3]!);
    db.prepare("UPDATE audit_log SET id = ? WHERE id = 100").run(ids[3]!);
    expect(log.verify()).toMatchObject({ ok: false, checked: 2, firstBadId: ids[2] });
  });

  it("does not notice dropped newest rows (documented limit)", () => {
    const { db, log } = setup();
    const ids = fill(log, 4);
    db.prepare("DELETE FROM audit_log WHERE id = ?").run(ids[3]!);
    expect(log.verify().ok).toBe(true);
  });

  it("does not stop a full recomputation by someone who can write the database (documented limit)", () => {
    const { db, log } = setup();
    const ids = fill(log, 4);
    db.prepare("UPDATE audit_log SET action = 'forged' WHERE id = ?").run(ids[1]!);
    let prev = AUDIT_GENESIS_HASH;
    const rows = db.prepare("SELECT * FROM audit_log ORDER BY id").all() as Record<
      string,
      string | number | null
    >[];
    for (const r of rows) {
      const hash = auditEntryHash({
        prevHash: prev,
        id: Number(r.id),
        ts: String(r.ts),
        actor: String(r.actor),
        action: String(r.action),
        capabilityId: r.capability_id === null ? null : String(r.capability_id),
        decision: String(r.decision),
        details: String(r.details),
      });
      db.prepare("UPDATE audit_log SET prev_hash = ?, entry_hash = ? WHERE id = ?").run(
        prev,
        hash,
        Number(r.id),
      );
      prev = hash;
    }
    expect(log.verify().ok).toBe(true);
  });

  it("tolerates rows from before the chain as an unchained prefix, then chains after them", () => {
    const db = openDatabase(":memory:");
    const ins = db.prepare(
      "INSERT INTO audit_log (ts, actor, action, decision, details) VALUES ('t', 'u', 'old', 'info', '{}')",
    );
    ins.run();
    ins.run();
    ins.run();
    const log = new AuditLog(db);
    expect(log.verify()).toEqual({ ok: true, checked: 0, firstBadId: null, unchainedPrefix: 3 });
    const [a, b] = fill(log, 2) as [number, number];
    expect(log.verify()).toEqual({ ok: true, checked: 2, firstBadId: null, unchainedPrefix: 3 });
    const first = db.prepare("SELECT prev_hash FROM audit_log WHERE id = ?").get(a) as {
      prev_hash: string;
    };
    expect(first.prev_hash).toBe(AUDIT_GENESIS_HASH);
    // An unchained row appearing after the chain started is a stripped row, not a prefix.
    db.prepare("UPDATE audit_log SET prev_hash = NULL, entry_hash = NULL WHERE id = ?").run(b);
    expect(log.verify()).toMatchObject({ ok: false, firstBadId: b });
  });

  it("keeps one linear chain when two connections write at once", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "phoenix-audit-")), "phoenix.sqlite");
    const a = openDatabase(path);
    const b = openDatabase(path);
    const logA = new AuditLog(a);
    const logB = new AuditLog(b);
    await Promise.all(
      [logA, logB, logA, logB].map(
        (log, w) =>
          new Promise<void>((resolve) =>
            setImmediate(() => {
              for (let i = 0; i < 25; i++)
                log.record({ actor: `w${w}`, action: "c", decision: "info", details: { i } });
              resolve();
            }),
          ),
      ),
    );
    expect(logA.count()).toBe(100);
    expect(logA.verify()).toEqual({ ok: true, checked: 100, firstBadId: null, unchainedPrefix: 0 });
    const heads = a
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE prev_hash IN (SELECT prev_hash FROM audit_log GROUP BY prev_hash HAVING COUNT(*) > 1)",
      )
      .get() as { n: number };
    expect(heads.n).toBe(0); // no two rows chain onto the same predecessor
    a.close();
    b.close();
  });

  it("serialises writers: a second connection cannot write between the hash read and the insert", () => {
    const path = join(mkdtempSync(join(tmpdir(), "phoenix-audit-")), "phoenix.sqlite");
    const a = openDatabase(path);
    const b = openDatabase(path);
    b.exec("PRAGMA busy_timeout = 0");
    const logB = new AuditLog(b);
    let intruder: unknown = "not attempted";
    // Runs B's write at the moment A has read the head hash and is about to insert.
    const spy = new Proxy(a, {
      get(target, prop) {
        if (prop !== "prepare")
          return Reflect.get(target, prop).bind?.(target) ?? Reflect.get(target, prop);
        return (sql: string) => {
          if (sql.startsWith("INSERT INTO audit_log") && intruder === "not attempted") {
            try {
              logB.record({ actor: "b", action: "intruder", decision: "info", details: {} });
              intruder = "wrote";
            } catch (err) {
              intruder = (err as Error).message;
            }
          }
          return target.prepare(sql);
        };
      },
    }) as Database;
    const logA = new AuditLog(spy);
    logA.record({ actor: "a", action: "first", decision: "info", details: {} });
    expect(intruder).toMatch(/locked|busy/i);
    logB.record({ actor: "b", action: "after", decision: "info", details: {} });
    expect(logA.verify()).toEqual({ ok: true, checked: 2, firstBadId: null, unchainedPrefix: 0 });
    a.close();
    b.close();
  });

  it("chains inside a caller's open transaction and rolls back with it", () => {
    const { db, log } = setup();
    fill(log, 2);
    db.exec("BEGIN");
    log.record({ actor: "u", action: "inner", decision: "info", details: {} });
    db.exec("ROLLBACK");
    expect(log.count()).toBe(2);
    fill(log, 1);
    expect(log.verify()).toMatchObject({ ok: true, checked: 3 });
  });

  it("hash covers each input, with a domain prefix and canonical details", () => {
    const base = {
      prevHash: "p",
      id: 1,
      ts: "t",
      actor: "a",
      action: "x",
      capabilityId: "c" as string | null,
      decision: "info",
      details: '{"a":1,"b":2}',
    };
    const h = auditEntryHash(base);
    const variants = [
      { prevHash: "q" },
      { id: 2 },
      { ts: "u" },
      { actor: "b" },
      { action: "y" },
      { capabilityId: null },
      { capabilityId: "d" },
      { decision: "denied" },
      { details: '{"a":1,"b":3}' },
    ];
    for (const v of variants) expect(auditEntryHash({ ...base, ...v })).not.toBe(h);
    // Key order of the stored details does not matter; field boundaries do.
    expect(auditEntryHash({ ...base, details: '{"b":2,"a":1}' })).toBe(h);
    expect(auditEntryHash({ ...base, actor: "ax", action: "" })).not.toBe(
      auditEntryHash({ ...base, actor: "a", action: "x" }),
    );
    // Pinned vector: changing the domain prefix, field order or encoding fails this.
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe("550318591ee071d5b7b2b7f6c225eb59daf7038aaabb10aef2e6f95e2bc59b28");
  });
});
