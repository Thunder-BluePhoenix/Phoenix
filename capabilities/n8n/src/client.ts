// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// n8n public-API client (`/api/v1`, header X-N8N-API-KEY). n8n is self-hosted, so the address is
// the user's `base_url`: https, or http to loopback; the key is sent only there and redirects are
// never followed. Polling GETs only; the two writes (retry an execution, deactivate a workflow)
// are separate approved commands.
import { seg, ServiceClient } from "@phoenix/service-kit";
import {
  parseDeactivated,
  parseExecutions,
  parseRetried,
  parseWorkflows,
  type Execution,
  type Workflow,
} from "./parse";

export const SERVICE = "n8n";
const API = "/api/v1";

export interface N8nClientOptions {
  /** Already checked with `safeBaseUrl`. */
  baseUrl: string;
  secret: string | undefined;
  signal: AbortSignal;
}

export function createN8nClient(o: N8nClientOptions): ServiceClient {
  return new ServiceClient({
    service: SERVICE,
    baseUrl: o.baseUrl,
    secret: o.secret,
    auth: (secret) => ({ "x-n8n-api-key": secret }),
    signal: o.signal,
  });
}

export function listWorkflows(client: ServiceClient, limit: number): Promise<Workflow[]> {
  return client.get(`${API}/workflows?limit=${limit}`, parseWorkflows);
}

/** `includeData=false`: what the workflows processed is never requested. */
export function listExecutions(client: ServiceClient, limit: number): Promise<Execution[]> {
  return client.get(`${API}/executions?limit=${limit}&includeData=false`, parseExecutions);
}

/** Runs a past execution again (n8n: POST /executions/{id}/retry). */
export function retryExecution(client: ServiceClient, id: string): Promise<{ id: string }> {
  return client.post(`${API}/executions/${seg(id)}/retry`, {}, parseRetried);
}

/** Switches a workflow off (n8n: POST /workflows/{id}/deactivate). */
export function deactivateWorkflow(client: ServiceClient, id: string): Promise<Workflow> {
  return client.post(`${API}/workflows/${seg(id)}/deactivate`, {}, parseDeactivated);
}
