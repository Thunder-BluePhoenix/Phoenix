// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { PhoenixError } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import {
  ITEM_STATUSES,
  REVIEW_MEMORY_SOURCE,
  canTransition,
  type ItemStatus,
  type MeetingItem,
} from "../src";
import { PLANNING, rig, scripted, reply, type Rig } from "./helpers";

const me = { id: "me" };

function seeded(over: { allowSensitive?: boolean } = {}): {
  r: Rig;
  id: string;
  items: MeetingItem[];
} {
  const r = rig(over);
  const id = r.meeting("1", {
    title: "Release planning",
    transcript: PLANNING,
    summary: {
      text: "Planning",
      decisions: ["We decided to ship the Phoenix release on Friday", "Drop support for Node 18"],
      action_items: [{ text: "Write the migration guide", owner: "Sam", due: "Thursday" }],
      topics: ["release"],
    },
  });
  r.service.importKage(id);
  return { r, id, items: r.service.list(id) };
}

const factsOf = (r: Rig, id: string) =>
  r.memory
    .list({ domain: "meeting", limit: 50 })
    .filter((m) => m.sourceRef === id && m.source === REVIEW_MEMORY_SOURCE);

describe("review: every status pair, through the service", () => {
  // Build an item in each starting status, try each target action, compare to the table.
  const reach: Record<ItemStatus, (r: Rig, item: MeetingItem) => void> = {
    proposed: () => {},
    accepted: (r, i) => void r.service.accept(i.id, me),
    edited: (r, i) => void r.service.edit(i.id, { text: "Edited text here" }, me),
    rejected: (r, i) => void r.service.reject(i.id, me),
  };
  const actions: Record<ItemStatus, (r: Rig, id: string) => unknown> = {
    proposed: (r, id) => r.service.reopen(id, me),
    accepted: (r, id) => r.service.accept(id, me),
    rejected: (r, id) => r.service.reject(id, me),
    edited: (r, id) => r.service.edit(id, { text: "Another wording" }, me),
  };
  for (const from of ITEM_STATUSES) {
    for (const to of ITEM_STATUSES) {
      it(`${from} -> ${to}`, () => {
        const { r, items } = seeded();
        const item = items.find((i) => i.kind === "decision");
        if (!item) throw new Error("no decision");
        reach[from](r, item);
        expect(r.service.get(item.id).status).toBe(from);
        if (to === "edited") {
          // Editing is its own action: allowed from proposed/edited (stays edited) and accepted (stays accepted).
          const allowed = from !== "rejected";
          if (allowed) {
            const out = actions.edited(r, item.id) as { item: MeetingItem };
            expect(out.item.status).toBe(from === "accepted" ? "accepted" : "edited");
          } else {
            expect(() => actions.edited(r, item.id)).toThrow(PhoenixError);
            expect(r.service.get(item.id).status).toBe("rejected");
          }
          return;
        }
        if (canTransition(from, to)) {
          expect((actions[to](r, item.id) as { item: MeetingItem }).item.status).toBe(to);
        } else {
          expect(() => actions[to](r, item.id)).toThrow(/cannot become/);
          expect(r.service.get(item.id).status).toBe(from);
        }
      });
    }
  }
});

describe("review actions", () => {
  it("accept records reviewer and time and audits ids and counts, never text", () => {
    const { r, items } = seeded();
    const item = items.find((i) => i.kind === "decision");
    const out = r.service.accept(item?.id ?? "", { id: "alice" });
    expect(out.item).toMatchObject({
      status: "accepted",
      reviewedBy: "alice",
      reviewedAt: "2026-10-08T12:00:00.000Z",
    });
    const entry = r.audit.find((a) => a.action === "meeting.item.reviewed");
    expect(entry?.details).toMatchObject({
      item_id: item?.id,
      from: "proposed",
      to: "accepted",
      reviewed_by: "alice",
    });
    const json = JSON.stringify(r.audit);
    for (const i of items) expect(json).not.toContain(i.text);
    expect(json).not.toContain("Phoenix release");
  });

  it("edit keeps the original wording (first edit only), owner and due", () => {
    const { r, items } = seeded();
    const action = items.find((i) => i.kind === "action_item");
    const first = r.service.edit(
      action?.id ?? "",
      { text: "Write the upgrade guide", owner: "Ada", due: null },
      me,
    );
    expect(first.item).toMatchObject({
      status: "edited",
      text: "Write the upgrade guide",
      owner: "Ada",
      due: null,
    });
    expect(first.item.original).toEqual({
      text: "Write the migration guide",
      owner: "Sam",
      due: "Thursday",
    });
    const second = r.service.edit(action?.id ?? "", { text: "Write the final guide" }, me);
    expect(second.item.original?.text).toBe("Write the migration guide");
    expect(second.item.owner).toBe("Ada");
  });

  it("edit validates: empty, too long, owner on a decision, rejected item", () => {
    const { r, items } = seeded();
    const decision = items.find((i) => i.kind === "decision")?.id ?? "";
    expect(() => r.service.edit(decision, { text: "   " }, me)).toThrow(/empty/);
    expect(() => r.service.edit(decision, { text: "x".repeat(501) }, me)).toThrow(/longer/);
    expect(() => r.service.edit(decision, { text: "ok", owner: "Sam" }, me)).toThrow(
      /Only action items/,
    );
    r.service.reject(decision, me);
    expect(() => r.service.edit(decision, { text: "ok text" }, me)).toThrow(/cannot be edited/);
    r.service.reopen(decision, me);
    expect(r.service.get(decision).status).toBe("proposed");
  });

  it("unknown ids and hostile ids are plain not-found errors", () => {
    const { r } = seeded();
    for (const bad of ["nope", "", "' OR 1=1 --", "mi_" + "x".repeat(10_000)]) {
      expect(() => r.service.accept(bad, me)).toThrow(/No such item/);
    }
  });

  it("filters by status and counts", () => {
    const { r, items } = seeded();
    r.service.accept(items[0]?.id ?? "", me);
    r.service.reject(items[1]?.id ?? "", me);
    expect(r.service.list(items[0]?.meetingId ?? "", { status: "accepted" })).toHaveLength(1);
    expect(r.service.counts(items[0]?.meetingId ?? "")).toEqual({
      proposed: 2,
      accepted: 1,
      edited: 0,
      rejected: 1,
    });
  });

  it("a manual item starts accepted, becomes a memory fact, and is attributed to the user", () => {
    const { r, id } = seeded();
    const out = r.service.addManual(
      id,
      { kind: "decision", text: "Use pnpm everywhere", owner: null, due: null },
      me,
    );
    expect(out.item).toMatchObject({ status: "accepted", extractedBy: "manual", reviewedBy: "me" });
    expect(out.memory.stored).toBe(1);
  });
});

describe("memory propagation", () => {
  it("proposed and rejected items are not memory; accepted decisions and action items are, with provenance", () => {
    const { r, id, items } = seeded();
    expect(factsOf(r, id)).toHaveLength(0);
    const decision = items.find((i) => i.text.startsWith("We decided"));
    const action = items.find((i) => i.kind === "action_item");
    const topic = items.find((i) => i.kind === "topic");
    const rejected = items.find((i) => i.text.startsWith("Drop support"));
    r.service.reject(rejected?.id ?? "", me);
    expect(r.service.accept(decision?.id ?? "", me).memory).toEqual({ stored: 1, refused: [] });
    r.service.accept(action?.id ?? "", me);
    r.service.accept(topic?.id ?? "", me); // topics are reviewable but not memory facts
    const facts = factsOf(r, id);
    expect(facts).toHaveLength(2);
    const fact = facts.find((f) => f.text.includes("ship the Phoenix release"));
    expect(fact).toMatchObject({
      domain: "meeting",
      kind: "fact",
      sensitivity: "sensitive",
      scope: `meeting:${id}`,
      source: REVIEW_MEMORY_SOURCE,
      provenance: {
        meeting_id: id,
        item_id: decision?.id,
        extracted_by: "kage",
        reviewed_by: "me",
        item_kind: "decision",
      },
    });
    expect(facts.find((f) => f.text.includes("migration guide"))?.text).toContain(
      "owner: Sam, due: Thursday",
    );
    expect(r.memory.list({ limit: 50 }).some((m) => m.text.includes("Drop support"))).toBe(false);
  });

  it("editing an accepted item replaces its fact; rejecting removes it; reopening does not bring it back", () => {
    const { r, id, items } = seeded();
    const decision = items.find((i) => i.text.startsWith("We decided"));
    r.service.accept(decision?.id ?? "", me);
    expect(factsOf(r, id).map((f) => f.text)).toEqual([
      expect.stringContaining("We decided to ship"),
    ]);
    r.service.edit(decision?.id ?? "", { text: "Ship the Phoenix release on Saturday" }, me);
    const edited = factsOf(r, id);
    expect(edited).toHaveLength(1);
    expect(edited[0]?.text).toContain("Saturday");
    expect(edited[0]?.provenance).toMatchObject({ edited: true });
    // The old wording is gone from the index, not just hidden.
    expect(r.memory.search({ match: '"Friday"', limit: 5 })).toEqual([]);
    expect(r.memory.indexedCount()).toBe(r.memory.countUnexpired());
    r.service.reject(decision?.id ?? "", me);
    expect(factsOf(r, id)).toHaveLength(0);
    expect(r.memory.search({ match: '"Saturday"', limit: 5 })).toEqual([]);
    r.service.reopen(decision?.id ?? "", me);
    expect(factsOf(r, id)).toHaveLength(0);
  });

  it("an edited-but-not-accepted item is not a fact until it is accepted", () => {
    const { r, id, items } = seeded();
    const d = items.find((i) => i.text.startsWith("We decided"));
    r.service.edit(d?.id ?? "", { text: "Ship the Phoenix release on Saturday" }, me);
    expect(factsOf(r, id)).toHaveLength(0);
    r.service.accept(d?.id ?? "", me);
    expect(factsOf(r, id)).toHaveLength(1);
  });

  it("reports when memory refuses sensitive meeting data instead of hiding it", () => {
    const { r, items } = seeded({ allowSensitive: false });
    const out = r.service.accept(items[0]?.id ?? "", me);
    expect(out.item.status).toBe("accepted");
    expect(out.memory.stored).toBe(0);
    expect(out.memory.refused[0]).toMatch(/needs explicit permission/);
  });

  it("deleting the meeting removes its items AND the memory facts, and their index entries", () => {
    const { r, id, items } = seeded();
    const other = r.meeting("2", {
      transcript: "x",
      summary: { text: "s", decisions: ["Keep this one"] },
    });
    r.service.importKage(other);
    r.service.accept(items[0]?.id ?? "", me);
    r.service.accept(r.service.list(other)[0]?.id ?? "", { id: "me" });
    expect(factsOf(r, id)).toHaveLength(1);
    r.meetings.delete(id);
    expect(r.service.items.count(id)).toBe(0);
    expect(factsOf(r, id)).toHaveLength(0);
    expect(r.memory.search({ match: '"Phoenix"', limit: 5 })).toEqual([]);
    expect(r.memory.indexedCount()).toBe(1);
    expect(factsOf(r, other)).toHaveLength(1);
    // And a deleted meeting cannot be re-extracted or reviewed.
    expect(() => r.service.importKage(id)).toThrow(/No such meeting/);
    expect(() => r.service.accept(items[0]?.id ?? "", me)).toThrow(/No such item/);
  });
});

describe("AI extraction through the service", () => {
  it("stores grounded proposals once (a second run adds nothing, even after a reject)", async () => {
    const r = rig();
    const id = r.meeting("1", { transcript: PLANNING });
    const s = scripted(
      reply({
        kind: "decision",
        text: "Ship the Phoenix release on Friday",
        quote: "We decided to ship the Phoenix release on Friday",
      }),
    );
    r.generate.fn = s.fn;
    const first = await r.service.extractWithAi(id);
    expect(first).toMatchObject({ stored: 1, unavailable: null });
    const item = r.service.list(id)[0];
    r.service.reject(item?.id ?? "", me);
    const again = await r.service.extractWithAi(id);
    expect(again?.stored).toBe(0);
    expect(r.service.list(id)).toHaveLength(1);
    expect(r.service.list(id)[0]?.status).toBe("rejected");
  });

  it("with AI off only Kage's items are imported, and nothing breaks", async () => {
    const { r, id } = seeded();
    r.generate.fn = null;
    const report = await r.service.extract(id, { useAi: true });
    expect(report.ai).toMatchObject({
      stored: 0,
      unavailable: expect.stringMatching(/not configured/),
    });
    expect(r.service.list(id).length).toBeGreaterThan(0);
  });

  it("a meeting with no transcript yields null for AI and still imports Kage", async () => {
    const r = rig();
    const id = r.meeting("1", { summary: { text: "s", decisions: ["Use Rust"] } });
    r.generate.fn = scripted(reply()).fn;
    const report = await r.service.extract(id, { useAi: true });
    expect(report.ai).toBeNull();
    expect(report.kage.imported).toBe(1);
  });
});

describe("permission scoping of review", () => {
  it("a viewer without access cannot list, count or review a meeting, and cannot tell it exists", () => {
    const { r, id, items } = seeded();
    const nobody = { id: "guest", viewer: { id: "guest", grants: [] } };
    const scoped = {
      id: "scoped",
      viewer: {
        id: "scoped",
        grants: [{ scope: "meeting:kage:99", maxSensitivity: "sensitive" as const }],
      },
    };
    for (const actor of [nobody, scoped]) {
      expect(() => r.service.list(id, {}, actor)).toThrow(/No such meeting/);
      expect(() => r.service.counts(id, actor)).toThrow(/No such meeting/);
      expect(() => r.service.accept(items[0]?.id ?? "", actor)).toThrow(/No such item/);
      expect(() => r.service.edit(items[0]?.id ?? "", { text: "hello there" }, actor)).toThrow(
        /No such item/,
      );
    }
    // Missing and forbidden give the same message.
    let missing = "";
    let forbidden = "";
    try {
      r.service.list("kage:404", {}, nobody);
    } catch (e) {
      missing = (e as Error).message;
    }
    try {
      r.service.list(id, {}, nobody);
    } catch (e) {
      forbidden = (e as Error).message;
    }
    expect(missing).toBe(forbidden);
    // Sensitivity matters: an "internal" grant does not cover meeting items.
    const internal = {
      id: "i",
      viewer: { id: "i", grants: [{ scope: "*", maxSensitivity: "internal" as const }] },
    };
    expect(() => r.service.list(id, {}, internal)).toThrow(/No such meeting/);
    const ok = {
      id: "ok",
      viewer: { id: "ok", grants: [{ scope: "meeting:*", maxSensitivity: "sensitive" as const }] },
    };
    expect(r.service.list(id, {}, ok).length).toBeGreaterThan(0);
    expect(r.service.items.get(items[0]?.id ?? "")?.status).toBe("proposed");
  });
});
