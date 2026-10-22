// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { TeamLinkStatus } from "../../runtime/src/team-status/link";
import type { TeamStatusView } from "../../runtime/src/team-status/service";
import { expectObject, route, type Route } from "./http";

/** Session-token routes only: joining a team and pinning a teammate are the owner's decisions. */
export interface TeamLinkApi {
  status(): TeamLinkStatus;
  enable(input: unknown): Promise<TeamLinkStatus>;
  pause(): Promise<TeamLinkStatus>;
  leave(): Promise<TeamLinkStatus>;
  addMember(input: unknown): Promise<TeamStatusView>;
  removeMember(id: string): TeamStatusView;
}

export function teamLinkRoutes(service: TeamLinkApi): Route[] {
  return [
    route("GET", "/api/team/link", () => service.status()),
    route("POST", "/api/team/link", async ({ body }) => service.enable(expectObject(await body()))),
    route("DELETE", "/api/team/link", () => service.leave()),
    route("POST", "/api/team/link/pause", () => service.pause()),
    route("POST", "/api/team/members", async ({ body }) =>
      service.addMember(expectObject(await body())),
    ),
    route("DELETE", "/api/team/members/:id", ({ params }) => {
      const id = params.id ?? "";
      if (!/^tm_[a-f0-9]{12}$/.test(id))
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Not a team member id");
      return service.removeMember(id);
    }),
  ];
}
