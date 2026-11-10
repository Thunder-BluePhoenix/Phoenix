// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";
import type { CoreServices } from "./services";

/** Phase 33: read-only acceptance counts. Session-token user route only; not a capability or tool. */
export interface EvaluationApi {
  /** Counts of review and approval decisions per kind (no text) and the derived acceptance rates. */
  acceptance(): unknown;
}

export function evaluationRoutes(s: CoreServices): Route[] {
  return [
    route("GET", "/api/evaluation/acceptance", () => {
      if (!s.evaluation)
        throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Evaluation not available");
      return s.evaluation.acceptance();
    }),
  ];
}
