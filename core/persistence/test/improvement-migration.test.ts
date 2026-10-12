// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/database";

describe("improvement migration event deletion", () => {
  it("forgets only memories sourced from the deleted issue event", () => {
    const db = openDatabase(":memory:");
    try {
      for (const source of ["issues", "github", "git"]) {
        const event = `${source}-event`;
        db.prepare(
          `INSERT INTO events (event_id,event_type,source,severity,timestamp,envelope,received_at,seq)
          VALUES (?,?,?,'info','2026-01-01','{}','2026-01-01',?)`,
        ).run(event, "test.event", source, source === "issues" ? 1 : source === "github" ? 2 : 3);
        const domain = source === "issues" ? "issue" : source === "github" ? "pr" : "git";
        const provenance = JSON.stringify({ [source === "git" ? "event_id" : "record_id"]: event });
        db.prepare(
          `INSERT INTO memory_items
          (id,dedupe_key,source,source_ref,owner,scope,layer,domain,kind,text,created_at,observed_at,
           last_confirmed_at,sensitivity,provenance,confidence)
          VALUES (?,?,?,?,?,'*','project',?,'evidence','event text','2026-01-01','2026-01-01',
            '2026-01-01','internal',?,1)`,
        ).run(event, event, source, event, "owner", domain, provenance);
      }
      db.prepare("DELETE FROM events WHERE event_id = 'issues-event'").run();
      const rows = db.prepare("SELECT id,text,deleted_at FROM memory_items ORDER BY id").all() as {
        id: string;
        text: string;
        deleted_at: string | null;
      }[];
      expect(rows.find((r) => r.id === "issues-event")?.text).toBe("");
      expect(rows.find((r) => r.id === "issues-event")?.deleted_at).not.toBeNull();
      expect(
        rows
          .filter((r) => r.id !== "issues-event")
          .every((r) => r.text === "event text" && !r.deleted_at),
      ).toBe(true);
      db.prepare("DELETE FROM events WHERE event_id = 'github-event'").run();
      db.prepare("DELETE FROM events WHERE event_id = 'git-event'").run();
      const remaining = db.prepare("SELECT id,text,deleted_at FROM memory_items").all() as {
        id: string;
        text: string;
        deleted_at: string | null;
      }[];
      expect(remaining.every((r) => r.text === "" && r.deleted_at !== null)).toBe(true);
    } finally {
      db.close();
    }
  });
});
