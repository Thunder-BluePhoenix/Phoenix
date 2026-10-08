// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Permission, SideEffect } from "@phoenix/protocol";
import { RISK_TIERS, type Environment, type RiskTier } from "./types";

export interface RiskInput {
  sideEffect: SideEffect;
  permissions: readonly Permission[];
  environment: Environment;
}

export interface RiskAssessment {
  risk: RiskTier;
  reasons: string[];
}

export const riskAtLeast = (risk: RiskTier, floor: RiskTier): boolean =>
  RISK_TIERS.indexOf(risk) >= RISK_TIERS.indexOf(floor);

/** Side effects that change state (as opposed to reading it or calling out). */
const DESTRUCTIVE: Readonly<Record<SideEffect, boolean>> = {
  none: false,
  read: false,
  write: true,
  execute: true,
  external: false,
  production: true,
};

const BASE: Readonly<Record<SideEffect, RiskTier>> = {
  none: "low",
  read: "low",
  write: "medium",
  execute: "medium",
  external: "high",
  production: "high",
};

/**
 * Deterministic risk tier (see core/policy/README.md for the table).
 *
 * - none/read low; write/execute medium; external high
 * - "production context" = environment production, side effect production, or the
 *   production_action permission: at least high; critical when the action also
 *   changes state (write, execute or production side effect).
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  let risk = BASE[input.sideEffect];
  const reasons = [`side effect "${input.sideEffect}" is ${risk} risk`];

  const production: string[] = [];
  if (input.environment === "production") production.push('environment is "production"');
  if (input.sideEffect === "production") production.push('side effect is "production"');
  if (input.permissions.includes("production_action"))
    production.push('needs the "production_action" permission');

  if (production.length > 0) {
    if (!riskAtLeast(risk, "high")) risk = "high";
    reasons.push(`production: ${production.join(", ")}`);
    if (DESTRUCTIVE[input.sideEffect]) {
      risk = "critical";
      reasons.push(`production change (${input.sideEffect}) is critical`);
    }
  }
  return { risk, reasons };
}
