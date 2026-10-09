// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  ITEM_STATUSES,
  STATUS_AFTER_EDIT,
  STATUS_TRANSITIONS,
  canTransition,
  itemKey,
  type ExtractedItem,
  type ItemStatus,
} from "../src";
import { rig } from "./helpers";

const extracted = (over: Partial<ExtractedItem> = {}): ExtractedItem => ({
  kind: "decision",
  text: "Ship the release on Friday",
  owner: null,
  due: null,
  evidence: { source: "transcript", quote: "ship the Phoenix release on Friday" },
  dedupeKey: itemKey("decision", "Ship the release on Friday"),
  ...over,
});

describe("status transition table", () => {
  const expected: Record<ItemStatus, ItemStatus[]> = {
    proposed: ["accepted", "edited", "rejected"],
    edited: ["accepted", "rejected"],
    accepted: ["rejected"],
    rejected: ["proposed"],
  };
  for (const from of ITEM_STATUSES) {
    for (const to of ITEM_STATUSES) {
      it(`${from} -> ${to} is ${expected[from].includes(to) ? "allowed" : "refused"}`, () => {
        expect(canTransition(from, to)).toBe(expected[from].includes(to));
      });
    }
  }

  it("a rejected item can never reach accepted without going through review again", () => {
    expect(STATUS_TRANSITIONS.rejected).toEqual(["proposed"]);
    expect(STATUS_AFTER_EDIT.rejected).toBeNull();
  });
});

describe("ItemStore", () => {
  it("stores machine items as proposed and keeps the evidence", () => {
    const r = rig();
    const id = r.meeting("1", { transcript: "x" });
    const item = r.service.items.insertExtracted(id, extracted(), "ai:ollama/llama3.2");
    expect(item).toMatchObject({
      meetingId: id,
      status: "proposed",
      extractedBy: "ai:ollama/llama3.2",
      reviewedAt: null,
      reviewedBy: null,
      original: null,
      evidence: { source: "transcript", quote: "ship the Phoenix release on Friday" },
    });
  });

  it("the database itself refuses a machine item that is not proposed", () => {
    const r = rig();
    const id = r.meeting("1");
    expect(() =>
      r.db
        .prepare(
          `INSERT INTO meeting_items (id, meeting_id, kind, text, status, extracted_by, dedupe_key, created_at)
           VALUES ('x', ?, 'decision', 't', 'accepted', 'kage', 'k', 'now')`,
        )
        .run(id),
    ).toThrow(/proposed/);
    expect(() =>
      r.db
        .prepare(
          `INSERT INTO meeting_items (id, meeting_id, kind, text, status, extracted_by, dedupe_key, created_at)
           VALUES ('y', ?, 'decision', 't', 'accepted', 'ai:ollama/llama3.2', 'k2', 'now')`,
        )
        .run(id),
    ).toThrow(/proposed/);
  });

  it("refuses unknown kinds, statuses and origins at the schema", () => {
    const r = rig();
    const id = r.meeting("1");
    const insert = (kind: string, status: string, by: string) =>
      r.db
        .prepare(
          `INSERT INTO meeting_items (id, meeting_id, kind, text, status, extracted_by, dedupe_key, created_at)
           VALUES (?, ?, ?, 't', ?, ?, ?, 'now')`,
        )
        .run(`${kind}${status}${by}`, id, kind, status, by, `${kind}${status}${by}`);
    expect(() => insert("tool_call", "proposed", "kage")).toThrow();
    expect(() => insert("decision", "approved", "manual")).toThrow();
    expect(() => insert("decision", "proposed", "root")).toThrow();
  });

  it("does not store the same wording twice, in any review state", () => {
    const r = rig();
    const id = r.meeting("1");
    expect(r.service.items.insertExtracted(id, extracted(), "kage")).not.toBeNull();
    expect(r.service.items.insertExtracted(id, extracted(), "ai:ollama/llama3.2")).toBeNull();
    expect(r.service.items.count(id)).toBe(1);
  });

  it("redacts credential-shaped text on the way in", () => {
    const r = rig();
    const id = r.meeting("1");
    const secret = ["gh", "p_", "abcdefghijklmnopqrstuvwxyz0123"].join("");
    const item = r.service.items.insertExtracted(
      id,
      extracted({
        text: `Use ${secret} for CI`,
        dedupeKey: "k",
        evidence: { source: "transcript", quote: `use ${secret} for ci` },
      }),
      "kage",
    );
    expect(item?.text).not.toContain(secret);
    expect(item?.evidence?.quote).not.toContain(secret);
  });

  it("deleting a meeting removes its items, and only its items", () => {
    const r = rig();
    const a = r.meeting("1");
    const b = r.meeting("2");
    r.service.items.insertExtracted(a, extracted(), "kage");
    r.service.items.insertExtracted(b, extracted(), "kage");
    expect(r.meetings.delete(a)).toBe(true);
    expect(r.service.items.count(a)).toBe(0);
    expect(r.service.items.count(b)).toBe(1);
    expect(
      r.db.prepare("SELECT COUNT(*) AS n FROM meeting_items WHERE meeting_id = ?").get(a),
    ).toEqual({ n: 0 });
  });

  it("deleteBefore (retention) removes items too", () => {
    const r = rig();
    const a = r.meeting("1");
    r.service.items.insertExtracted(a, extracted(), "kage");
    r.meetings.deleteBefore();
    expect(r.service.items.count(a)).toBe(0);
  });
});
