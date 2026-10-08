// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  compileSchema,
  PERMISSIONS,
  SIDE_EFFECTS,
  type Permission,
  type SideEffect,
} from "@phoenix/protocol";
import {
  ACTOR_KINDS,
  DATA_CLASSES,
  ENVIRONMENTS,
  PolicyError,
  type ActorKind,
  type DataClass,
  type Environment,
  type PolicyEffect,
  type ToolRequest,
} from "./types";

/** UTC time window; wraps over midnight when `fromHourUtc > toHourUtc`. */
export interface TimeWindow {
  /** 0–23, inclusive. */
  fromHourUtc: number;
  /** 1–24, exclusive. */
  toHourUtc: number;
  /** UTC weekdays, 0 = Sunday. Omitted = every day. */
  days?: number[];
}

/** Every present field must match (AND); array fields match when any element does (OR). */
export interface RuleMatch {
  /** `capability.command`, `capability.*` or (deny / require_approval only) `*`. */
  tool?: string;
  actorKinds?: ActorKind[];
  actorId?: string;
  environments?: Environment[];
  /** Exact resource or a prefix ending in `*`. */
  resource?: string;
  dataClasses?: DataClass[];
  sideEffects?: SideEffect[];
  /** Matches when the tool needs at least one of these permissions. */
  permissions?: Permission[];
  time?: TimeWindow;
}

export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  description?: string;
  match: RuleMatch;
}

const TOOL_PATTERN = "^(\\*|[a-z][a-z0-9_-]*\\.(\\*|[a-z0-9_]+(\\.[a-z0-9_]+)*))$";
const unique = (item: Record<string, unknown>, max: number): Record<string, unknown> => ({
  type: "array",
  items: item,
  uniqueItems: true,
  minItems: 1,
  maxItems: max,
});

const RULE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["id", "effect", "match"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9_.-]{0,63}$" },
    effect: { enum: ["allow", "deny", "require_approval"] },
    description: { type: "string", maxLength: 300 },
    match: {
      type: "object",
      additionalProperties: false,
      properties: {
        tool: { type: "string", maxLength: 200, pattern: TOOL_PATTERN },
        actorKinds: unique({ enum: [...ACTOR_KINDS] }, ACTOR_KINDS.length),
        actorId: { type: "string", minLength: 1, maxLength: 200 },
        environments: unique({ enum: [...ENVIRONMENTS] }, ENVIRONMENTS.length),
        resource: { type: "string", minLength: 1, maxLength: 500 },
        dataClasses: unique({ enum: [...DATA_CLASSES] }, DATA_CLASSES.length),
        sideEffects: unique({ enum: [...SIDE_EFFECTS] }, SIDE_EFFECTS.length),
        permissions: unique({ enum: [...PERMISSIONS] }, PERMISSIONS.length),
        time: {
          type: "object",
          additionalProperties: false,
          required: ["fromHourUtc", "toHourUtc"],
          properties: {
            fromHourUtc: { type: "integer", minimum: 0, maximum: 23 },
            toHourUtc: { type: "integer", minimum: 1, maximum: 24 },
            days: unique({ type: "integer", minimum: 0, maximum: 6 }, 7),
          },
        },
      },
    },
  },
};

const checkShape = compileSchema(RULE_SCHEMA);

/** Throws `PolicyError("INVALID_RULE")` unless `value` is a well-formed, non-wildcard-for-all rule. */
export function validateRule(value: unknown): PolicyRule {
  const problems = checkShape(value);
  if (problems.length > 0) throw new PolicyError("INVALID_RULE", "Invalid policy rule", problems);
  const rule = value as PolicyRule;
  const { match } = rule;
  const extra: string[] = [];
  if (match.time && match.time.fromHourUtc === match.time.toHourUtc)
    extra.push("/match/time fromHourUtc and toHourUtc must differ");
  if (rule.effect === "allow") {
    // An allow rule is a grant: it must name its tool and environment, never "everything".
    if (!match.tool || match.tool === "*") extra.push("/match/tool an allow rule must name a tool");
    if (!match.environments?.length)
      extra.push("/match/environments an allow rule must list its environments");
    if (match.resource === "*") extra.push("/match/resource an allow rule must not match every resource");
  }
  if (extra.length > 0) throw new PolicyError("INVALID_RULE", "Invalid policy rule", extra);
  return rule;
}

/** Exact match, or prefix match when `pattern` ends in `*`. */
export function matchPattern(pattern: string, value: string): boolean {
  return pattern.endsWith("*") ? value.startsWith(pattern.slice(0, -1)) : pattern === value;
}

function inWindow(window: TimeWindow, at: Date): boolean {
  if (window.days && !window.days.includes(at.getUTCDay())) return false;
  const hour = at.getUTCHours();
  return window.fromHourUtc < window.toHourUtc
    ? hour >= window.fromHourUtc && hour < window.toHourUtc
    : hour >= window.fromHourUtc || hour < window.toHourUtc;
}

export function ruleMatches(match: RuleMatch, request: ToolRequest): boolean {
  if (match.tool !== undefined && !matchPattern(match.tool, request.tool)) return false;
  if (match.actorKinds && !match.actorKinds.includes(request.actor.kind)) return false;
  if (match.actorId !== undefined && match.actorId !== request.actor.id) return false;
  if (match.environments && !match.environments.includes(request.environment)) return false;
  if (match.resource !== undefined) {
    if (request.resource === undefined || !matchPattern(match.resource, request.resource))
      return false;
  }
  if (match.dataClasses) {
    if (request.dataClass === undefined || !match.dataClasses.includes(request.dataClass))
      return false;
  }
  if (match.sideEffects && !match.sideEffects.includes(request.sideEffect)) return false;
  if (match.permissions && !match.permissions.some((p) => request.permissions.includes(p)))
    return false;
  if (match.time && !inWindow(match.time, request.at)) return false;
  return true;
}
