// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Vercel capability (Phase 67): watches deployments and turns them into vercel.deploy.* events
// (DEPLOYING / SUCCESS / ERROR in Fawkes, and Deployment nodes in the knowledge graph).
// Read-only by default: the poller only GETs the deployment list and pauses while nothing is
// watching. The one write is `redeploy`, an external command that always asks the user first.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import {
  nextDelay,
  realSleep,
  safeBaseUrl,
  ServiceError,
  startPolling,
  type ServiceItem,
  type ServiceStatus,
  type Sleep,
} from "@phoenix/service-kit";
import {
  createVercelClient,
  getDeployment,
  listDeployments,
  redeploy,
  VERCEL_API,
  SERVICE,
} from "./client";
import { deploymentTracker, diffDeployments } from "./events";
import type { CreatedDeployment, Deployment } from "./parse";

export * from "./client";
export * from "./events";
export * from "./parse";

export const DEFAULT_POLL_MS = 30_000;
export const MIN_POLL_MS = 5_000;
export const DEPLOYMENTS_PER_POLL = 20;
const MAX_STATUS_ITEMS = 10;
const MAX_REMEMBERED_KEYS = 200;

export const ID_PATTERN = "^[A-Za-z0-9_-]{1,100}$";
export const IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9_-]{16,80}$";
const ID_RE = new RegExp(ID_PATTERN);
/** https, or http to loopback; no credentials, query or fragment (safeBaseUrl re-checks at use). */
const URL_PATTERN =
  "^(https://[^\\s@?#]+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?(/[^\\s@?#]*)?)$";

export interface VercelCapabilityOptions {
  /** Epoch ms clock; tests pin it. */
  now?: () => number;
  /** Waits between polls; resolves early when `signal` aborts. Tests control time with it. */
  sleep?: Sleep;
}

interface Settings {
  baseUrl: string | undefined;
  teamId: string | undefined;
  project: string | undefined;
  pollMs: number;
}

function settings(ctx: CapabilityContext): Settings {
  const { base_url, team_id, project, poll_ms } = ctx.config;
  const baseUrl = typeof base_url === "string" ? safeBaseUrl(base_url) : VERCEL_API;
  return {
    baseUrl,
    teamId: typeof team_id === "string" && ID_RE.test(team_id) ? team_id : undefined,
    project:
      typeof project === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(project) ? project : undefined,
    pollMs: typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS,
  };
}

interface RedeployInput {
  deployment_id: string;
  idempotency_key: string;
}

function isRedeployInput(v: unknown): v is RedeployInput {
  return (
    typeof v === "object" &&
    v !== null &&
    "deployment_id" in v &&
    typeof v.deployment_id === "string" &&
    "idempotency_key" in v &&
    typeof v.idempotency_key === "string"
  );
}

/** What `redeploy` returns. */
export interface RedeployResult {
  status: "started" | "already_requested";
  deployment_id: string;
  state: string;
  url?: string | undefined;
  idempotency_key: string;
}

/** A failure the service answered definitively (nothing was started), so the key may be reused. */
const DEFINITE: ReadonlySet<ServiceError["kind"]> = new Set([
  "auth",
  "forbidden",
  "not_found",
  "rate_limit",
]);

function item(d: Deployment): ServiceItem {
  return {
    id: d.id,
    title: `${d.project} (${d.target})`,
    state: d.state.toLowerCase(),
    ...(d.branch ? { detail: d.branch } : {}),
    ...(d.url ? { url: d.url } : {}),
    at: new Date(d.createdAt).toISOString(),
  };
}

function asServiceError(err: unknown): ServiceError {
  return err instanceof ServiceError
    ? err
    : new ServiceError(SERVICE, "http", `Unexpected error while talking to ${SERVICE}`);
}

/** A fresh capability instance (its own watcher state); Phoenix Core uses one per runtime. */
export function createVercelCapability(options: VercelCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  let tracker = deploymentTracker(0);
  let liveSince = 0;
  let latest: Deployment[] = [];
  let polled = false;
  let hasSecret = false;
  let failure: ServiceError | undefined;
  let failures = 0;
  /** idempotency_key → outcome of the redeploy it started (or null: sent, outcome unknown). */
  const redeploys = new Map<string, Promise<CreatedDeployment | null>>();

  async function cycle(ctx: CapabilityContext): Promise<number> {
    const s = settings(ctx);
    const secret = await ctx.secret("token");
    hasSecret = !!secret;
    failure = undefined;
    if (secret && s.baseUrl) {
      try {
        const client = createVercelClient({ baseUrl: s.baseUrl, secret, signal: ctx.signal });
        latest = await listDeployments(client, {
          teamId: s.teamId,
          project: s.project,
          limit: DEPLOYMENTS_PER_POLL,
        });
        for (const event of diffDeployments(tracker, latest)) void ctx.emit(event);
      } catch (err) {
        failure = asServiceError(err);
      }
    }
    polled = true;
    failures = failure ? failures + 1 : 0;
    return nextDelay(s.pollMs, failures, failure);
  }

  async function clientFor(ctx: CapabilityContext) {
    const { baseUrl } = settings(ctx);
    const secret = await ctx.secret("token");
    if (!secret) throw new ServiceError(SERVICE, "auth", "Add a Vercel token in Settings first");
    if (!baseUrl) throw new ServiceError(SERVICE, "invalid", "base_url must be https or loopback");
    return createVercelClient({ baseUrl, secret, signal: ctx.signal });
  }

  async function startRedeploy(
    ctx: CapabilityContext,
    input: RedeployInput,
  ): Promise<CreatedDeployment | null> {
    const client = await clientFor(ctx);
    const { teamId } = settings(ctx);
    // A failed lookup is definite: nothing has been sent that could start a deployment.
    const source = await getDeployment(client, input.deployment_id, teamId);
    try {
      return await redeploy(client, source, teamId);
    } catch (err) {
      const e = asServiceError(err);
      if (DEFINITE.has(e.kind)) throw e;
      return null;
    }
  }

  return defineCapability({
    manifest: {
      id: "vercel",
      name: "Vercel",
      version: "0.1.0",
      description:
        "Vercel deployments from your account or team: Fawkes shows DEPLOYING, SUCCESS and ERROR, and deployments reach the knowledge graph. Watching is read-only (GET only) and pauses while nothing is watching Phoenix. The one command that changes anything, redeploy, rebuilds an existing deployment only after you approve it. Needs a Vercel access token.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["vercel.deploy.*"],
      permissions: ["network", "external_api"],
      data_categories: [
        "Vercel project names",
        "deployment states and environments",
        "git branch and commit of a deployment",
      ],
      healthcheck: { interval_ms: 15_000 },
      secrets: [
        {
          name: "token",
          description:
            "Vercel access token (Account Settings, Tokens), scoped to the team you watch. Needed to list deployments; redeploy also uses it, after you approve.",
        },
      ],
      commands: [
        {
          name: "status",
          description: "The latest deployments of your Vercel account or team",
          side_effect: "read",
          permissions: ["network", "external_api"],
        },
        {
          name: "redeploy",
          description:
            "Rebuilds an existing Vercel deployment as a new deployment. Changes your Vercel project and always asks for your confirmation. Safe to repeat with the same idempotency_key: a second call does not start a second deployment.",
          side_effect: "external",
          permissions: ["network", "external_api"],
          timeout_ms: 60_000,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["deployment_id", "idempotency_key"],
            properties: {
              deployment_id: { type: "string", pattern: ID_PATTERN },
              idempotency_key: { type: "string", pattern: IDEMPOTENCY_KEY_PATTERN },
            },
          },
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          base_url: {
            type: "string",
            pattern: URL_PATTERN,
            description: `API base URL (default ${VERCEL_API}). Plain http is only accepted for localhost.`,
          },
          team_id: {
            type: "string",
            pattern: ID_PATTERN,
            description: "Team to watch (team_...); empty for your personal account",
          },
          project: {
            type: "string",
            pattern: "^[A-Za-z0-9._-]{1,100}$",
            description: "Only watch this project (name or id)",
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 3_600_000,
            description: `Milliseconds between checks (default ${DEFAULT_POLL_MS})`,
          },
        },
      },
      state_rules: [
        {
          match: "vercel.deploy.started",
          effect: {
            state: "DEPLOYING",
            explain: "Deploying to {payload.environment}",
            timeoutMs: 60 * 60_000,
          },
        },
        {
          match: "vercel.deploy.succeeded",
          effect: { state: "SUCCESS", explain: "Deployed to {payload.environment}", ttlMs: 8_000 },
        },
        {
          match: "vercel.deploy.failed",
          effect: { state: "ERROR", explain: "Deploy failed: {subject}" },
        },
        { match: "vercel.deploy.cancelled", effect: { clear: true } },
      ],
    },
    init(ctx) {
      latest = [];
      polled = false;
      failure = undefined;
      failures = 0;
      redeploys.clear();
      // History rule: anything that began before this moment is background, not news.
      liveSince = now();
      tracker = deploymentTracker(liveSince);
      startPolling(ctx, () => cycle(ctx), sleep);
    },
    commands: {
      async status(_input, ctx): Promise<ServiceStatus> {
        const secret = await ctx.secret("token");
        if (!secret)
          return { configured: false, items: [], note: "Add a Vercel token in Settings" };
        const { teamId, project } = settings(ctx);
        try {
          const list = await listDeployments(await clientFor(ctx), {
            teamId,
            project,
            limit: MAX_STATUS_ITEMS,
          });
          return { configured: true, items: list.slice(0, MAX_STATUS_ITEMS).map(item) };
        } catch (err) {
          throw asServiceError(err);
        }
      },
      async redeploy(input, ctx): Promise<RedeployResult> {
        if (!isRedeployInput(input) || !ID_RE.test(input.deployment_id)) {
          throw new ServiceError(SERVICE, "invalid", "deployment_id is not a valid id");
        }
        const known = redeploys.get(input.idempotency_key);
        const repeated = known !== undefined;
        let attempt = known;
        if (!attempt) {
          attempt = startRedeploy(ctx, input);
          redeploys.set(input.idempotency_key, attempt);
          while (redeploys.size > MAX_REMEMBERED_KEYS) {
            redeploys.delete(redeploys.keys().next().value as string);
          }
        }
        let created: CreatedDeployment | null;
        try {
          created = await attempt;
        } catch (err) {
          // Nothing was started: the same key may be used again.
          redeploys.delete(input.idempotency_key);
          throw asServiceError(err);
        }
        if (created === null) {
          throw new ServiceError(
            SERVICE,
            "network",
            "The redeploy request was sent but its outcome is unknown; check your deployments, then retry with a new idempotency_key",
          );
        }
        return {
          status: repeated ? "already_requested" : "started",
          deployment_id: created.id,
          state: created.state.toLowerCase(),
          ...(created.url ? { url: created.url } : {}),
          idempotency_key: input.idempotency_key,
        };
      },
    },
    health(ctx): HealthResult {
      if (!settings(ctx).baseUrl)
        return { status: "unhealthy", message: "base_url must be https or loopback" };
      if (polled && !hasSecret)
        return { status: "degraded", message: "Add a Vercel token in Settings" };
      if (!polled) return { status: "healthy", message: "Reading Vercel…" };
      if (failure?.kind === "auth" || failure?.kind === "rate_limit") {
        return { status: "degraded", message: failure.message };
      }
      if (failure) return { status: "unhealthy", message: failure.message };
      return { status: "healthy", message: `Watching ${latest.length} recent deployments` };
    },
  });
}
