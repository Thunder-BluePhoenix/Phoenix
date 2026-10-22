// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What an MCP client may do. A new client has NO grants; the owner adds them one by one in Settings.
// Memory is readable only through the client's OWN scope grants (the Phase 29 `canView` rules): a
// client never gets the owner's viewer.
import { MEMORY_DOMAINS, type MemoryDomain, type Viewer } from "@phoenix/ai-memory";
import { PRIVACY_CLASSES, type PrivacyClass } from "@phoenix/ai-models";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { isRecord } from "./guards";

export const READ_TOOLS = [
  "phoenix_activity",
  "phoenix_meetings",
  "phoenix_graph_query",
  "phoenix_ci_git_state",
  "phoenix_memory_search",
] as const;
export const APPROVAL_TOOL = "phoenix_request_approval";
export const NOTIFY_TOOL = "phoenix_notify";

export const MAX_MEMORY_GRANTS = 10;

/** One memory scope the owner opened to a client (same shape as ai/memory's `ScopeGrant`). */
export interface McpMemoryGrant {
  scope: string;
  max_sensitivity: PrivacyClass;
  /** Absent = every domain the scope holds (meeting data is still excluded unless the meetings tool is used). */
  domains?: MemoryDomain[];
}

export interface McpGrants {
  /** Read tools the client may call (subset of {@link READ_TOOLS}). */
  tools: string[];
  memory: McpMemoryGrant[];
  /** May raise an approval card. Separate from the read tools. */
  request_approval: boolean;
  /** May tell Fawkes its state (working, waiting, done). Separate from the read tools. */
  notify: boolean;
}

export const noGrants = (): McpGrants => ({
  tools: [],
  memory: [],
  request_approval: false,
  notify: false,
});

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

/** `*`, `global`, or `repo:`/`path:`/`meeting:` plus text, optionally ending in `*` (a prefix). */
const SCOPE = /^(?:\*|global|(?:repo|path|meeting):[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}*]{0,200}\*?)$/u;

function exactKeys(body: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(`Unknown ${what} field "${key.slice(0, 40)}"`);
  }
}

function parseMemoryGrant(value: unknown): McpMemoryGrant {
  if (!isRecord(value)) throw invalid("A memory grant must be an object");
  exactKeys(value, ["scope", "max_sensitivity", "domains"], "memory grant");
  const { scope, max_sensitivity: sensitivity, domains } = value;
  if (typeof scope !== "string" || !SCOPE.test(scope))
    throw invalid('A memory grant "scope" must be "*", "global" or repo:/path:/meeting: text');
  if (
    typeof sensitivity !== "string" ||
    !(PRIVACY_CLASSES as readonly string[]).includes(sensitivity)
  )
    throw invalid('"max_sensitivity" must be public, internal or sensitive');
  const grant: McpMemoryGrant = { scope, max_sensitivity: sensitivity as PrivacyClass };
  if (domains !== undefined) {
    if (
      !Array.isArray(domains) ||
      domains.length === 0 ||
      domains.length > MEMORY_DOMAINS.length ||
      domains.some(
        (d) => typeof d !== "string" || !(MEMORY_DOMAINS as readonly string[]).includes(d),
      )
    )
      throw invalid('"domains" must be a non-empty list of known memory domains');
    grant.domains = [...new Set(domains as MemoryDomain[])];
  }
  return grant;
}

/** Strict parse of what the owner sent. Throws; unknown fields and tool names are refused. */
export function parseGrants(input: unknown): McpGrants {
  if (!isRecord(input)) throw invalid("Grants must be an object");
  exactKeys(input, ["tools", "memory", "request_approval", "notify"], "grants");
  const { tools, memory, request_approval: approval, notify } = input;
  if (
    !Array.isArray(tools) ||
    tools.some((t) => typeof t !== "string" || !(READ_TOOLS as readonly string[]).includes(t))
  )
    throw invalid(`"tools" must list only: ${READ_TOOLS.join(", ")}`);
  if (!Array.isArray(memory) || memory.length > MAX_MEMORY_GRANTS)
    throw invalid(`"memory" must be a list of at most ${MAX_MEMORY_GRANTS} grants`);
  if (typeof approval !== "boolean" || typeof notify !== "boolean")
    throw invalid('"request_approval" and "notify" must be true or false');
  return {
    tools: [...new Set(tools as string[])],
    memory: memory.map(parseMemoryGrant),
    request_approval: approval,
    notify,
  };
}

/** What is stored, read back. A damaged value means NO grants (fail closed), never an error. */
export function readStoredGrants(stored: unknown): McpGrants {
  try {
    return parseGrants(stored);
  } catch {
    return noGrants();
  }
}

/**
 * The viewer a client's memory reads run as. Meeting data is excluded here unless `includeMeetings`
 * (only the meetings tool passes it): a `*` grant must not leak a meeting through memory search or
 * the graph.
 */
export function viewerFor(clientId: string, grants: McpGrants, includeMeetings: boolean): Viewer {
  return {
    id: `mcp:${clientId}`,
    grants: grants.memory.flatMap((g) => {
      const domains = includeMeetings
        ? g.domains
        : (g.domains ?? MEMORY_DOMAINS).filter((d) => d !== "meeting");
      if (domains !== undefined && domains.length === 0) return [];
      return [
        {
          scope: g.scope,
          maxSensitivity: g.max_sensitivity,
          ...(domains === undefined ? {} : { domains }),
        },
      ];
    }),
  };
}
