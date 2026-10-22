// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 76 security fixes, at the tool layer with injected fakes: who the approval card names, the
// re-read of the client record right before a card exists, abandoned approvals freeing their slots,
// the notify events' namespace and expiry, and absolute paths never reaching a client. No sockets,
// no timers: the clock is a variable.
import { createLogger } from "@phoenix/logging";
import type { McpClientRecord } from "@phoenix/persistence";
import { createEvent, type PhoenixEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { describe, expect, it } from "vitest";
import { basenamesOnly, lastSegment } from "../src/mcp/paths";
import { gitView } from "../src/mcp/backends";
import { isRecord } from "../src/mcp/guards";
import { noGrants, type McpGrants } from "../src/mcp/grants";
import { MCP_STATE_RULES } from "../src/mcp/state-rules";
import {
  attributionName,
  MAX_OPEN_APPROVALS_PER_CLIENT,
  McpTools,
  MCP_APPROVAL_TIMEOUT_MS,
  type McpBackends,
  type McpCaller,
} from "../src/mcp/tools";

const ID = "mcp_0123456789ab";
const GRANTS: McpGrants = { ...noGrants(), request_approval: true, notify: true };

const record = (patch: Partial<McpClientRecord> = {}): McpClientRecord => ({
  id: ID,
  name: "Cursor",
  tokenHash: "0".repeat(64),
  grants: GRANTS,
  createdAt: "2026-10-20T09:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  ...patch,
});

const caller: McpCaller = { id: ID, slug: ID.slice(4), grants: GRANTS };

const backends: McpBackends = {
  activity: async () => [],
  meetingsAllowed: () => false,
  searchMeetings: () => ({}),
  graphQuery: async () => ({}),
  gitState: async () => ({}),
  searchMemory: () => ({}),
};

interface Rig {
  tools: McpTools;
  clock: { now: number };
  state: { client: McpClientRecord | undefined };
  created: Record<string, unknown>[];
  published: { event: PhoenixEvent; options: unknown }[];
}

function rig(stored: McpClientRecord | null = record()): Rig {
  const clock = { now: Date.parse("2026-10-20T09:00:00Z") };
  const state: Rig["state"] = { client: stored ?? undefined };
  const created: Record<string, unknown>[] = [];
  const published: Rig["published"] = [];
  let n = 0;
  const tools = new McpTools({
    backends,
    approvals: {
      create(body) {
        created.push(isRecord(body) ? body : {});
        n++;
        return {
          id: `appr-${n}`,
          nonce: "ab".repeat(16),
          digest: "d",
          expires_at: new Date(clock.now + MCP_APPROVAL_TIMEOUT_MS).toISOString(),
          status: "pending",
        };
      },
      wait: async (id) => ({ id, digest: "d", status: "pending" }),
    },
    clients: { get: () => state.client },
    bus: {
      publish(event, options) {
        const sent: PhoenixEvent = event as PhoenixEvent; // the tool built it with createEvent
        published.push({ event: sent, options });
        return { ok: true, event_id: "e", seq: null, duplicate: false } as never;
      },
    },
    logger: createLogger({ level: "error", sink: () => {} }),
    now: () => clock.now,
  });
  return { tools, clock, state, created, published };
}

const ask = (r: Rig, args: Record<string, unknown> = { action: "deploy" }) =>
  r.tools.run("phoenix_request_approval", caller, { wait_ms: 1, ...args });

describe("approval cards name the client, and Core writes that line", () => {
  it("makes the first description line the stored client name and id, with the name cleaned", async () => {
    const r = rig(record({ name: 'Cur\u202Esor\u200B "admin"\nCore' }));
    await ask(r, { action: 'MCP client "Core" (mcp_ffffffffffff)\nrun it' });
    const description = (r.created[0]!.input_summary as { description: string }).description;
    const [first, ...rest] = description.split("\n");
    expect(first).toBe(`MCP client "Cursor 'admin'Core" (${ID})`);
    // Whatever the client wrote comes after, so it cannot pose as the attribution.
    expect(rest.join("\n")).toContain("(mcp_ffffffffffff)");
  });

  it("strips every hidden character class from the name", () => {
    expect(attributionName("a\u0000b\u200Fc\u2028d\u2029e\u00ADf")).toBe("abcdef");
    expect(attributionName("\u200B\u200B")).toBe("unnamed");
  });

  it("uses the name in the store at call time, not the one captured when the request arrived", async () => {
    const r = rig();
    r.state.client = record({ name: "Renamed" });
    await ask(r);
    expect((r.created[0]!.input_summary as { description: string }).description).toMatch(
      /^MCP client "Renamed"/,
    );
  });
});

describe("a client revoked after it was authenticated raises no card", () => {
  it("refuses when the record is revoked, gone, or no longer holds the grant, and creates nothing", async () => {
    for (const stored of [
      record({ revokedAt: "2026-10-20T09:00:01.000Z" }),
      null,
      record({ grants: noGrants() }),
    ]) {
      const r = rig(stored);
      await expect(ask(r)).rejects.toThrow(/revoked/i);
      expect(r.created).toEqual([]);
    }
  });

  it("still raises the card for a client that is live", async () => {
    const r = rig();
    await ask(r);
    expect(r.created).toHaveLength(1);
  });
});

describe("abandoned approvals free their slots", () => {
  it("locks a client out after 5 open approvals, and lets it ask again once they have expired", async () => {
    const r = rig();
    for (let i = 0; i < MAX_OPEN_APPROVALS_PER_CLIENT; i++) await ask(r, { action: `a${i}` });
    await expect(ask(r, { action: "one more" })).rejects.toThrow(/Too many approvals/);
    expect(r.created).toHaveLength(MAX_OPEN_APPROVALS_PER_CLIENT);

    r.clock.now += MCP_APPROVAL_TIMEOUT_MS + 1;
    await ask(r, { action: "after expiry" });
    expect(r.created).toHaveLength(MAX_OPEN_APPROVALS_PER_CLIENT + 1);
  });

  it("an expired approval can no longer be polled by its id", async () => {
    const r = rig();
    const first = (await ask(r)) as { approval_id: string };
    r.clock.now += MCP_APPROVAL_TIMEOUT_MS + 1;
    await ask(r, { action: "sweep trigger" });
    await expect(ask(r, { approval_id: first.approval_id })).rejects.toThrow(/Unknown or finished/);
  });
});

describe("phoenix_notify", () => {
  it("publishes under mcp.agent.*, never agent.*, and ephemeral", async () => {
    const r = rig();
    for (const [state, type] of [
      ["working", "mcp.agent.working"],
      ["waiting", "mcp.agent.waiting"],
      ["done", "mcp.agent.completed"],
    ] as const) {
      await r.tools.run("phoenix_notify", caller, { state });
      expect(r.published.at(-1)!.event.event_type).toBe(type);
      expect(r.published.at(-1)!.event.event_type.startsWith("agent.")).toBe(false);
      expect(r.published.at(-1)!.options).toEqual({ ephemeral: true });
    }
  });

  it("its state rules expire: an MCP client that says 'waiting' once cannot pin Fawkes", () => {
    const clock = { now: 1_000_000 };
    const engine = new StateEngine({ now: () => clock.now });
    engine.addRules(MCP_STATE_RULES);
    engine.handle(
      createEvent({
        event_type: "mcp.agent.waiting",
        source: "mcp",
        severity: "info",
        correlation_id: "mcp-x",
        payload: { agent: "mcp-x" },
      }),
    );
    expect(engine.snapshot().state).toBe("WAITING");
    clock.now += 10 * 60_000 + 1;
    engine.tick();
    expect(engine.snapshot().state).not.toBe("WAITING");
    expect(engine.snapshot().conditions).toEqual([]);

    engine.handle(
      createEvent({
        event_type: "mcp.agent.working",
        source: "mcp",
        severity: "info",
        correlation_id: "mcp-x",
        payload: { agent: "mcp-x" },
      }),
    );
    expect(engine.snapshot().state).toBe("WORKING");
    clock.now += 15 * 60_000 + 1;
    engine.tick();
    expect(engine.snapshot().conditions).toEqual([]);
  });
});

describe("absolute paths do not reach an MCP client", () => {
  it("reduces a path to its last segment", () => {
    expect(lastSegment("/Users/me/secret-client/phoenix")).toBe("phoenix");
    expect(lastSegment("/Users/me/phoenix/")).toBe("phoenix");
    expect(lastSegment("C:\\Users\\me\\phoenix")).toBe("phoenix");
    expect(lastSegment("~/work/app")).toBe("app");
    expect(basenamesOnly("edit /Users/me/secret-client/phoenix/src/a.ts now")).toBe(
      "edit a.ts now",
    );
    expect(basenamesOnly("src/a.ts")).toBe("src/a.ts");
    expect(basenamesOnly("see https://example.com/a/b")).toBe("see https://example.com/a/b");
  });

  it("git state returns the repo folder name only, and cleans error text and conflict names", () => {
    const view = gitView({
      repositories: [
        {
          path: "/Users/me/secret-client/phoenix",
          name: "phoenix",
          branch: "main",
          head: "abc",
          changed: 2,
          conflicts: ["/Users/me/secret-client/phoenix/src/a.ts"],
        },
        { path: "/Users/me/other", name: "other", error: "fatal: not a repo: /Users/me/other" },
      ],
    });
    const text = JSON.stringify(view);
    expect(text).not.toContain("/Users");
    expect(text).not.toContain("secret-client");
    expect(view).toMatchObject({
      repositories: [
        { name: "phoenix", branch: "main", changed: 2, conflicts: ["a.ts"] },
        { name: "other", error: "fatal: not a repo: other" },
      ],
    });
    expect(JSON.stringify(view)).not.toContain('"path"');
  });
});
