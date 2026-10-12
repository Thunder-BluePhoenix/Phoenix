// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore, MIGRATIONS, migrate, openDatabase } from "../src";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function populatedProfile() {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-event-delete-"));
  dirs.push(dir);
  const path = join(dir, "profile.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  for (const migration of MIGRATIONS.filter((m) => m.version <= 20)) {
    db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations VALUES (?, ?, '2026-01-01')").run(
      migration.version,
      migration.name,
    );
  }
  const insertEvent = db.prepare(`INSERT INTO events
    (event_id,event_type,source,severity,timestamp,envelope,received_at,seq)
    VALUES (?,'git.commit.created',?,'info','2026-01-01','{}',?,?)`);
  insertEvent.run("old-git", "git", "2026-01-01", 1);
  insertEvent.run("new-git", "git", "2026-02-01", 2);
  insertEvent.run("old-github", "github", "2026-01-01", 3);
  const insertMemory = db.prepare(`INSERT INTO memory_items
    (id,dedupe_key,source,source_ref,owner,scope,layer,domain,kind,text,created_at,observed_at,last_confirmed_at,sensitivity,provenance,confidence)
    VALUES (?,?,?,'repo','owner','global','project',?,'fact',?,'2026-01-01','2026-01-01','2026-01-01','internal',?,1)`);
  const rows: [string, string, string, string][] = [
    ["old-git", "git", "git", '{"event_id":"old-git"}'],
    ["new-git", "git", "git", '{"event_id":"new-git"}'],
    ["old-github", "github", "pr", '{"record_id":"old-github"}'],
    ["other-source", "other", "git", '{"event_id":"old-git"}'],
    ["git-history", "git", "git", '{"sha":"abc"}'],
  ];
  for (const [id, source, domain, provenance] of rows) {
    insertMemory.run(id, id, source, domain, `canary-${id}`, provenance);
    const seq = (db.prepare("SELECT seq FROM memory_items WHERE id=?").get(id) as { seq: number })
      .seq;
    db.prepare("INSERT INTO memory_fts(rowid,text) VALUES (?,?)").run(seq, `canary-${id}`);
    db.prepare(
      "INSERT INTO memory_vectors(memory_id,model,dim,vector,created_at) VALUES (?,'test',1,?,'2026-01-01')",
    ).run(id, Buffer.alloc(4));
    db.prepare(
      "INSERT INTO kg_nodes(id,type,key,key_lc,created_at) VALUES (?,'Repository',?,?, '2026-01-01')",
    ).run(`node-${id}`, id, id);
    db.prepare(
      `INSERT INTO kg_provenance
      (subject_kind,subject_id,source_kind,source_id,capability,observed_at,recorded_at,confidence,asserted_by,scope,domain,sensitivity,detail)
      VALUES ('node',?,'memory',?,?,'2026-01-01','2026-01-01',1,'rule','global',?,'internal','{}')`,
    ).run(`node-${id}`, id, source, domain);
  }
  db.prepare("INSERT INTO agent_tasks VALUES ('task','ci','{}','owner','corr','2026-01-01')").run();
  db.prepare(
    "INSERT INTO agent_runs(id,task_id,agent_id,agent_version,state,created_at,updated_at) VALUES ('run','task','ci','1','COMPLETED','2026-01-01','2026-01-01')",
  ).run();
  db.prepare(
    "INSERT INTO agent_evidence VALUES ('run','E1','memory','old-git','hash','copied-canary',0,'2026-01-01')",
  ).run();
  db.close();
  return path;
}

const memory = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT text, provenance, deleted_at FROM memory_items WHERE id=?").get(id) as {
    text: string;
    provenance: string;
    deleted_at: string | null;
  };
const count = (
  db: DatabaseSync,
  table: "memory_fts" | "memory_vectors" | "kg_provenance",
  id: string,
) => {
  const where =
    table === "memory_fts"
      ? "rowid=(SELECT seq FROM memory_items WHERE id=?)"
      : table === "memory_vectors"
        ? "memory_id=?"
        : "source_id=?";
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(id) as { n: number })
    .n;
};

describe("event-derived data after populated profile upgrade and restart", () => {
  it("retention removes only matching event memories, including copied indexes and graph provenance", () => {
    const path = populatedProfile();
    const db = openDatabase(path);
    expect(migrate(db)).toBe(0);
    expect(new EventStore(db).deleteBefore("2026-01-15")).toBe(2);
    for (const id of ["old-git", "old-github"]) {
      expect(memory(db, id)).toMatchObject({ text: "", provenance: "{}" });
      expect(memory(db, id).deleted_at).not.toBeNull();
      for (const table of ["memory_fts", "memory_vectors", "kg_provenance"] as const)
        expect(count(db, table, id)).toBe(0);
    }
    expect(db.prepare("SELECT excerpt, truncated FROM agent_evidence WHERE id='E1'").get()).toEqual(
      { excerpt: "", truncated: 0 },
    );
    for (const id of ["new-git", "other-source", "git-history"])
      expect(memory(db, id).deleted_at).toBeNull();
    db.close();
    const restarted = openDatabase(path);
    expect(memory(restarted, "old-git").text).toBe("");
    expect(new EventStore(restarted).deleteBySource("git")).toBe(1);
    expect(memory(restarted, "new-git").text).toBe("");
    expect(memory(restarted, "other-source").text).toBe("canary-other-source");
    expect(memory(restarted, "git-history").text).toBe("canary-git-history");
    restarted.close();
  });

  it("delete-all purges every remaining event-derived memory without touching independent history", () => {
    const db = openDatabase(populatedProfile());
    expect(new EventStore(db).deleteBefore()).toBe(3);
    expect(memory(db, "new-git").text).toBe("");
    expect(memory(db, "other-source").text).toBe("canary-other-source");
    expect(memory(db, "git-history").text).toBe("canary-git-history");
    db.close();
  });
  it("bounded history pruning uses the same event-derived deletion triggers", () => {
    const db = openDatabase(populatedProfile());
    expect(new EventStore(db, 0).prune()).toBe(3);
    for (const id of ["old-git", "new-git", "old-github"]) {
      expect(memory(db, id).text).toBe("");
      expect(count(db, "kg_provenance", id)).toBe(0);
    }
    expect(memory(db, "git-history").text).toBe("canary-git-history");
    db.close();
  });
});
