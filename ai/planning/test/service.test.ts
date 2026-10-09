// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { PhoenixError } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import {
  PLAN_STATUSES,
  PLAN_TRANSITIONS,
  canMovePlan,
  idempotencyKey,
  planHash,
  type PlanRecord,
  type PlanStatus,
} from "../src";
import {
  FRAPPE,
  GITHUB,
  VENDOR_REPLY,
  me,
  planRig,
  scriptedModel,
  sentInput,
  type PlanRig,
} from "./helpers";

async function drafted(r: PlanRig, which: "decision" | "action" = "action") {
  const item = which === "decision" ? r.decision : r.action;
  const { record } = await r.plans.generate(item.id, GITHUB, me);
  return record;
}

async function approved(r: PlanRig, includeMeetingRef = false): Promise<PlanRecord> {
  const rec = await drafted(r);
  const proposed = r.plans.propose(rec.id, me);
  return r.plans.approve(rec.id, { hash: proposed.contentHash, includeMeetingRef }, me);
}

describe("generation preconditions", () => {
  it("only an ACCEPTED decision/requirement/action item can become a plan", async () => {
    const r = planRig({ accept: false });
    await expect(r.plans.generate(r.decision.id, GITHUB, me)).rejects.toThrow(/accepted/);
    r.service.accept(r.decision.id, me);
    await expect(r.plans.generate(r.decision.id, GITHUB, me)).resolves.toBeDefined();
    r.service.reject(r.decision.id, me);
    await expect(r.plans.generate(r.decision.id, GITHUB, me)).rejects.toThrow(/rejected/);
    const topic = r.service.list(r.meetingId).find((i) => i.kind === "topic")!;
    expect(topic).toBeDefined();
    await expect(r.plans.generate(topic.id, GITHUB, me)).rejects.toThrow(/accepted|cannot become/);
  });

  it("an edited-but-unaccepted item is not enough", async () => {
    const r = planRig({ accept: false });
    r.service.edit(r.decision.id, { text: "Reworded decision text here" }, me);
    await expect(r.plans.generate(r.decision.id, GITHUB, me)).rejects.toThrow(/edited/);
  });

  it("rejects a malformed destination without calling the model", async () => {
    const r = planRig();
    const model = scriptedModel(VENDOR_REPLY);
    r.ai.fn = model.fn;
    for (const d of [
      { system: "github" as const, repository: "../etc" },
      { system: "github" as const, repository: "a/b?x=1" },
      { system: "frappe" as const, site: "bad site" },
      { system: "frappe" as const, site: "" },
    ]) {
      await expect(r.plans.generate(r.decision.id, d, me)).rejects.toThrow();
    }
    expect(model.requests).toEqual([]);
  });

  it("generates a DRAFT, stores it, calls no capability, and audits ids and counts only", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const out = await r.plans.generate(r.decision.id, FRAPPE, me);
    expect(out.record.status).toBe("draft");
    expect(out.record.approvedHash).toBeNull();
    expect(out.record.target).toBe("frappe");
    expect(r.plans.get(out.record.id).plan).toEqual(out.plan);
    expect(r.gateway.calls).toEqual([]);
    const audit = r.auditLog.find((a) => a.action === "plan.generated")!;
    expect(audit.details).toMatchObject({ plan_id: out.record.id, item_id: r.decision.id });
    expect(JSON.stringify(audit)).not.toContain("vendor");
  });

  it("with AI off the stored plan is the labelled skeleton", async () => {
    const r = planRig();
    const out = await r.plans.generate(r.action.id, GITHUB, me);
    expect(out.record.plan.notAiGenerated).toBe(true);
    expect(out.unavailable).toMatch(/not configured/);
  });
});

describe("plan status table: every pair", () => {
  // Walk a fresh plan into each status through the real service, then try every target.
  const reach: Record<PlanStatus, (r: PlanRig) => Promise<PlanRecord>> = {
    draft: drafted,
    proposed: async (r) => {
      const rec = await drafted(r);
      return r.plans.propose(rec.id, me);
    },
    approved: approved,
    creating: async (r) => {
      const rec = await approved(r);
      // Stop the creation mid-way: the gateway never answers.
      r.gateway.handler = () => new Promise(() => {});
      void r.plans.create(rec.id, me);
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      return r.plans.get(rec.id);
    },
    created: async (r) => {
      const rec = await approved(r);
      await r.plans.create(rec.id, me);
      return r.plans.get(rec.id);
    },
    failed: async (r) => {
      const rec = await approved(r);
      r.gateway.handler = () => {
        throw new Error("nope");
      };
      await r.plans.create(rec.id, me);
      return r.plans.get(rec.id);
    },
    cancelled: async (r) => {
      const rec = await drafted(r);
      return r.plans.cancel(rec.id, me);
    },
  };
  // The service method that attempts a given target status from the current one.
  const attempt: Record<PlanStatus, (r: PlanRig, rec: PlanRecord) => unknown> = {
    draft: (r, rec) => r.plans.edit(rec.id, { title: `Edited ${rec.status}` }, me),
    proposed: (r, rec) => r.plans.propose(rec.id, me),
    approved: (r, rec) => r.plans.approve(rec.id, { hash: rec.contentHash }, me),
    creating: (r, rec) => r.plans.create(rec.id, me),
    created: () => {
      throw new PhoenixError("INVALID_REQUEST", "created is reached only by finishing creation");
    },
    failed: () => {
      throw new PhoenixError("INVALID_REQUEST", "failed is reached only by a failing creation");
    },
    cancelled: (r, rec) => r.plans.cancel(rec.id, me),
  };

  for (const from of PLAN_STATUSES) {
    for (const to of PLAN_STATUSES) {
      const allowed = canMovePlan(from, to);
      // `created`/`failed` are reached only by finishing/failing creation (tested below), and
      // draft -> draft is not a move (an edit of a draft is not a status change).
      if (
        to === "created" ||
        to === "failed" ||
        (from === "draft" && to === "draft") ||
        from === "creating"
      ) {
        it(`${from} -> ${to}: ${allowed ? "allowed (internal)" : "refused"} (table)`, () => {
          expect(canMovePlan(from, to)).toBe(PLAN_TRANSITIONS[from].includes(to));
        });
        continue;
      }
      it(`${from} -> ${to}: ${allowed ? "allowed" : "refused"}`, async () => {
        const r = planRig();
        const rec = await reach[from](r);
        expect(rec.status).toBe(from);
        let outcome: "ok" | "refused" = "ok";
        try {
          const result = await attempt[to](r, rec);
          void result;
        } catch (err) {
          outcome = "refused";
          expect(err).toBeInstanceOf(PhoenixError);
        }
        const after = r.plans.get(rec.id).status;
        if (to === "draft") {
          // `edit` is the only way back to draft; refused for creating/created/cancelled.
          expect(outcome === "ok").toBe(allowed);
          if (allowed) expect(after).toBe("draft");
        } else if (to === "creating") {
          if (from === "approved" || from === "failed") {
            expect(outcome).toBe("ok");
          } else {
            expect(outcome).toBe("refused");
            expect(after).toBe(from);
          }
        } else {
          expect(outcome === "ok").toBe(allowed);
          if (!allowed) expect(after).toBe(from);
        }
      });
    }
  }

  it("the table, pair by pair (all 49), is exactly the documented one", () => {
    const allowed: Record<string, string> = {
      "draft>proposed": "",
      "draft>cancelled": "",
      "proposed>approved": "",
      "proposed>draft": "",
      "proposed>cancelled": "",
      "approved>creating": "",
      "approved>draft": "",
      "approved>cancelled": "",
      "creating>created": "",
      "creating>failed": "",
      "failed>creating": "",
      "failed>draft": "",
      "failed>cancelled": "",
    };
    let pairs = 0;
    for (const from of PLAN_STATUSES) {
      for (const to of PLAN_STATUSES) {
        pairs++;
        expect(canMovePlan(from, to), `${from}>${to}`).toBe(`${from}>${to}` in allowed);
      }
    }
    expect(pairs).toBe(49);
  });

  it("created and cancelled are final: no transition leaves them", () => {
    expect(PLAN_TRANSITIONS.created).toEqual([]);
    expect(PLAN_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe("approval is bound to the exact content", () => {
  it("approving records who, when, and the hash; the approved hash equals the content hash", async () => {
    const r = planRig();
    const rec = await approved(r);
    expect(rec.status).toBe("approved");
    expect(rec.approvedBy).toBe("me");
    expect(rec.approvedAt).toBe("2026-10-08T12:00:00.000Z");
    expect(rec.approvedHash).toBe(rec.contentHash);
    expect(planHash(rec.plan)).toBe(rec.contentHash);
  });

  it("a stale hash (the user looked at older content) cannot approve", async () => {
    const r = planRig();
    const rec = await drafted(r);
    const stale = r.plans.propose(rec.id, me).contentHash;
    r.plans.edit(rec.id, { title: "Changed after the user looked" }, me);
    r.plans.propose(rec.id, me);
    expect(() => r.plans.approve(rec.id, { hash: stale }, me)).toThrow(/changed since/);
    expect(r.plans.get(rec.id).status).toBe("proposed");
  });

  it("a wrong, empty or forged hash cannot approve", async () => {
    const r = planRig();
    const rec = await drafted(r);
    r.plans.propose(rec.id, me);
    for (const hash of ["", "abc", "0".repeat(64)]) {
      expect(() => r.plans.approve(rec.id, { hash }, me)).toThrow();
    }
  });

  it("EDITING an approved plan clears the approval and returns it to draft; creation is then refused", async () => {
    const r = planRig();
    const rec = await approved(r);
    const edited = r.plans.edit(rec.id, { title: "Sneaky change" }, me);
    expect(edited.status).toBe("draft");
    expect(edited.approvedHash).toBeNull();
    expect(edited.approvedBy).toBeNull();
    expect(edited.contentHash).not.toBe(rec.contentHash);
    await expect(r.plans.create(rec.id, me)).rejects.toThrow(/approved/);
    expect(r.gateway.calls).toEqual([]);
  });

  it("content changed behind the service's back (SQL) is caught at creation: approved hash != content", async () => {
    const r = planRig();
    const rec = await approved(r);
    const tampered = { ...rec.plan, title: "Tampered" };
    r.db
      .prepare("UPDATE plans SET content = ?, content_hash = ? WHERE id = ?")
      .run(JSON.stringify(tampered), planHash(tampered), rec.id);
    await expect(r.plans.create(rec.id, me)).rejects.toThrow(/not approved in its current form/);
    expect(r.gateway.calls).toEqual([]);
  });

  it("content changed in SQL WITHOUT updating the stored hash is caught too (recomputed from content)", async () => {
    const r = planRig();
    const rec = await approved(r);
    const tampered = { ...rec.plan, title: "Tampered" };
    r.db.prepare("UPDATE plans SET content = ? WHERE id = ?").run(JSON.stringify(tampered), rec.id);
    await expect(r.plans.create(rec.id, me)).rejects.toThrow(/not approved in its current form/);
    expect(r.gateway.calls).toEqual([]);
  });

  it("an item rejected after approval blocks creation", async () => {
    const r = planRig();
    const rec = await approved(r);
    r.service.reject(r.action.id, me);
    await expect(r.plans.create(rec.id, me)).rejects.toThrow(/rejected/);
    expect(r.gateway.calls).toEqual([]);
  });

  it("the hash changes with any content change, and not with key order", async () => {
    const r = planRig();
    const rec = await drafted(r);
    const { plan } = rec;
    expect(planHash(plan)).toBe(planHash(JSON.parse(JSON.stringify(plan))));
    expect(planHash({ ...plan, title: `${plan.title}!` })).not.toBe(planHash(plan));
    const reversed = Object.fromEntries(Object.entries(plan).reverse()) as typeof plan;
    expect(planHash(reversed)).toBe(planHash(plan));
  });

  it("cannot approve a draft (it must be proposed first) or edit a created plan", async () => {
    const r = planRig();
    const rec = await drafted(r);
    expect(() => r.plans.approve(rec.id, { hash: rec.contentHash }, me)).toThrow(/proposed/);
    const ok = await approved(planRig());
    expect(ok.status).toBe("approved");
  });
});

describe("NO SILENT CREATION: with no approval no capability command is invoked", () => {
  it("generating, proposing, editing, previewing and listing never call the gateway", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, FRAPPE, me);
    r.plans.edit(record.id, { title: "Better title" }, me);
    r.plans.propose(record.id, me);
    r.plans.preview(record.id, me);
    r.plans.list(r.meetingId, me);
    r.plans.linksForMeeting(r.meetingId, me);
    r.plans.recover();
    expect(r.gateway.calls).toEqual([]);
  });

  it("create() on a draft, proposed, cancelled or unknown plan calls nothing", async () => {
    const r = planRig();
    const draft = await drafted(r);
    await expect(r.plans.create(draft.id, me)).rejects.toThrow();
    r.plans.propose(draft.id, me);
    await expect(r.plans.create(draft.id, me)).rejects.toThrow();
    r.plans.cancel(draft.id, me);
    await expect(r.plans.create(draft.id, me)).rejects.toThrow();
    await expect(r.plans.create("plan_does_not_exist", me)).rejects.toThrow(/No such plan/);
    expect(r.gateway.calls).toEqual([]);
  });

  it("a plan another person's approval cannot be created by someone without the meeting", async () => {
    const r = planRig();
    const rec = await approved(r);
    const stranger = { id: "eve", viewer: { id: "eve", grants: [] } };
    await expect(r.plans.create(rec.id, stranger)).rejects.toThrow(/No such/);
    expect(() => r.plans.get(rec.id, stranger)).toThrow(/No such/);
    expect(r.gateway.calls).toEqual([]);
  });
});

describe("creation", () => {
  it("creates one task at a time through the gateway as the approving USER, and records each result", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, GITHUB, me);
    r.plans.propose(record.id, me);
    r.plans.approve(record.id, { hash: r.plans.get(record.id).contentHash }, me);
    const inFlight: number[] = [];
    let running = 0;
    r.gateway.handler = async (call) => {
      running++;
      inFlight.push(running);
      await Promise.resolve();
      running--;
      return {
        status: "created",
        number: r.gateway.calls.length,
        url: `https://github.com/octo/phoenix/issues/${r.gateway.calls.length}`,
        idempotency_key: sentInput(call).idempotency_key,
      };
    };
    const report = await r.plans.create(record.id, me);
    expect(report.failure).toBeNull();
    expect(report.plan.status).toBe("created");
    expect(r.gateway.calls).toHaveLength(2);
    expect(Math.max(...inFlight)).toBe(1);
    for (const call of r.gateway.calls) {
      expect(call.tool).toBe("github.issue.create");
      expect(call.actor).toEqual({ kind: "user", id: "me", trustedByUser: true });
      expect(call.dataClass).toBe("sensitive");
      expect(call.resource).toBe("github:octo/phoenix");
    }
    expect(report.runs.map((x) => x.status)).toEqual(["created", "created"]);
    expect(report.links).toHaveLength(2);
    expect(report.links[0]).toMatchObject({
      system: "github",
      externalId: "1",
      url: "https://github.com/octo/phoenix/issues/1",
      approvedBy: "me",
      meetingId: r.meetingId,
      itemId: r.decision.id,
    });
  });

  it("stops at the FIRST failure: later tasks are never attempted; the plan is failed", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, GITHUB, me);
    r.plans.propose(record.id, me);
    r.plans.approve(record.id, { hash: r.plans.get(record.id).contentHash }, me);
    r.gateway.handler = () => {
      throw new Error("GitHub refused");
    };
    const report = await r.plans.create(record.id, me);
    expect(report.failure).toEqual({ taskIndex: 0, message: "GitHub refused" });
    expect(report.plan.status).toBe("failed");
    expect(r.gateway.calls).toHaveLength(1);
    expect(report.runs.map((x) => x.status)).toEqual(["failed", "pending"]);
    expect(report.links).toEqual([]);
  });

  it("a failure on task 2 keeps task 1 created and linked; a retry creates only task 2", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, GITHUB, me);
    r.plans.propose(record.id, me);
    r.plans.approve(record.id, { hash: r.plans.get(record.id).contentHash }, me);
    const original = r.gateway.handler;
    r.gateway.handler = (call, n) => {
      if (n === 2) throw new Error("rate limited");
      return original(call, n);
    };
    const first = await r.plans.create(record.id, me);
    expect(first.plan.status).toBe("failed");
    expect(first.links).toHaveLength(1);
    r.gateway.handler = original;
    const second = await r.plans.create(record.id, me);
    expect(second.plan.status).toBe("created");
    expect(second.links.map((l) => l.taskIndex)).toEqual([0, 1]);
    // Task 0 was NOT sent again.
    expect(r.gateway.calls.map((c) => sentInput(c).idempotency_key)).toEqual([
      idempotencyKey(record.id, 0),
      idempotencyKey(record.id, 1),
      idempotencyKey(record.id, 1),
    ]);
  });

  it("the idempotency key is fixed per plan task, stored before the first attempt, and reused on retry", async () => {
    const r = planRig();
    const rec = await approved(r);
    let storedBefore: string | undefined;
    r.gateway.handler = (call) => {
      storedBefore = r.plans.runs(rec.id)[0]?.idempotencyKey;
      expect(r.plans.runs(rec.id)[0]?.status).toBe("attempting");
      throw new Error("crash simulation");
    };
    await r.plans.create(rec.id, me);
    const sent = sentInput(r.gateway.calls[0]).idempotency_key;
    expect(sent).toBe(storedBefore);
    expect(sent).toBe(idempotencyKey(rec.id, 0));
    expect(sent).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    r.gateway.handler = (call) => ({
      status: "existing",
      number: 9,
      url: "https://github.com/octo/phoenix/issues/9",
      idempotency_key: sentInput(call).idempotency_key,
    });
    const again = await r.plans.create(rec.id, me);
    expect(sentInput(r.gateway.calls[1]).idempotency_key).toBe(sent);
    expect(again.plan.status).toBe("created");
    expect(again.runs[0]?.attempts).toBe(2);
    expect(again.links).toHaveLength(1);
  });

  it("two different plans never share a key; keys match both capabilities' pattern", () => {
    expect(idempotencyKey("plan_1", 0)).not.toBe(idempotencyKey("plan_2", 0));
    expect(idempotencyKey("plan_1", 0)).not.toBe(idempotencyKey("plan_1", 1));
    expect(idempotencyKey("plan_1", 7)).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
  });

  it("CRASH RECOVERY: a plan stuck in `creating` becomes failed at startup; retry sends the same key and does not double-create", async () => {
    const r = planRig();
    const rec = await approved(r);
    // The process "died" with a request in flight: the capability had created the issue.
    const pending = Promise.withResolvers<never>();
    r.gateway.handler = () => pending.promise;
    void r.plans.create(rec.id, me).catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(r.plans.get(rec.id).status).toBe("creating");
    expect(r.plans.runs(rec.id)[0]?.status).toBe("attempting");
    expect(r.plans.recover()).toBe(1);
    expect(r.plans.get(rec.id).status).toBe("failed");
    const firstKey = sentInput(r.gateway.calls[0]).idempotency_key;
    // After the restart the capability finds the already-created issue by its key.
    r.gateway.handler = (call) => ({
      status: "existing",
      number: 1,
      url: "https://github.com/octo/phoenix/issues/1",
      idempotency_key: sentInput(call).idempotency_key,
    });
    const report = await r.plans.create(rec.id, me);
    expect(report.plan.status).toBe("created");
    expect(sentInput(r.gateway.calls[1]).idempotency_key).toBe(firstKey);
    pending.reject(new Error("old process gone"));
  });

  it("creation cannot be started twice at once", async () => {
    const r = planRig();
    const rec = await approved(r);
    const gate = Promise.withResolvers<unknown>();
    r.gateway.handler = () => gate.promise;
    const first = r.plans.create(rec.id, me);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(r.plans.create(rec.id, me)).rejects.toThrow(/Only an approved plan/);
    gate.resolve({ status: "created", number: 1, url: "https://github.com/octo/phoenix/issues/1" });
    gate.promise.then(() => {});
    r.gateway.handler = (call) => ({
      status: "created",
      number: 2,
      url: "https://github.com/octo/phoenix/issues/2",
      idempotency_key: sentInput(call).idempotency_key,
    });
    await first;
    expect(
      r.gateway.calls.filter((c) => sentInput(c).idempotency_key === idempotencyKey(rec.id, 0)),
    ).toHaveLength(1);
  });

  it("an unreadable capability answer fails the task instead of inventing a link", async () => {
    const r = planRig();
    const rec = await approved(r);
    for (const bad of [
      null,
      "x",
      {},
      { status: "created" },
      { status: "created", number: -1, url: "https://x/y" },
      { status: "created", number: 1, url: "javascript:alert(1)" },
    ]) {
      r.gateway.handler = () => bad;
      const report = await r.plans.create(rec.id, me);
      expect(report.plan.status).toBe("failed");
      expect(report.links).toEqual([]);
    }
  });

  it("the error stored for a failed task is redacted and capped", async () => {
    const r = planRig();
    const rec = await approved(r);
    const token = ["gh", "p_", "z".repeat(30)].join("");
    r.gateway.handler = () => {
      throw new Error(`failed with ${token} ${"e".repeat(2000)}`);
    };
    const report = await r.plans.create(rec.id, me);
    const stored = report.runs[0]?.error ?? "";
    expect(stored).not.toContain(token);
    expect(stored.length).toBeLessThanOrEqual(300);
  });

  it("a Frappe plan calls frappe.task.create with the site, subject <= 140 and the key", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, FRAPPE, me);
    r.plans.propose(record.id, me);
    r.plans.approve(record.id, { hash: r.plans.get(record.id).contentHash }, me);
    const report = await r.plans.create(record.id, me);
    expect(report.plan.status).toBe("created");
    const call = r.gateway.calls[0]!;
    expect(call.tool).toBe("frappe.task.create");
    expect(call.resource).toBe("frappe:erp.localhost");
    const sent = sentInput(call);
    expect(Object.keys(sent).sort()).toEqual(["description", "idempotency_key", "site", "subject"]);
    expect((sent.subject ?? "").length).toBeLessThanOrEqual(140);
    expect(sent.description ?? "").toContain("Proposed DocType: Vendor Approval");
    expect(sent.description ?? "").toContain("Pending Approval");
    expect(report.links[0]).toMatchObject({ system: "frappe", externalId: "TASK-1" });
  });
});

describe("what a created task says about the meeting (privacy default)", () => {
  it("DEFAULT: an opaque Phoenix id only — no meeting title, no meeting id, no quote, no person names", async () => {
    const r = planRig();
    const rec = await approved(r);
    await r.plans.create(rec.id, me);
    const body = sentInput(r.gateway.calls[0]).body;
    expect(body).toContain(`Phoenix plan ${rec.id}`);
    expect(body).not.toContain("Procurement planning");
    expect(body).not.toContain(r.meetingId);
    expect(body).not.toContain("kage");
    expect(body).not.toContain(r.action.evidence?.quote ?? "\0");
    expect(JSON.stringify(r.gateway.calls)).not.toContain("Procurement planning");
  });

  it("only when the person ticked the box at approval does the body name the meeting", async () => {
    const r = planRig();
    const rec = await approved(r, true);
    expect(rec.includeMeetingRef).toBe(true);
    await r.plans.create(rec.id, me);
    const body = sentInput(r.gateway.calls[0]).body;
    expect(body).toContain("Procurement planning");
    expect(body).toContain(r.meetingId);
  });

  it("the choice is part of the approval: editing clears it back to the default", async () => {
    const r = planRig();
    const rec = await approved(r, true);
    const edited = r.plans.edit(rec.id, { title: "T2" }, me);
    expect(edited.includeMeetingRef).toBe(false);
  });

  it("preview shows exactly what would be sent and the policy decision, without calling", async () => {
    const r = planRig();
    const rec = await approved(r, true);
    const preview = r.plans.preview(rec.id, me);
    expect(preview).toHaveLength(rec.plan.tasks.length);
    expect(preview[0]).toMatchObject({ tool: "github.issue.create" });
    expect(preview[0]?.decision.risk).toBe("high");
    await r.plans.create(rec.id, me);
    expect(r.gateway.calls[0]?.input).toEqual(preview[0]?.input);
  });
});

describe("editing", () => {
  it("words typed by the person are `user` text with no meeting quote claimed; untouched text keeps its basis", async () => {
    const r = planRig();
    r.ai.fn = scriptedModel(VENDOR_REPLY).fn;
    const { record } = await r.plans.generate(r.decision.id, GITHUB, me);
    const first = record.plan.tasks[0]!;
    const edited = r.plans.edit(
      record.id,
      {
        summary: "A new summary typed by me",
        tasks: [
          { title: first.title, body: first.body },
          { title: "Brand new task", body: "mine" },
        ],
      },
      me,
    );
    expect(edited.plan.summary).toEqual({ text: "A new summary typed by me", basis: "user" });
    expect(edited.plan.tasks[0]?.basis).toBe("meeting");
    expect(edited.plan.tasks[1]).toMatchObject({ title: "Brand new task", basis: "user" });
    expect(edited.plan.tasks[1]?.quote).toBeUndefined();
  });

  it("validates: empty title, too many tasks, a cross-system destination change, secrets are redacted", async () => {
    const r = planRig();
    const rec = await drafted(r);
    expect(() => r.plans.edit(rec.id, { title: "  " }, me)).toThrow();
    expect(() =>
      r.plans.edit(
        rec.id,
        { tasks: Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, body: "" })) },
        me,
      ),
    ).toThrow();
    expect(() => r.plans.edit(rec.id, { tasks: [] }, me)).toThrow();
    expect(() => r.plans.edit(rec.id, { destination: FRAPPE }, me)).toThrow(
      /between GitHub and Frappe/,
    );
    expect(() =>
      r.plans.edit(rec.id, { destination: { system: "github", repository: "../x" } }, me),
    ).toThrow();
    const token = ["gh", "p_", "q".repeat(30)].join("");
    const ok = r.plans.edit(rec.id, { title: `has ${token}` }, me);
    expect(ok.plan.title).not.toContain(token);
  });

  it("cannot edit a created, creating or cancelled plan", async () => {
    const r = planRig();
    const rec = await approved(r);
    await r.plans.create(rec.id, me);
    expect(() => r.plans.edit(rec.id, { title: "x" }, me)).toThrow(/created/);
    const other = await drafted(r);
    r.plans.cancel(other.id, me);
    expect(() => r.plans.edit(other.id, { title: "x" }, me)).toThrow(/cancelled/);
  });
});
