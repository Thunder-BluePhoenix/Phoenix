// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Traceability (migration 16): meeting <-> item <-> plan <-> created task, queryable both ways,
// with who approved and when; and deleting the meeting removes all of it in the database itself.
import { describe, expect, it } from "vitest";
import { GITHUB, FRAPPE, me, planRig, scriptedModel, VENDOR_REPLY, type PlanRig } from "./helpers";

async function createdPlan(r: PlanRig, which: "decision" | "action" = "decision") {
  r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
  const item = which === "decision" ? r.decision : r.action;
  const { record } = await r.plans.generate(item.id, GITHUB, me);
  r.plans.propose(record.id, me);
  r.plans.approve(record.id, { hash: r.plans.get(record.id).contentHash }, me);
  return r.plans.create(record.id, me);
}

describe("links, both directions", () => {
  it("linksForMeeting lists every task made from the meeting; linksForTask finds the meeting from a task", async () => {
    const r = planRig();
    const report = await createdPlan(r);
    const forMeeting = r.plans.linksForMeeting(r.meetingId, me);
    expect(forMeeting).toHaveLength(2);
    expect(forMeeting.every((l) => l.meetingId === r.meetingId && l.itemId === r.decision.id)).toBe(
      true,
    );
    expect(
      forMeeting.every((l) => l.approvedBy === "me" && l.approvedAt === "2026-10-08T12:00:00.000Z"),
    ).toBe(true);
    const back = r.plans.linksForTask("github", "2");
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({
      meetingId: r.meetingId,
      itemId: r.decision.id,
      planId: report.plan.id,
      taskIndex: 1,
      url: "https://github.com/octo/phoenix/issues/2",
    });
    expect(r.plans.linksForItem(r.decision.id, me)).toHaveLength(2);
    expect(r.plans.linksForTask("github", "999")).toEqual([]);
    expect(r.plans.linksForTask("frappe", "2")).toEqual([]);
  });

  it("links of one meeting do not appear for another", async () => {
    const r = planRig();
    await createdPlan(r);
    const other = r.meeting("43", { title: "Other", transcript: "Nothing here to plan about." });
    expect(r.plans.linksForMeeting(other, me)).toEqual([]);
  });

  it("a viewer who cannot see the meeting gets 'No such meeting', not an empty list", async () => {
    const r = planRig();
    await createdPlan(r);
    const stranger = { id: "eve", viewer: { id: "eve", grants: [] } };
    expect(() => r.plans.linksForMeeting(r.meetingId, stranger)).toThrow(/No such meeting/);
    expect(() => r.plans.list(r.meetingId, stranger)).toThrow(/No such meeting/);
    expect(() => r.plans.linksForItem(r.decision.id, stranger)).toThrow(/No such item/);
  });

  it("a Frappe task links by Task name", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, FRAPPE, me);
    r.plans.propose(record.id, me);
    r.plans.approve(record.id, { hash: r.plans.get(record.id).contentHash }, me);
    await r.plans.create(record.id, me);
    expect(r.plans.linksForTask("frappe", "TASK-1")[0]).toMatchObject({
      system: "frappe",
      meetingId: r.meetingId,
    });
  });

  it("a retried task keeps exactly one link per task (no duplicates)", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, GITHUB, me);
    r.plans.propose(record.id, me);
    r.plans.approve(record.id, { hash: r.plans.get(record.id).contentHash }, me);
    const ok = r.gateway.handler;
    r.gateway.handler = (call, n) => {
      if (n === 2) throw new Error("x");
      return ok(call, n);
    };
    await r.plans.create(record.id, me);
    r.gateway.handler = ok;
    await r.plans.create(record.id, me);
    expect(r.plans.linksForMeeting(r.meetingId, me)).toHaveLength(2);
  });
});

describe("deleting the meeting", () => {
  const count = (r: PlanRig, table: string) =>
    (r.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("removes plans, task state and links in the database itself, whoever calls delete", async () => {
    const r = planRig();
    await createdPlan(r);
    const other = r.meeting("43", {
      title: "Keep me",
      transcript: "Another meeting transcript text.",
    });
    r.service.addManual(
      other,
      { kind: "decision", text: "Use the other thing", owner: null, due: null },
      me,
    );
    const keepItem = r.service.list(other)[0]!;
    r.ai.fn = null;
    const { record: keptPlan } = await r.plans.generate(keepItem.id, GITHUB, me);
    expect(count(r, "plans")).toBe(2);
    expect(count(r, "plan_links")).toBe(2);
    expect(count(r, "plan_task_runs")).toBe(2);

    expect(r.meetings.delete(r.meetingId)).toBe(true);

    expect(count(r, "plan_links")).toBe(0);
    expect(count(r, "plan_task_runs")).toBe(0);
    expect(count(r, "plans")).toBe(1);
    expect(r.plans.get(keptPlan.id, me).meetingId).toBe(other);
    expect(() => r.plans.list(r.meetingId, me)).toThrow(/No such meeting/);
  });

  it("nothing from the meeting survives anywhere in the plan tables", async () => {
    const r = planRig();
    await createdPlan(r);
    r.meetings.delete(r.meetingId);
    for (const table of ["plans", "plan_links", "plan_task_runs"]) {
      expect(JSON.stringify(r.db.prepare(`SELECT * FROM ${table}`).all()), table).toBe("[]");
    }
  });

  it("retention (deleteBefore) removes them too", async () => {
    const r = planRig();
    await createdPlan(r);
    r.meetings.deleteBefore("2027-01-01T00:00:00.000Z");
    expect(count(r, "plans")).toBe(0);
    expect(count(r, "plan_links")).toBe(0);
  });

  it("an in-flight creation for a deleted meeting stops: the item is gone", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, GITHUB, me);
    r.plans.propose(record.id, me);
    r.plans.approve(record.id, { hash: r.plans.get(record.id).contentHash }, me);
    r.meetings.delete(r.meetingId);
    await expect(r.plans.create(record.id, me)).rejects.toThrow(/No such/);
    expect(r.gateway.calls).toEqual([]);
  });
});
