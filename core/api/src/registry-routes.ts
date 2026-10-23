// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";
import type { CoreServices } from "./services";

export function registryRoutes(services: CoreServices): Route[] {
  const registry = services.registry;
  return [
    route("GET", "/api/registry", () => {
      if (!registry)
        throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Local registry not configured");
      return registry.browse();
    }),
    route("GET", "/api/registry/:id/:version", ({ params }) => {
      if (!registry)
        throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Local registry not configured");
      return registry.preview(params.id!, params.version!);
    }),
    route("POST", "/api/registry/skins/:id/:version/install", ({ params }) => {
      if (!registry)
        throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Local registry not configured");
      return registry.installSkin(params.id!, params.version!);
    }),
    route("POST", "/api/registry/:id/:version/install", () => {
      if (!registry)
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          "Third-party executable installation requires an audited OS sandbox",
        );
      return registry.install();
    }),
  ];
}
