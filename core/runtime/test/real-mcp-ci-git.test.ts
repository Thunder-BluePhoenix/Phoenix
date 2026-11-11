// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 76 happy path of `phoenix_ci_git_state` with the REAL git and GitHub capabilities. Skipped
// unless PHOENIX_REAL_MCP_CIGIT is set, so CI never runs it:
//   PHOENIX_REAL_MCP_CIGIT=1 PHOENIX_EVIDENCE_OUT=/tmp/phoenix-mcp-cigit.json \
//     node_modules/.bin/vitest run core/runtime/test/real-mcp-ci-git.test.ts --testTimeout=120000
// The caller is the in-repo JSON-RPC client over real loopback HTTP, not a real MCP client with a
// model. Git reads a temporary local repository. GitHub is reached UNAUTHENTICATED (no token is
// stored or read) with read-only GETs to api.github.com for one public repository; a recording
// fetch wrapper refuses any non-GET, any other host and anything past five requests. The test
// asserts only what the code claims (no path, no token, GET-only, audit rows); what GitHub answered
// (including a possible rate limit) is recorded, never tuned.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitCapability } from "@phoenix/capability-git";
import { createGithubCapability } from "@phoenix/capability-github";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const REPO = "Thunder-BluePhoenix/Phoenix";
const MAX_GITHUB_REQUESTS = 5;
const PLANTED_SUBJECT_PATH = "/Users/someone/secret-project/file.txt";

interface WireEntry {
  method: string;
  url: string;
  status: number | null;
  ratelimit_remaining: string | null;
  authorization_header_sent: boolean;
}
const wire: WireEntry[] = [];
const refused: string[] = [];
let loopbackRequests = 0;
const realFetch = globalThis.fetch;

/** api.github.com GET only, at most five; loopback (Core's own API) passes; anything else throws. */
const guardedFetch: typeof fetch = async (input, init) => {
  const isRequest = typeof input === "object" && "url" in input;
  const url = new URL(isRequest ? input.url : String(input));
  const method = (init?.method ?? (isRequest ? input.method : "GET")).toUpperCase();
  if (url.hostname === "127.0.0.1") {
    loopbackRequests++;
    return realFetch(input, init);
  }
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" || method !== "GET") {
    refused.push(`${method} ${url.origin}${url.pathname}`);
    throw new TypeError("blocked by the real MCP ci/git test guard");
  }
  if (wire.length >= MAX_GITHUB_REQUESTS) {
    refused.push(`over budget: ${method} ${url.pathname}`);
    throw new TypeError("blocked: GitHub request budget used up");
  }
  const headers = new Headers(isRequest ? input.headers : undefined);
  new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
  const entry: WireEntry = {
    method,
    url: `${url.origin}${url.pathname}${url.search}`,
    status: null,
    ratelimit_remaining: null,
    authorization_header_sent: headers.has("authorization"),
  };
  wire.push(entry);
  const res = await realFetch(input, init);
  entry.status = res.status;
  entry.ratelimit_remaining = res.headers.get("x-ratelimit-remaining");
  return res;
};

interface RpcResult {
  tools?: { name: string }[];
  content?: { type: string; text: string }[];
}
interface ToolState {
  git: {
    available: boolean;
    reason?: string;
    data?: { repositories: Record<string, unknown>[] };
  };
  github: {
    available: boolean;
    reason?: string;
    data?: { authenticated?: boolean; repositories: Record<string, unknown>[] };
  };
}
interface AuditRow {
  actor: string;
  action: string;
  decision: string;
  details: Record<string, unknown>;
}
interface Reply {
  status: number;
  rpc: { result?: RpcResult; error?: { code: number; message: string } } | undefined;
  text: string;
}

const toolNames = (reply: Reply): string[] => (reply.rpc?.result?.tools ?? []).map((t) => t.name);

function post(port: number, token: string, body: unknown): Promise<Reply> {
  const { promise, resolve, reject } = Promise.withResolvers<Reply>();
  const req = request(
    {
      host: "127.0.0.1",
      port,
      path: "/mcp",
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    },
    (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let rpc: Reply["rpc"];
        try {
          rpc = JSON.parse(text) as Reply["rpc"];
        } catch {
          rpc = undefined;
        }
        resolve({ status: res.statusCode ?? 0, rpc, text });
      });
    },
  );
  req.on("error", reject);
  req.end(JSON.stringify(body));
  return promise;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } },
  );
}

const cleanups: (() => Promise<void> | void)[] = [];
const evidence: Record<string, unknown> = {};

beforeAll(() => {
  if (!process.env.PHOENIX_REAL_MCP_CIGIT) return;
  globalThis.fetch = guardedFetch;
});

afterAll(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  globalThis.fetch = realFetch;
  const out = process.env.PHOENIX_EVIDENCE_OUT;
  if (out && process.env.PHOENIX_REAL_MCP_CIGIT)
    writeFileSync(out, JSON.stringify(evidence, null, 2));
});

describe.skipIf(!process.env.PHOENIX_REAL_MCP_CIGIT)(
  "phase 76: phoenix_ci_git_state through the real git and GitHub capabilities",
  { timeout: 120_000 },
  () => {
    it("returns git and GitHub state over loopback JSON-RPC with no path, and refuses an ungranted client", async () => {
      // A temporary repository: 3 commits, a path-bearing branch, a dirty file and an untracked one.
      const root = mkdtempSync(join(tmpdir(), "phoenix-cigit-"));
      cleanups.push(() => rmSync(root, { recursive: true, force: true }));
      const repo = join(root, "demo-repo");
      mkdirSync(repo);
      git(repo, "init", "-q", "-b", "main");
      writeFileSync(join(repo, "a.txt"), "one\n");
      git(repo, "add", "a.txt");
      git(repo, "commit", "-q", "-m", "first commit");
      writeFileSync(join(repo, "b.txt"), "two\n");
      git(repo, "add", "b.txt");
      git(repo, "commit", "-q", "-m", "second commit");
      git(repo, "checkout", "-q", "-b", "feature/x");
      writeFileSync(join(repo, "c.txt"), "three\n");
      git(repo, "add", "c.txt");
      git(repo, "commit", "-q", "-m", `touch ${PLANTED_SUBJECT_PATH}`);
      writeFileSync(join(repo, "a.txt"), "one changed\n"); // dirty (tracked, modified)
      writeFileSync(join(repo, "untracked.txt"), "new\n"); // untracked
      const realRepo = realpathSync(repo);

      // The real capabilities, an in-memory secret store: no token exists anywhere.
      const core: TestCore = await startCore(
        {},
        {
          capabilities: [createGitCapability(), createGithubCapability()],
          secrets: new MemorySecretStore(),
          runtime: { mcp: { port: 0 } },
        },
      );
      cleanups.push(async () => {
        await core.runtime.stop();
        rmSync(core.dataDir, { recursive: true, force: true });
      });

      expect(
        (
          await core.api("POST", "/api/capabilities/git/config", {
            config: { repositories: [repo], poll_ms: 60_000 },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await core.api("POST", "/api/capabilities/github/config", {
            config: { repositories: [REPO], poll_ms: 3_600_000 },
          })
        ).status,
      ).toBe(200);
      const enabledGit = await core.api("POST", "/api/capabilities/git/enable", {});
      const enabledGithub = await core.api("POST", "/api/capabilities/github/enable", {});
      expect([enabledGit.status, enabledGithub.status]).toEqual([200, 200]);

      // The production route: the MCP server on, a client created and given ONE grant.
      const settings = await core.api("POST", "/api/mcp/settings", { enabled: true });
      expect(settings.status).toBe(200);
      const port: number = settings.json.port;
      const made = await core.api("POST", "/api/mcp/clients", { name: "ci-git client" });
      expect(made.status).toBe(201);
      const clientId: string = made.json.client.id;
      const token: string = made.json.token;
      const grants = {
        tools: ["phoenix_ci_git_state"],
        memory: [],
        request_approval: false,
        notify: false,
      };
      expect((await core.api("POST", `/api/mcp/clients/${clientId}/grants`, grants)).status).toBe(
        200,
      );

      // Real loopback HTTP JSON-RPC.
      const init = await post(port, token, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      });
      const initialized = await post(port, token, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      const list = await post(port, token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
      const call = await post(port, token, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "phoenix_ci_git_state", arguments: {} },
      });
      expect(init.status).toBe(200);
      expect(initialized.status).toBe(202);
      const listed = toolNames(list);
      expect(listed).toEqual(["phoenix_ci_git_state"]);
      expect(call.rpc?.error).toBeUndefined();
      const content = call.rpc?.result?.content ?? [];
      expect(content).toHaveLength(2);
      // JSON.parse yields `any`; the shape is checked by the assertions below, not asserted away.
      const toolResult: { untrusted_data: ToolState } = JSON.parse(content[1]!.text);
      const state = toolResult.untrusted_data;
      const resultText = JSON.stringify(state);
      const githubRequestsAfterCall = wire.length;

      // A second client WITHOUT this grant (it holds another one) is refused the same way as an
      // unknown tool, and nothing more is requested from GitHub.
      const made2 = await core.api("POST", "/api/mcp/clients", { name: "no ci-git grant" });
      const client2: string = made2.json.client.id;
      await core.api("POST", `/api/mcp/clients/${client2}/grants`, {
        ...grants,
        tools: ["phoenix_activity"],
      });
      const token2: string = made2.json.token;
      const list2 = await post(port, token2, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const refusedCall = await post(port, token2, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "phoenix_ci_git_state", arguments: {} },
      });

      const allAudit: AuditRow[] = (await core.api("GET", "/api/audit?limit=1000")).json.entries;
      const audit = allAudit.filter(
        (a) =>
          a.action.startsWith("mcp.") ||
          a.actor.startsWith("mcp:") ||
          a.action.startsWith("tool.") ||
          JSON.stringify(a).includes("github.status") ||
          JSON.stringify(a).includes("git.status"),
      );

      const repoState = state.git.data?.repositories[0];
      const githubState = state.github.data?.repositories[0];
      const leaks = {
        temp_repo_path: resultText.includes(repo),
        real_repo_path: resultText.includes(realRepo),
        tmpdir_prefix: resultText.includes(root),
        commit_subject_path:
          resultText.includes("secret-project") || resultText.includes("someone"),
        commit_subject_text: resultText.includes("touch "),
        users_prefix: resultText.includes("/Users"),
        path_key: /"path"/.test(resultText),
        title_key: /"title"/.test(resultText),
        mcp_client_token: resultText.includes(token),
        bearer_text: /bearer/i.test(resultText),
        github_token_shape: new RegExp(["gh", "[pousr]_[A-Za-z0-9]{20,}"].join("")).test(
          resultText,
        ),
      };
      Object.assign(evidence, {
        environment: { date: new Date().toISOString(), node: process.version },
        caller:
          "in-repo JSON-RPC client over real loopback HTTP; not a real MCP client with a model",
        tool_result: state,
        git_status_summary: {
          available: state.git.available,
          repositories: state.git.data?.repositories.length ?? 0,
          name: repoState?.name,
          branch: repoState?.branch,
          changed: repoState?.changed,
          conflicts: repoState?.conflicts,
          keys: repoState ? Object.keys(repoState) : [],
        },
        github_status_summary: {
          available: state.github.available,
          reason: state.github.reason ?? null,
          authenticated: state.github.data?.authenticated,
          repository: githubState?.repository,
          open_pull_requests: githubState?.open_pull_requests,
          latest_run: githubState?.latest_run ?? null,
          error: githubState?.error ?? null,
          keys: githubState ? Object.keys(githubState) : [],
        },
        leaks,
        github_requests: {
          count: wire.length,
          count_after_the_call: githubRequestsAfterCall,
          requests: wire,
          refused,
          loopback_requests: loopbackRequests,
        },
        tools_list: listed,
        audit_rows: audit,
        second_client_without_grant: {
          tools_list: toolNames(list2),
          call_status: refusedCall.status,
          call_error: refusedCall.rpc?.error ?? null,
          call_result: refusedCall.rpc?.result ?? null,
          github_requests_after_refusal: wire.length,
        },
      });

      // The guarantees the code itself claims.
      expect(state.git.available).toBe(true);
      expect(repoState).toMatchObject({ name: "demo-repo", branch: "feature/x", changed: 2 });
      expect(Object.values(leaks).filter(Boolean)).toEqual([]);
      expect(wire.length).toBeLessThanOrEqual(MAX_GITHUB_REQUESTS);
      expect(
        wire.every((w) => w.method === "GET" && w.url.startsWith("https://api.github.com/")),
      ).toBe(true);
      expect(wire.some((w) => w.authorization_header_sent)).toBe(false);
      expect(refused).toEqual([]);
      expect(
        audit.some((a) => a.action === "mcp.call" && a.details.tool === "phoenix_ci_git_state"),
      ).toBe(true);
      expect(refusedCall.rpc?.error?.code).toBe(-32602);
      expect(refusedCall.rpc?.error?.message).toBe("Unknown tool");
      expect(toolNames(list2)).toEqual(["phoenix_activity"]);
      expect(wire.length).toBe(githubRequestsAfterCall);
      expect(
        audit.some((a) => a.action === "mcp.call.denied" && a.details.reason === "not_granted"),
      ).toBe(true);

      // Stop the watchers before the temp repo goes.
      await core.api("POST", "/api/capabilities/github/disable");
      await core.api("POST", "/api/capabilities/git/disable");
    });
  },
);
