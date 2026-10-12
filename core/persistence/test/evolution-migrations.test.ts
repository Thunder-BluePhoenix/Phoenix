// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate, MIGRATIONS } from "../src";

/** Upgrade a populated pre-18 profile; rebuilding constrained tables must not drop evidence. */
describe("Phase 46-49 schema upgrades", () => {
  it("retains memory, FTS, graph provenance and deletion triggers through 18-20", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const upto = MIGRATIONS.filter((m) => m.version <= 17);
    db.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    for (const migration of upto) {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-01-01",
      );
    }
    const text = "trusted engineering evidence";
    db.prepare(
      `INSERT INTO memory_items
      (seq,id,dedupe_key,source,source_ref,owner,scope,layer,domain,kind,text,created_at,observed_at,last_confirmed_at,sensitivity,provenance,confidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      42,
      "mem42",
      "dedupe42",
      "project-docs",
      "/tmp/doc",
      "owner",
      "global",
      "project",
      "project",
      "fact",
      text,
      "2026-01-01",
      "2026-01-01",
      "2026-01-01",
      "internal",
      "{}",
      1,
    );
    db.prepare("INSERT INTO memory_fts(rowid,text) VALUES (?,?)").run(42, text);
    db.prepare(
      "INSERT INTO memory_vectors(memory_id,model,dim,vector,created_at) VALUES (?,?,?,?,?)",
    ).run("mem42", "local/fixture", 1, Buffer.alloc(4), "2026-01-01");
    db.prepare(
      "INSERT INTO kg_nodes(id,type,key,key_lc,created_at) VALUES ('Repository:demo','Repository','demo','demo','2026-01-01')",
    ).run();
    db.prepare(
      `INSERT INTO kg_provenance
      (subject_kind,subject_id,source_kind,source_id,capability,observed_at,recorded_at,confidence,asserted_by,scope,domain,sensitivity,detail)
      VALUES ('node','Repository:demo','memory','mem42','project-docs','2026-01-01','2026-01-01',1,'rule','global','project','internal','{}')`,
    ).run();
    expect(migrate(db)).toBe(3);
    expect(db.prepare("SELECT seq, text FROM memory_items WHERE id='mem42'").get()).toEqual({
      seq: 42,
      text,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM memory_fts WHERE memory_fts MATCH 'engineering'").get(),
    ).toEqual({ n: 1 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM memory_vectors WHERE memory_id='mem42'").get(),
    ).toEqual({ n: 1 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM kg_provenance WHERE source_id='mem42'").get(),
    ).toEqual({ n: 1 });
    db.prepare(
      `INSERT INTO memory_items
      (id,dedupe_key,source,source_ref,owner,scope,layer,domain,kind,text,created_at,observed_at,last_confirmed_at,sensitivity,provenance,confidence)
      VALUES ('e1','e1','project-docs','/tmp/doc','owner','global','project','project','evidence','additional evidence','2026-01-01','2026-01-01','2026-01-01','internal','{}',1)`,
    ).run();
    db.prepare(
      "INSERT INTO kg_nodes(id,type,key,key_lc,created_at) VALUES ('Failure:incident','Failure','incident','incident','2026-01-01')",
    ).run();
    db.prepare(
      "INSERT INTO kg_edges(id,src,rel,dst,created_at) VALUES ('edge','Failure:incident','ASSOCIATED_WITH','Repository:demo','2026-01-01')",
    ).run();
    db.prepare("UPDATE memory_items SET text='', deleted_at='2026-01-02' WHERE id='mem42'").run();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM memory_vectors WHERE memory_id='mem42'").get(),
    ).toEqual({ n: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM kg_provenance WHERE source_id='mem42'").get(),
    ).toEqual({ n: 0 });
    db.close();
  });
});
