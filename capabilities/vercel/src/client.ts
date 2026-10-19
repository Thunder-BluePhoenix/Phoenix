// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Vercel REST client. Polling only ever calls GET (list deployments). The one write, a redeploy,
// is a separate command that goes through the approval gateway; it uses the same client class
// because Vercel has no separate write credential.
import { seg, ServiceClient } from "@phoenix/service-kit";
import {
  parseCreated,
  parseDeployment,
  parseDeployments,
  type CreatedDeployment,
  type Deployment,
} from "./parse";

export const VERCEL_API = "https://api.vercel.com";
export const SERVICE = "Vercel";

export interface VercelClientOptions {
  /** Already checked with `safeBaseUrl`. */
  baseUrl: string;
  secret: string | undefined;
  signal: AbortSignal;
}

export function createVercelClient(o: VercelClientOptions): ServiceClient {
  return new ServiceClient({
    service: SERVICE,
    baseUrl: o.baseUrl,
    secret: o.secret,
    // The token is sent only to the configured base_url.
    auth: (secret) => ({ authorization: `Bearer ${secret}` }),
    signal: o.signal,
  });
}

/** A team scope as a query string fragment; empty for a personal account. */
function scope(teamId: string | undefined): string {
  return teamId ? `teamId=${encodeURIComponent(teamId)}` : "";
}

function query(...parts: string[]): string {
  const joined = parts.filter((p) => p !== "").join("&");
  return joined === "" ? "" : `?${joined}`;
}

export function listDeployments(
  client: ServiceClient,
  options: { teamId?: string | undefined; project?: string | undefined; limit: number },
): Promise<Deployment[]> {
  const project = options.project ? `projectId=${encodeURIComponent(options.project)}` : "";
  return client.get(
    `/v6/deployments${query(`limit=${options.limit}`, project, scope(options.teamId))}`,
    parseDeployments,
  );
}

export function getDeployment(
  client: ServiceClient,
  id: string,
  teamId: string | undefined,
): Promise<Deployment> {
  return client.get(`/v13/deployments/${seg(id)}${query(scope(teamId))}`, (body) => {
    const parsed = parseDeployment(body as Record<string, unknown>);
    if (!parsed) throw new TypeError("unusable deployment");
    return parsed;
  });
}

/** Rebuilds `source` as a new deployment of the same project (Vercel: POST /v13/deployments). */
export function redeploy(
  client: ServiceClient,
  source: Deployment,
  teamId: string | undefined,
): Promise<CreatedDeployment> {
  return client.post(
    `/v13/deployments${query("forceNew=1", scope(teamId))}`,
    {
      name: source.project,
      deploymentId: source.id,
      ...(source.target === "preview" ? {} : { target: source.target }),
    },
    parseCreated,
  );
}
