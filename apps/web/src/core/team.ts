// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 92: team presence as Core reports it. The link (relay, identity) and the status (sharing,
// roster, who is around) are two resources; the status is only read once there is a team to speak
// of. No secret is ever part of either: Core keeps the private key in the OS secret store.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";

export const TEAM_LINK_PATH = "/api/team/link";
export const TEAM_STATUS_PATH = "/api/team/status";
export const TEAM_SHARING_PATH = "/api/team/sharing";
export const TEAM_MEMBERS_PATH = "/api/team/members";

export const TEAM_KINDS = ["deploying", "agent_run", "meeting"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];

export function isTeamKind(kind: string): kind is TeamKind {
  return (TEAM_KINDS as readonly string[]).includes(kind);
}

export interface TeamLink {
  enabled: boolean;
  connected: boolean;
  url: string | null;
  route: string | null;
  self: { id: string; public_key: string } | null;
  last_error: string | null;
}

export interface TeamItem {
  kind: string;
  since: number;
}

export interface TeamMember {
  id: string;
  label: string;
}

export interface TeamStatus {
  sharing: {
    enabled: boolean;
    consent: Record<TeamKind, boolean>;
    outgoing: { sharing: boolean; items: TeamItem[] };
  };
  members: TeamMember[];
  presence: {
    members: (TeamMember & { items: TeamItem[] })[];
    counts: Record<TeamKind, number>;
  };
}

/** `absent`: Core has no such route (no OS secret store). `failed`: any other error, with Core's words. */
export type TeamLoad =
  | { phase: "loading" }
  | { phase: "absent" }
  | { phase: "failed"; message: string | null }
  | { phase: "ready"; link: TeamLink; status: TeamStatus | null };

/** The link and, when there is a team, its status; re-read on demand and when Core comes back online. */
export function useTeam() {
  const client = useClient();
  const [load, setLoad] = useState<TeamLoad>({ phase: "loading" });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const link = await client.request<TeamLink>("GET", TEAM_LINK_PATH);
      const status =
        link.enabled || link.self !== null
          ? await client.request<TeamStatus>("GET", TEAM_STATUS_PATH)
          : null;
      if (alive.current) setLoad({ phase: "ready", link, status });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.status === 404) setLoad({ phase: "absent" });
      else setLoad({ phase: "failed", message: err instanceof ApiError ? err.message : null });
    }
  }, [client]);

  /** Replaces the status with the one a change just returned. */
  const applyStatus = useCallback((status: TeamStatus) => {
    setLoad((current) => (current.phase === "ready" ? { ...current, status } : current));
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    return () => {
      alive.current = false;
      offStatus();
    };
  }, [client, reload]);

  return { load, reload, applyStatus };
}
