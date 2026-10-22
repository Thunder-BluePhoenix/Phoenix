// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The tools Phoenix offers an MCP client. Read tools return data; `phoenix_request_approval` raises
// the SAME card as Phase 56 through the real AgentApprovals API and returns only allow/deny + the
// owner's message; `phoenix_notify` tells Fawkes a state. Deciding an approval is NOT a tool: only
// the owner UI or a paired phone can do that.
import type { Viewer } from "@phoenix/ai-memory";
import { ErrorCode, PhoenixError, createEvent } from "@phoenix/protocol";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { McpClientStore } from "@phoenix/persistence";
import type { AgentApprovalCreateResult, AgentApprovalWaitResult } from "@phoenix/api";
import { redactText } from "@phoenix/capability-terminal";
import { exactKeys, intArg, McpToolError, textArg } from "./args";
import { APPROVAL_TOOL, NOTIFY_TOOL, readStoredGrants, viewerFor, type McpGrants } from "./grants";
import { RateWindow } from "./rate";
import { MCP_NOTIFY_EVENTS } from "./state-rules";

/** Longest a single approval call waits; the client polls with `approval_id` for more. */
export const MAX_APPROVAL_WAIT_MS = 25_000;
export const MAX_OPEN_APPROVALS_PER_CLIENT = 5;
export const NOTIFY_PER_MINUTE = 20;
/** How long a card an MCP client raised waits for the owner (the approval API's default). */
export const MCP_APPROVAL_TIMEOUT_MS = 120_000;
/**
 * `action` is the only client text that goes on the first lines of the card: the card description
 * is capped at 500 characters and Core's own attribution line takes up to 113 of them.
 */
export const MAX_ACTION_CHARS = 380;
const RESULT_LIMIT = 20;
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** The client name as Core shows it on a card: no hidden characters, no quote that could end it early. */
export function attributionName(name: string): string {
  const clean = name.replace(HIDDEN, "").replaceAll('"', "'").trim();
  return clean.length > 0 ? clean : "unnamed";
}

/** The data the read tools draw on. The runtime builds it from the real parts; tests inject fakes. */
export interface McpBackends {
  activity(limit: number): Promise<unknown>;
  /** True while the owner lets meeting data into Phoenix at all (memory setting). */
  meetingsAllowed(): boolean;
  searchMeetings(query: string, viewer: Viewer, limit: number): unknown;
  graphQuery(question: string, viewer: Viewer): Promise<unknown>;
  gitState(clientId: string): Promise<unknown>;
  searchMemory(query: string, viewer: Viewer, domain: string | undefined, limit: number): unknown;
}

/** The two AgentApprovals methods the approval tool uses (the real class satisfies it). */
export interface McpApprovals {
  create(body: unknown, via?: "relay" | "http"): AgentApprovalCreateResult;
  wait(id: string, body: unknown): Promise<AgentApprovalWaitResult>;
}

export interface McpToolDeps {
  backends: McpBackends;
  approvals: McpApprovals;
  bus: Pick<EventBus, "publish">;
  /** Read again right before a card is raised, so a revocation is never outrun. */
  clients: Pick<McpClientStore, "get">;
  logger: Logger;
  now: () => number;
}

export interface McpCaller {
  id: string;
  /** The id without its prefix, used to build the agent id `mcp-<slug>`. */
  slug: string;
  grants: McpGrants;
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  allowed(grants: McpGrants): boolean;
  run(caller: McpCaller, args: Record<string, unknown>): Promise<unknown> | unknown;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length > 0 ? { required } : {}),
});

const limitProperty = { type: "integer", minimum: 1, maximum: RESULT_LIMIT };

export class McpTools {
  private readonly defs: McpToolDef[];
  /** Approvals a client created and may poll: `<client>:<approval>` -> its nonce and expiry. */
  private readonly open = new Map<string, { nonce: string; expiresAt: number }>();
  private readonly notifyRate = new RateWindow(NOTIFY_PER_MINUTE, 60_000);

  constructor(private readonly d: McpToolDeps) {
    this.defs = [
      {
        name: "phoenix_activity",
        description:
          "Recent coding-agent sessions on this computer: agent, project folder name, whether active, and their latest steps. Redacted.",
        inputSchema: object({ limit: limitProperty }),
        allowed: (g) => g.tools.includes("phoenix_activity"),
        run: async (_c, args) => {
          exactKeys(args, ["limit"]);
          return this.d.backends.activity(intArg(args, "limit", 1, RESULT_LIMIT, 10));
        },
      },
      {
        name: "phoenix_meetings",
        description:
          "Search the decisions, action items and summaries of meetings the owner allowed this client to see.",
        inputSchema: object({ query: { type: "string", maxLength: 500 }, limit: limitProperty }, [
          "query",
        ]),
        allowed: (g) => g.tools.includes("phoenix_meetings"),
        run: (caller, args) => {
          exactKeys(args, ["query", "limit"]);
          const query = textArg(args, "query", 500, true)!;
          if (!this.d.backends.meetingsAllowed())
            throw new McpToolError("Meeting data is switched off in Phoenix's memory settings");
          const viewer = viewerFor(caller.id, caller.grants, true);
          return this.d.backends.searchMeetings(
            query,
            viewer,
            intArg(args, "limit", 1, RESULT_LIMIT, 10),
          );
        },
      },
      {
        name: "phoenix_graph_query",
        description:
          "Ask the knowledge graph a question that names an entity (a commit, issue, pull request, person, decision). Returns facts with their paths, limited to what this client may see.",
        inputSchema: object({ question: { type: "string", maxLength: 500 } }, ["question"]),
        allowed: (g) => g.tools.includes("phoenix_graph_query"),
        run: (caller, args) => {
          exactKeys(args, ["question"]);
          const question = textArg(args, "question", 500, true)!;
          return this.d.backends.graphQuery(question, viewerFor(caller.id, caller.grants, false));
        },
      },
      {
        name: "phoenix_ci_git_state",
        description:
          "Branch and change state of the watched repositories (git) and open pull requests with the latest CI run (GitHub), when those capabilities are on.",
        inputSchema: object({}),
        allowed: (g) => g.tools.includes("phoenix_ci_git_state"),
        run: (caller, args) => {
          exactKeys(args, []);
          return this.d.backends.gitState(caller.id);
        },
      },
      {
        name: "phoenix_memory_search",
        description:
          "Search what Phoenix remembers (commits, project docs), limited to the memory scopes the owner granted this client.",
        inputSchema: object(
          {
            query: { type: "string", maxLength: 500 },
            domain: { type: "string", maxLength: 40 },
            limit: limitProperty,
          },
          ["query"],
        ),
        allowed: (g) => g.tools.includes("phoenix_memory_search") && g.memory.length > 0,
        run: (caller, args) => {
          exactKeys(args, ["query", "domain", "limit"]);
          const query = textArg(args, "query", 500, true)!;
          const domain = textArg(args, "domain", 40);
          return this.d.backends.searchMemory(
            query,
            viewerFor(caller.id, caller.grants, false),
            domain,
            intArg(args, "limit", 1, RESULT_LIMIT, 10),
          );
        },
      },
      {
        name: APPROVAL_TOOL,
        description:
          "Ask the owner to approve an action. Shows the same approval card as other coding agents and returns only allow or deny plus the owner's message. Waits up to 25 seconds; if still pending it returns an approval_id: call again with that approval_id to keep waiting. Never act before an allow.",
        inputSchema: object({
          action: { type: "string", maxLength: MAX_ACTION_CHARS },
          command: { type: "string", maxLength: 2000 },
          path: { type: "string", maxLength: 1000 },
          detail: { type: "string", maxLength: 2000 },
          approval_id: { type: "string", maxLength: 100 },
          wait_ms: { type: "integer", minimum: 1, maximum: MAX_APPROVAL_WAIT_MS },
        }),
        allowed: (g) => g.request_approval,
        run: (caller, args) => this.requestApproval(caller, args),
      },
      {
        name: NOTIFY_TOOL,
        description:
          "Tell Fawkes what you are doing: working, waiting (for the owner) or done. Optional short message.",
        inputSchema: object(
          {
            state: { type: "string", enum: Object.keys(MCP_NOTIFY_EVENTS) },
            message: { type: "string", maxLength: 200 },
          },
          ["state"],
        ),
        allowed: (g) => g.notify,
        run: (caller, args) => this.notify(caller, args),
      },
    ];
  }

  /** The tools this caller may see: an ungranted tool is not listed. */
  list(grants: McpGrants) {
    return this.defs
      .filter((t) => t.allowed(grants))
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }

  /** "unknown" and "not_granted" are told apart only in the audit log, never to the client. */
  availability(name: string, grants: McpGrants): "ok" | "unknown" | "not_granted" {
    const def = this.defs.find((t) => t.name === name);
    if (!def) return "unknown";
    return def.allowed(grants) ? "ok" : "not_granted";
  }

  async run(name: string, caller: McpCaller, args: Record<string, unknown>): Promise<unknown> {
    const def = this.defs.find((t) => t.name === name);
    if (!def) throw new McpToolError("Unknown tool");
    return def.run(caller, args);
  }

  /** Forget a revoked client's open approvals (the cards stay for the owner to answer or expire). */
  forget(clientId: string): void {
    for (const key of this.open.keys()) {
      if (key.startsWith(`${clientId}:`)) this.open.delete(key);
    }
  }

  forgetAll(): void {
    this.open.clear();
  }

  private async requestApproval(
    caller: McpCaller,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    exactKeys(args, ["action", "command", "path", "detail", "approval_id", "wait_ms"]);
    const waitMs = intArg(args, "wait_ms", 1, MAX_APPROVAL_WAIT_MS, MAX_APPROVAL_WAIT_MS);
    const pollId = textArg(args, "approval_id", 100);
    let approvalId: string;
    let nonce: string;
    if (pollId !== undefined) {
      const known = this.open.get(`${caller.id}:${pollId}`);
      if (known === undefined) throw new McpToolError("Unknown or finished approval_id");
      approvalId = pollId;
      nonce = known.nonce;
    } else {
      const created = this.createApproval(caller, args);
      if ("early" in created) return created.early;
      approvalId = created.id;
      nonce = created.nonce;
      this.open.set(`${caller.id}:${approvalId}`, {
        nonce,
        expiresAt: created.expiresAt,
      });
    }
    let waited: AgentApprovalWaitResult;
    try {
      waited = await this.d.approvals.wait(approvalId, { nonce, wait_ms: waitMs });
    } catch (err) {
      this.open.delete(`${caller.id}:${approvalId}`);
      if (err instanceof PhoenixError)
        throw new McpToolError("The approval is no longer available");
      throw err;
    }
    if (waited.status === "pending")
      return {
        status: "pending",
        approval_id: approvalId,
        note: "Not decided yet. Call again with this approval_id to keep waiting. Do not act yet.",
      };
    this.open.delete(`${caller.id}:${approvalId}`);
    if (waited.status === "decided")
      return {
        status: "decided",
        decision: waited.decision.behavior,
        ...(waited.decision.message === undefined ? {} : { message: waited.decision.message }),
      };
    return { status: waited.status, decision: "deny" };
  }

  private createApproval(
    caller: McpCaller,
    args: Record<string, unknown>,
  ): { id: string; nonce: string; expiresAt: number } | { early: unknown } {
    const action = textArg(args, "action", MAX_ACTION_CHARS, true)!;
    const command = textArg(args, "command", 2000);
    const path = textArg(args, "path", 1000);
    const detail = textArg(args, "detail", 2000);
    this.sweepOpen();
    const mine = [...this.open.keys()].filter((k) => k.startsWith(`${caller.id}:`)).length;
    if (mine >= MAX_OPEN_APPROVALS_PER_CLIENT)
      throw new McpToolError("Too many approvals are still waiting for the owner");
    // Re-read the record immediately before the card exists: a client revoked (or stripped of this
    // grant) after the request was authenticated must not put a card in front of the owner.
    const fresh = this.d.clients.get(caller.id);
    if (!fresh || fresh.revokedAt !== null || !readStoredGrants(fresh.grants).request_approval)
      throw new McpToolError("Access was revoked");
    let created: AgentApprovalCreateResult;
    try {
      created = this.d.approvals.create(
        {
          kind: "permission",
          agent: `mcp-${caller.slug}`,
          session_id: `mcp-client-${caller.slug}`,
          project: `/mcp/${caller.slug}`,
          tool: "mcp.request_approval",
          timeout_ms: MCP_APPROVAL_TIMEOUT_MS,
          input_summary: {
            // The first line is Core's, built from the stored record: the client cannot write it.
            description: `MCP client "${attributionName(fresh.name)}" (${fresh.id})\n${action}`,
            ...(command === undefined ? {} : { command }),
            ...(path === undefined ? {} : { path }),
            ...(detail === undefined ? {} : { detail }),
          },
        },
        "http",
      );
    } catch (err) {
      // Control or bidirectional characters, over-long text: the message names the field only.
      if (err instanceof PhoenixError && err.code === ErrorCode.INVALID_REQUEST)
        throw new McpToolError(err.message);
      throw err;
    }
    if (created.status === "pending")
      return {
        id: created.id,
        nonce: created.nonce,
        // On this module's own clock (the card was created with MCP_APPROVAL_TIMEOUT_MS just now).
        expiresAt: this.d.now() + MCP_APPROVAL_TIMEOUT_MS,
      };
    if (created.status === "decided")
      return {
        early: {
          status: "decided",
          decision: created.decision.behavior,
          ...(created.decision.message === undefined ? {} : { message: created.decision.message }),
        },
      };
    return { early: { status: "unavailable", decision: "deny", reason: created.reason } };
  }

  /** Forgets approvals whose time ran out unanswered, so abandoned ones cannot fill a client's slots. */
  private sweepOpen(): void {
    const now = this.d.now();
    for (const [key, entry] of this.open) {
      if (entry.expiresAt <= now) this.open.delete(key);
    }
  }

  private notify(caller: McpCaller, args: Record<string, unknown>): unknown {
    exactKeys(args, ["state", "message"]);
    const state = args.state;
    if (typeof state !== "string" || !Object.hasOwn(MCP_NOTIFY_EVENTS, state))
      throw new McpToolError('"state" must be working, waiting or done');
    const message = textArg(args, "message", 200);
    if (!this.notifyRate.take(caller.id, this.d.now()))
      throw new McpToolError("Too many notifications; try again in a minute");
    const eventType = MCP_NOTIFY_EVENTS[state as keyof typeof MCP_NOTIFY_EVENTS];
    // Own namespace (`mcp.agent.*`): `agent.*` triggers and rules are for real coding agents.
    // Ephemeral: a chatty client cannot fill the durable event history.
    const result = this.d.bus.publish(
      createEvent({
        event_type: eventType,
        source: "mcp",
        severity: "info",
        correlation_id: `mcp-${caller.slug}`,
        subject: `mcp-${caller.slug}`,
        payload: {
          agent: `mcp-${caller.slug}`,
          state,
          ...(message === undefined ? {} : { message: redactText(message) }),
        },
      }),
      { ephemeral: true },
    );
    if (!result.ok) {
      this.d.logger.warn("mcp notify event rejected", { code: result.error.code });
      throw new McpToolError("Phoenix could not accept that notification");
    }
    return { delivered: true, state };
  }
}
