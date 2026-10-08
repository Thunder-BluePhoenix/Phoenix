// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The router is a pure function: same task + same state = same plan. It never calls a provider.
// Hard rules refuse a provider (privacy gate, capability, cost cap, offline); soft factors only
// order the providers that survive (user choice, availability, latency, cost).
import { checkGate, type CloudOptIn, type ExternalAiPolicy } from "./gate";
import type { CostTier, ModelProvider, PrivacyClass, TaskKind } from "./types";

export interface RouteTask {
  kind: TaskKind;
  privacy: PrivacyClass;
  /** Providers whose typical latency is above this are ordered after those within budget. */
  latencyBudgetMs?: number;
  /** Hard cap: providers above this cost tier are refused. */
  maxCostTier?: CostTier;
  /** The user's chosen provider id. Wins among providers that are allowed; never overrides a refusal. */
  preferred?: string;
  /**
   * Why the call is made. Only matters for sensitive data, where the cloud gate accepts a fixed
   * list of purposes (SENSITIVE_CLOUD_PURPOSES). Absent = no purpose = never a cloud provider.
   */
  purpose?: string;
}

/** The facts about a provider the router needs. A ModelProvider satisfies this. */
export type RouterProvider = Pick<
  ModelProvider,
  "id" | "label" | "locality" | "capabilities" | "costTier" | "typicalLatencyMs"
>;

export interface RouterState {
  providers: readonly RouterProvider[];
  /** Last known availability per provider id. Missing = not checked yet. */
  health: Readonly<Record<string, boolean | undefined>>;
  policy: ExternalAiPolicy;
  cloudOptIn: CloudOptIn;
}

export interface RouteCandidate {
  providerId: string;
  label: string;
  locality: RouterProvider["locality"];
  /** Why this provider is placed where it is. Never empty for an allowed candidate. */
  reasons: string[];
  /** Set exactly when the provider may not be used for this task. */
  refusedBecause?: string;
}

export interface RoutePlan {
  task: RouteTask;
  /** Allowed candidates in the order to try them, then refused ones (in provider id order). */
  candidates: RouteCandidate[];
  /** Ids of the allowed candidates, in order to try. */
  order: string[];
  /** Plan-level remarks, for example that the preferred provider was refused and why. */
  notes: string[];
}

interface Ranked {
  candidate: RouteCandidate;
  key: [number, number, number, number, number, string];
}

export function route(task: RouteTask, state: RouterState): RoutePlan {
  const ranked: Ranked[] = [];
  const refused: RouteCandidate[] = [];
  const notes: string[] = [];

  const providers = [...state.providers].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of providers) {
    const base = { providerId: p.id, label: p.label, locality: p.locality };
    // 1. Privacy gate: a hard rule, evaluated before anything else so its reason is the one shown.
    const gate = checkGate(p.locality, task.privacy, state.policy, state.cloudOptIn, task.purpose ?? "");
    if (!gate.allowed) {
      refused.push({ ...base, reasons: [], refusedBecause: gate.reason });
      continue;
    }
    // 2. Capability.
    if (!p.capabilities[task.kind]) {
      refused.push({ ...base, reasons: [], refusedBecause: `does not support ${task.kind}` });
      continue;
    }
    // 3. Cost cap.
    if (task.maxCostTier !== undefined && p.costTier > task.maxCostTier) {
      refused.push({
        ...base,
        reasons: [],
        refusedBecause: `cost tier ${p.costTier} is above the allowed ${task.maxCostTier}`,
      });
      continue;
    }
    // 4. Offline availability (only when a health check has said so).
    const up = state.health[p.id];
    if (up === false) {
      refused.push({
        ...base,
        reasons: [],
        refusedBecause: "unavailable (offline or not running)",
      });
      continue;
    }

    const reasons: string[] = [];
    const isPreferred = task.preferred === p.id;
    if (isPreferred) reasons.push("chosen by the user");
    reasons.push(
      p.locality === "local"
        ? "runs on this device; data stays local"
        : `cloud allowed: AI_external_processing granted and opted in for ${task.privacy} data`,
    );
    reasons.push(up === true ? "available" : "availability not checked");
    const overBudget =
      task.latencyBudgetMs !== undefined && p.typicalLatencyMs > task.latencyBudgetMs;
    if (task.latencyBudgetMs !== undefined) {
      reasons.push(
        overBudget
          ? `typical latency ${p.typicalLatencyMs} ms is over the ${task.latencyBudgetMs} ms budget`
          : `typical latency ${p.typicalLatencyMs} ms is within the ${task.latencyBudgetMs} ms budget`,
      );
    }
    reasons.push(`cost tier ${p.costTier}`);
    ranked.push({
      candidate: { ...base, reasons },
      key: [
        isPreferred ? 0 : 1,
        up === true ? 0 : 1,
        overBudget ? 1 : 0,
        p.costTier,
        p.typicalLatencyMs,
        p.id,
      ],
    });
  }

  ranked.sort(compareKeys);
  const allowed = ranked.map((r) => r.candidate);
  if (task.preferred !== undefined) {
    const refusal = refused.find((c) => c.providerId === task.preferred);
    if (refusal) {
      notes.push(`preferred provider ${task.preferred} was not used: ${refusal.refusedBecause}`);
    } else if (!providers.some((p) => p.id === task.preferred)) {
      notes.push(`preferred provider ${task.preferred} is not registered`);
    }
  }
  return {
    task,
    candidates: [...allowed, ...refused],
    order: allowed.map((c) => c.providerId),
    notes,
  };
}

function compareKeys(a: Ranked, b: Ranked): number {
  for (let i = 0; i < a.key.length; i++) {
    const x = a.key[i]!;
    const y = b.key[i]!;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
