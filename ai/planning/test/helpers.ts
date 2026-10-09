// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { GenerateRequest, GenerateResult } from "@phoenix/ai-models";
import type { ToolCall, ToolCallResult } from "@phoenix/ai-tool-gateway";
import type { PolicyDecision } from "@phoenix/policy";
import type { MeetingItem } from "@phoenix/ai-meetings";
import { rig as meetingRig, type Rig as MeetingRig } from "../../meetings/test/helpers";
import { PlanService, type Destination, type GenerateFn, type ToolCaller } from "../src";

/** The input of a recorded call as strings (every field the planner sends is a string or a list). */
export function sentInput(call: ToolCall | undefined): Record<string, string> {
  const input: unknown = call?.input;
  if (typeof input !== "object" || input === null) throw new Error("no recorded call input");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input))
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  return out;
}

export const NOW = new Date("2026-10-08T12:00:00.000Z");
export const me = { id: "me" };
export const GITHUB: Destination = { system: "github", repository: "octo/phoenix" };
export const FRAPPE: Destination = { system: "frappe", site: "erp.localhost" };

export const TRANSCRIPT = [
  "Maya: We need a vendor approval flow so purchasing can approve new suppliers before the first order.",
  "Sam: Agreed. Sam will write the migration guide by Thursday.",
  "Maya: Finance managers must be able to approve, and requesters should only see their own requests.",
].join("\n");

export const SUMMARY = {
  text: "Vendor approval and migration guide.",
  decisions: ["We need a vendor approval flow so purchasing can approve new suppliers"],
  action_items: [{ text: "Write the migration guide", owner: "Sam", due: "Thursday" }],
  topics: ["procurement"],
};

export interface PlanRig extends MeetingRig {
  plans: PlanService;
  gateway: FakeGateway;
  ai: { fn: GenerateFn | null };
  auditLog: { action: string; details: Record<string, unknown> }[];
  meetingId: string;
  decision: MeetingItem;
  action: MeetingItem;
}

const DECISION_ALLOW: PolicyDecision = {
  effect: "require_approval",
  risk: "high",
  reasons: ["fake"],
  matched: [],
};

/** A ToolCaller that records every call and answers like the real capabilities do. */
export class FakeGateway implements ToolCaller {
  readonly calls: ToolCall[] = [];
  readonly previews: ToolCall[] = [];
  /** Called for each call; throw to fail it. Default: create a fresh resource per key. */
  handler: (call: ToolCall, n: number) => Promise<unknown> | unknown;
  private readonly byKey: Record<string, unknown> = {};
  private seq = 0;

  constructor() {
    this.handler = (call) => this.defaultAnswer(call);
  }

  private defaultAnswer(call: ToolCall): unknown {
    const key = sentInput(call).idempotency_key ?? "";
    const known = this.byKey[key];
    if (known) return { ...(known as object), status: "existing" };
    const n = ++this.seq;
    const made =
      call.tool === "github.issue.create"
        ? { status: "created", number: n, url: `https://github.com/octo/phoenix/issues/${n}` }
        : { status: "created", name: `TASK-${n}`, url: `http://127.0.0.1:8000/app/task/TASK-${n}` };
    this.byKey[key] = made;
    return made;
  }

  preview(call: ToolCall): PolicyDecision {
    this.previews.push(call);
    return DECISION_ALLOW;
  }

  async call(call: ToolCall): Promise<ToolCallResult> {
    this.calls.push(call);
    const output = await this.handler(call, this.calls.length);
    return {
      tool: call.tool,
      output,
      operationId: `op_${this.calls.length}`,
      decision: DECISION_ALLOW,
      auditId: this.calls.length,
    };
  }
}

export function planRig(over: { accept?: boolean } = {}): PlanRig {
  const base = meetingRig();
  const gateway = new FakeGateway();
  const ai: { fn: GenerateFn | null } = { fn: null };
  const auditLog: PlanRig["auditLog"] = [];
  let n = 0;
  const meetingId = base.meeting("42", {
    title: "Procurement planning",
    transcript: TRANSCRIPT,
    summary: SUMMARY,
  });
  base.service.importKage(meetingId);
  const items = base.service.list(meetingId);
  const decision = items.find((i) => i.kind === "decision");
  const action = items.find((i) => i.kind === "action_item");
  if (!decision || !action) throw new Error("fixture items missing");
  if (over.accept !== false) {
    base.service.accept(decision.id, me);
    base.service.accept(action.id, me);
  }
  const plans = new PlanService({
    db: base.db,
    items: base.service,
    meetings: base.meetings,
    gateway,
    audit: (action, details) => auditLog.push({ action, details }),
    generate: () => ai.fn,
    now: () => NOW,
    newId: () => `plan_${++n}`,
    nonce: () => "NONCE",
  });
  return {
    ...base,
    plans,
    gateway,
    ai,
    auditLog,
    meetingId,
    decision: base.service.get(decision.id),
    action: base.service.get(action.id),
  };
}

export function scriptedModel(
  reply: string | ((request: GenerateRequest) => string),
  model = "llama3.2",
): { fn: GenerateFn; requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  const fn: GenerateFn = (request) => {
    requests.push(request);
    const result: GenerateResult = {
      text: typeof reply === "string" ? reply : reply(request),
      provenance: {
        provider: "ollama",
        model,
        locality: "local",
        processedBy: `Ollama · ${model} · on this device`,
      },
    };
    return Promise.resolve(result);
  };
  return { fn, requests };
}

/** A realistic model reply for the vendor approval requirement (Frappe). */
export const VENDOR_REPLY = JSON.stringify({
  title: "Vendor Approval flow",
  summary: {
    text: "Purchasing approves new suppliers before the first order",
    quote: "vendor approval flow so purchasing can approve new suppliers",
  },
  acceptance_criteria: [
    {
      text: "Finance managers can approve a vendor",
      quote: "Finance managers must be able to approve",
    },
    {
      text: "Requesters see only their own requests",
      quote: "requesters should only see their own requests",
    },
    { text: "Rejected vendors cannot be ordered from", quote: null },
  ],
  tasks: [
    {
      title: "Create the Vendor Approval DocType",
      body: "Fields, workflow and permissions as proposed.",
      labels: ["doctype"],
      quote: "We need a vendor approval flow",
    },
    {
      title: "Add an email notification on approval",
      body: "",
      labels: [],
      quote: "this was never said anywhere in the meeting",
    },
  ],
  risks: [{ text: "Existing suppliers need migrating", quote: null }],
  open_questions: ["Which roles may approve above a threshold?"],
  frappe: {
    doctype: "Vendor Approval",
    fields: [
      { label: "Vendor", fieldtype: "Link", required: true },
      { label: "Requested By", fieldtype: "Link", required: true },
      { label: "Reason", fieldtype: "Small Text", required: false },
      { label: "Bogus", fieldtype: "Not A Type", required: false },
    ],
    workflow_states: ["Draft", "Pending Approval", "Approved", "Rejected"],
    permissions: [
      { role: "Purchase User", read: true, write: true, create: true },
      { role: "Finance Manager", read: true, write: true, create: false },
    ],
  },
});
