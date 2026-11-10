// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { acceptanceFromReviews } from "@phoenix/ai-evaluation";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, TOKEN, type TestCore } from "./helpers";

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
});

const CANARY = "CANARY-MEETING-TEXT-Ada-Friday";
const COMMAND = "CANARY-COMMAND-rm-minus-rf";

async function boot(): Promise<TestCore> {
  const core = await startCore();
  cores.push(core);
  return core;
}

let seq = 0;
/** One reviewed meeting item, stored the way the review service leaves it (insert as proposed, then decide). */
function item(core: TestCore, kind: string, status: string): void {
  const id = `mi-${++seq}`;
  core.runtime.db
    .prepare(
      `INSERT INTO meeting_items (id, meeting_id, kind, text, owner, due, status, extracted_by, dedupe_key, created_at)
       VALUES (?, 'kage:1', ?, ?, 'Ada', 'Friday', 'proposed', 'kage', ?, '2026-10-01T10:00:00Z')`,
    )
    .run(id, kind, `${CANARY} ${id}`, id);
  if (status !== "proposed")
    core.runtime.db
      .prepare(
        "UPDATE meeting_items SET status = ?, reviewed_at = ?, reviewed_by = 'me' WHERE id = ?",
      )
      .run(status, "2026-10-01T11:00:00Z", id);
}

const approval = (kind: "permission" | "question", over: Record<string, unknown> = {}) => ({
  kind,
  agent: "claude",
  session_id: "s1",
  project: "/work/phoenix",
  ...(kind === "permission"
    ? { tool: "Bash", input_summary: { command: COMMAND } }
    : {
        tool: "AskUserQuestion",
        input_summary: {},
        questions: [
          { question: "Which one?", header: "Pick", options: [{ label: "A" }, { label: "B" }] },
        ],
      }),
  ...over,
});

async function decide(core: TestCore, kind: "permission" | "question", body: unknown) {
  const created = await core.api("POST", "/api/agent-approvals", approval(kind));
  expect(created.status).toBe(201);
  const res = await core.api("POST", `/api/agent-approvals/${created.json.id}/decision`, body);
  expect(res.status).toBe(200);
}

describe("GET /api/evaluation/acceptance", () => {
  it("needs the session token", async () => {
    const core = await boot();
    const res = await fetch(`${core.base}/api/evaluation/acceptance`);
    expect(res.status).toBe(401);
    expect(TOKEN.length).toBeGreaterThan(0);
  });

  it("is all zero and null on an empty store", async () => {
    const core = await boot();
    const res = await core.api("GET", "/api/evaluation/acceptance");
    expect(res.status).toBe(200);
    expect(res.json.acceptance).toEqual({ reviews: null, approvals: null });
    expect(res.json.reviews.decision).toEqual({ accepted: 0, rejected: 0, expired: 0 });
    expect(res.json.approvals.question).toEqual({ accepted: 0, rejected: 0, expired: 0 });
  });

  it("counts accepted, edited, rejected review decisions per kind and ignores proposed", async () => {
    const core = await boot();
    for (const [kind, status] of [
      ["decision", "accepted"],
      ["decision", "accepted"],
      ["decision", "edited"],
      ["decision", "rejected"],
      ["decision", "proposed"],
      ["action_item", "rejected"],
      ["action_item", "rejected"],
      ["action_item", "accepted"],
      ["topic", "proposed"],
    ] as const)
      item(core, kind, status);
    const { json } = await core.api("GET", "/api/evaluation/acceptance");
    expect(json.reviews.decision).toEqual({ accepted: 3, rejected: 1, expired: 0 });
    expect(json.reviews.action_item).toEqual({ accepted: 1, rejected: 2, expired: 0 });
    expect(json.reviews.topic).toEqual({ accepted: 0, rejected: 0, expired: 0 });
    // 4 accepted of 7 decided, the same number acceptanceFromReviews gives for those statuses.
    expect(json.acceptance.reviews).toBeCloseTo(
      acceptanceFromReviews([
        "accepted",
        "accepted",
        "accepted",
        "rejected",
        "rejected",
        "rejected",
        "accepted",
      ])!,
    );
    expect(json.acceptance.reviews).toBeCloseTo(4 / 7);
    expect(json.acceptance.approvals).toBeNull();
  });

  it("counts real approval decisions per kind, and seeded expiries", async () => {
    const core = await boot();
    await decide(core, "permission", { behavior: "allow" });
    await decide(core, "permission", { behavior: "allow" });
    await decide(core, "permission", { behavior: "deny", message: COMMAND });
    await decide(core, "permission", { behavior: "deny", terminal: true });
    await decide(core, "question", { behavior: "deny" });
    // The expiry path of Core is a timer (5 s minimum); the audit row it writes is seeded here.
    core.runtime.permissions.audit.record({
      actor: "system",
      action: "agent_approval.resolved",
      capabilityId: "agent_approval",
      decision: "info",
      details: {
        id: "apr_x",
        kind: "permission",
        agent: "claude",
        outcome: "expired",
        decided_by: "system",
      },
    });
    // Not user decisions, not counted: a cancelled request, and an unrelated audit row.
    core.runtime.permissions.audit.record({
      actor: "system",
      action: "agent_approval.resolved",
      capabilityId: "agent_approval",
      decision: "blocked",
      details: { id: "apr_y", kind: "permission", outcome: "cancelled", decided_by: "system" },
    });
    core.runtime.permissions.audit.record({
      actor: "x",
      action: "something.else",
      decision: "allowed",
      details: { kind: "permission", outcome: "allow" },
    });
    const { json } = await core.api("GET", "/api/evaluation/acceptance");
    expect(json.approvals.permission).toEqual({ accepted: 2, rejected: 2, expired: 1 });
    expect(json.approvals.question).toEqual({ accepted: 0, rejected: 1, expired: 0 });
    expect(json.acceptance.approvals).toBeCloseTo(2 / 6);
    expect(json.acceptance.reviews).toBeNull();
  });

  it("returns nothing but counts: no text, command, id, owner or free-form field", async () => {
    const core = await boot();
    item(core, "decision", "accepted");
    item(core, "action_item", "rejected");
    await decide(core, "permission", { behavior: "deny", message: COMMAND });
    const res = await core.api("GET", "/api/evaluation/acceptance");
    const text = JSON.stringify(res.json);
    for (const leak of [
      CANARY,
      COMMAND,
      "Ada",
      "Friday",
      "mi-",
      "apr_",
      "claude",
      "/work/phoenix",
      "kage:1",
    ])
      expect(text, leak).not.toContain(leak);
    const leaves: unknown[] = [];
    const walk = (v: unknown): void => {
      if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
      else leaves.push(v);
    };
    walk(res.json);
    expect(leaves.every((v) => v === null || typeof v === "number")).toBe(true);
    expect(Object.keys(res.json).sort()).toEqual(["acceptance", "approvals", "reviews"]);
  });

  it("is read-only: reading changes no row", async () => {
    const core = await boot();
    item(core, "decision", "accepted");
    const count = () =>
      [
        core.runtime.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get(),
        core.runtime.db.prepare("SELECT COUNT(*) AS n FROM meeting_items").get(),
      ].map((r) => (r as { n: number }).n);
    const before = count();
    await core.api("GET", "/api/evaluation/acceptance");
    await core.api("GET", "/api/evaluation/acceptance");
    expect(count()).toEqual(before);
  });
});
