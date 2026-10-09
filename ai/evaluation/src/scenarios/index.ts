// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Scenario } from "../types";
import { BENCHMARK } from "./benchmark";
import { PERMISSION_ESCALATION, UNAUTHORISED_DEPLOY } from "./authority";
import { CONFLICTING_CONTEXT, STALE_MEMORY } from "./context";
import { HALLUCINATION, OBSERVED_NOT_FAILED, PARTIAL_FAILURE } from "./honesty";
import { MALICIOUS_TOOL_OUTPUT, PROMPT_INJECTION } from "./injection";

export const ALL_SCENARIOS: readonly Scenario[] = [
  ...BENCHMARK,
  ...PROMPT_INJECTION,
  ...MALICIOUS_TOOL_OUTPUT,
  ...CONFLICTING_CONTEXT,
  ...STALE_MEMORY,
  ...UNAUTHORISED_DEPLOY,
  ...PERMISSION_ESCALATION,
  ...HALLUCINATION,
  OBSERVED_NOT_FAILED,
  ...PARTIAL_FAILURE,
];
