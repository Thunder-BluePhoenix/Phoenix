// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";
import type { CoreServices } from "./services";

/** Session-token-only model status; no HTTP path accepts or returns capture bytes. */
export function multimodalRoutes(services: CoreServices): Route[] {
  return [
    route("GET", "/api/multimodal/status", () => {
      if (!services.multimodal)
        throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Multimodal status unavailable");
      return services.multimodal.status();
    }),
  ];
}
