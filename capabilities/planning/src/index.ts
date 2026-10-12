// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Only aggregate metadata crosses the Core-to-capability boundary. Plan preview, task text,
// destination, meeting identity, and idempotency keys are never handed to the tool gateway.
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { defineCapability } from "@phoenix/sdk";

export interface PlanReviewContext {
  plan_id: string;
  status: "draft" | "proposed" | "approved" | "creating" | "created" | "failed" | "cancelled";
  task_count: number;
  meeting_grounded_count: number;
  suggested_count: number;
  user_edited_count: number;
  criteria_count: number;
  risk_count: number;
  open_question_count: number;
}

export interface PlanningServices {
  reviewContext(planId: string): PlanReviewContext;
}
const STATUSES: Record<PlanReviewContext["status"], true> = {
  draft: true,
  proposed: true,
  approved: true,
  creating: true,
  created: true,
  failed: true,
  cancelled: true,
};
const COUNTS = [
  "task_count",
  "meeting_grounded_count",
  "suggested_count",
  "user_edited_count",
  "criteria_count",
  "risk_count",
  "open_question_count",
] as const;

/** Refuse expanded or malformed service data before any sensitive content crosses the gateway. */
function checkedContext(value: unknown, requestedId: string): PlanReviewContext {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 9 ||
    !Object.hasOwn(value, "plan_id") ||
    !("plan_id" in value) ||
    value.plan_id !== requestedId ||
    !Object.hasOwn(value, "status") ||
    !("status" in value) ||
    typeof value.status !== "string" ||
    !Object.hasOwn(STATUSES, value.status)
  ) {
    throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Plan review context is invalid");
  }
  const counts: Partial<Record<(typeof COUNTS)[number], number>> = {};
  for (const field of COUNTS) {
    if (!Object.hasOwn(value, field))
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Plan review context is invalid");
    const count: unknown = Reflect.get(value, field);
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 100)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Plan review context is invalid");
    counts[field] = count;
  }
  // Construct a fresh allowlisted object; extra service fields and prototypes are never forwarded.
  const status = value.status as PlanReviewContext["status"];
  return {
    plan_id: requestedId,
    status,
    task_count: counts.task_count!,
    meeting_grounded_count: counts.meeting_grounded_count!,
    suggested_count: counts.suggested_count!,
    user_edited_count: counts.user_edited_count!,
    criteria_count: counts.criteria_count!,
    risk_count: counts.risk_count!,
    open_question_count: counts.open_question_count!,
  };
}

export function createPlanningCapability(
  options: { services?: () => PlanningServices | undefined } = {},
) {
  return defineCapability({
    manifest: {
      id: "plans",
      name: "Plan review context",
      version: "0.1.0",
      description:
        "Read-only, text-free aggregate context for advisory review of a user's engineering plan; requires sensitive-meeting opt-in.",
      license: "GPL-3.0-or-later",
      events: [],
      permissions: [],
      data_categories: [
        "plan status and bounded aggregate counts from sensitive meeting-derived plans",
      ],
      commands: [
        {
          name: "review_context",
          description: "Read bounded, redacted plan metadata, never task text or preview inputs",
          side_effect: "read",
          input_schema: {
            type: "object",
            required: ["plan_id"],
            additionalProperties: false,
            properties: { plan_id: { type: "string", pattern: "^plan_[0-9a-f]{32}$" } },
          },
        },
      ],
    },
    commands: {
      review_context(input) {
        if (
          typeof input !== "object" ||
          input === null ||
          Array.isArray(input) ||
          Object.keys(input).length !== 1 ||
          !Object.hasOwn(input, "plan_id") ||
          !("plan_id" in input) ||
          typeof input.plan_id !== "string" ||
          !/^plan_[0-9a-f]{32}$/.test(input.plan_id)
        ) {
          throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid plan identifier");
        }
        const services = options.services?.();
        if (!services) {
          throw new PhoenixError(
            ErrorCode.CAPABILITY_UNAVAILABLE,
            "Plan review requires Core's authorized planning service",
          );
        }
        return checkedContext(services.reviewContext(input.plan_id), input.plan_id);
      },
    },
  });
}
