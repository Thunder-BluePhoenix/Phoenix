// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `linear.issue.create` and `jira.issue.create` (Phase 85), exercised ONLY against a fake `fetch`.
// Nothing here contacts Linear or Atlassian: no real tracker, account, key or site was involved,
// and the reply shapes are written from the vendors' documentation, not from live responses.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { DEFAULT_TIMEOUT_MS } from "../src/http";
import {
  LINEAR_CREATE_ENDPOINT,
  LINEAR_CREATE_MUTATION,
  cleanBody,
  cleanTitle,
  createIssuesCapability,
  jiraDescription,
  resolveJiraCloudSite,
} from "../src";

const TEAM = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const SITE = "https://acme.atlassian.net";
const LINEAR_KEY = ["fake", "linear", "write", "0001"].join("-");
const JIRA_EMAIL = "writer@example.test";
const JIRA_TOKEN = ["fake", "jira", "write", "0002"].join("-");
const POLL_KEY = ["fake", "linear", "poll", "0003"].join("-");
/** Text a hostile tracker puts in replies; it must never reach an operation, event or audit row. */
const REMOTE_MARK = "REMOTE-WROTE-THIS-9f3";
const BASIC = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");

const LINEAR_OK = {
  data: {
    issueCreate: {
      success: true,
      issue: {
        id: "0a1b2c3d-1111-2222-3333-444455556666",
        identifier: "ENG-12",
        url: "https://linear.app/acme/issue/ENG-12/fix-the-bug",
      },
    },
  },
};
const JIRA_OK = { id: "10001", key: "PROJ-7", self: `https://evil.test/${REMOTE_MARK}` };

interface Call {
  url: string;
  init: RequestInit;
  body: {
    query: string;
    variables: { input: Record<string, unknown> };
    fields: Record<string, unknown>;
  };
}
type Reply = Response | "throw" | "hang";

let h: Harness | undefined;
let calls: Call[] = [];

afterEach(async () => {
  await h?.close();
  h = undefined;
  calls = [];
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** A fake `fetch`. Like the real one with `redirect: "error"`, it throws on a 3xx reply. */
function fakeFetch(reply: Reply | (() => Reply)) {
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      init,
      body: typeof init.body === "string" ? JSON.parse(init.body) : {},
    });
    const res = typeof reply === "function" ? reply() : reply;
    if (res === "throw") throw new TypeError("connection reset");
    if (res === "hang") {
      const hung = Promise.withResolvers<Response>();
      init.signal?.addEventListener("abort", () => hung.reject(new DOMException("aborted")));
      return await hung.promise;
    }
    if (res.status >= 300 && res.status < 400 && init.redirect === "error") {
      throw new TypeError("unexpected redirect");
    }
    return res;
  });
}

interface Setup {
  linearKey?: string | null;
  jiraEmail?: string | null;
  jiraToken?: string | null;
  site?: string | null;
  pollKey?: string;
  limits?: { timeoutMs?: number; maxBytes?: number };
  trackers?: Record<string, unknown>[];
}

async function ready(setup: Setup = {}) {
  h = createHarness({
    modules: [
      createIssuesCapability({
        wait: () => Promise.withResolvers<void>().promise,
        ...(setup.limits ? { limits: setup.limits } : {}),
      }),
    ],
  });
  const site = setup.site === undefined ? SITE : setup.site;
  h.manager.configure("issues", {
    ...(site ? { create: { jira_site: site } } : {}),
    ...(setup.trackers ? { trackers: setup.trackers } : {}),
  });
  const secrets: [string, string | null | undefined, string][] = [
    ["linear_write_key", setup.linearKey, LINEAR_KEY],
    ["jira_write_email", setup.jiraEmail, JIRA_EMAIL],
    ["jira_write_token", setup.jiraToken, JIRA_TOKEN],
  ];
  for (const [name, given, fallback] of secrets) {
    const value = given === undefined ? fallback : given;
    if (value) await h.manager.setSecret("issues", name, value);
  }
  if (setup.pollKey) await h.manager.setSecret("issues", "linear_api_key", setup.pollKey);
  await h.enable("issues");
  return h;
}

const linear = (input: Record<string, unknown> = {}, approve = true) =>
  h!.run(
    "issues",
    "linear.issue.create",
    { team_id: TEAM, title: "Fix the bug", ...input },
    approve,
  );
const jira = (input: Record<string, unknown> = {}, approve = true) =>
  h!.run(
    "issues",
    "jira.issue.create",
    { project: "PROJ", title: "Fix the bug", ...input },
    approve,
  );

const auditRows = () => h!.db.prepare("SELECT * FROM audit_log").all() as Record<string, unknown>[];
const auditActions = () =>
  auditRows()
    .filter((r) => r.capability_id === "issues")
    .map((r) => r.action);
/** Everything a user, a log or a client could read after a command. */
const everything = (...ops: unknown[]) =>
  JSON.stringify({
    ops,
    events: h!.events,
    audit: auditRows(),
    view: h!.manager.get("issues"),
  });
const noSecrets = (text: string) => {
  for (const secret of [LINEAR_KEY, JIRA_TOKEN, JIRA_EMAIL, BASIC, POLL_KEY, REMOTE_MARK]) {
    expect(text).not.toContain(secret);
  }
};

describe("manifest", () => {
  it("both create commands are external with network + external_api; list stays read-only", async () => {
    await ready();
    const manifest = createIssuesCapability().manifest;
    for (const name of ["linear.issue.create", "jira.issue.create"]) {
      const spec = manifest.commands.find((c) => c.name === name);
      expect(spec?.side_effect).toBe("external");
      expect(spec?.permissions).toEqual(["network", "external_api"]);
    }
    const list = manifest.commands.find((c) => c.name === "list");
    expect(list?.side_effect).toBe("read");
    expect(list?.permissions).toBeUndefined();
    expect(manifest.permissions).toEqual(["network", "external_api"]);
    expect(manifest.data_categories?.join(" ")).toMatch(/you confirm/);
    const secretNames = manifest.secrets?.map((s) => s.name);
    expect(secretNames).toEqual(
      expect.arrayContaining(["linear_write_key", "jira_write_email", "jira_write_token"]),
    );
  });

  it("no command accepts an image, a file or a url", () => {
    const manifest = createIssuesCapability().manifest;
    for (const name of ["linear.issue.create", "jira.issue.create"]) {
      const spec = manifest.commands.find((c) => c.name === name);
      const schema = spec?.input_schema as { properties: Record<string, unknown> };
      const props = Object.keys(schema.properties);
      expect(props.join(" ")).not.toMatch(/image|file|attach|url|host|site/i);
    }
  });
});

describe("linear.issue.create", () => {
  it("sends the fixed mutation with variables to api.linear.app and returns only id, key, url", async () => {
    await ready();
    fakeFetch(() => json(LINEAR_OK));
    const op = await linear({ body: "Steps:\n1. open\n2. click" });
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({
      tracker: "linear",
      id: "0a1b2c3d-1111-2222-3333-444455556666",
      key: "ENG-12",
      url: "https://linear.app/acme/issue/ENG-12/fix-the-bug",
    });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(LINEAR_CREATE_ENDPOINT);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("error");
    expect((call.init.headers as Record<string, string>).authorization).toBe(LINEAR_KEY);
    expect(call.body).toEqual({
      query: LINEAR_CREATE_MUTATION,
      variables: {
        input: { teamId: TEAM, title: "Fix the bug", description: "Steps:\n1. open\n2. click" },
      },
    });
    // The user's text is a variable, never part of the query string.
    expect(call.body.query).not.toContain("Fix the bug");
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
    noSecrets(everything(op));
  });

  it("an omitted body sends no description", async () => {
    await ready();
    fakeFetch(() => json(LINEAR_OK));
    await linear();
    expect(calls[0]!.body.variables.input).toEqual({ teamId: TEAM, title: "Fix the bug" });
  });

  it("is host-pinned: the polling api_url override does not move the write", async () => {
    await ready({
      trackers: [{ kind: "linear", api_url: "http://127.0.0.1:9/graphql" }],
      pollKey: POLL_KEY,
    });
    fakeFetch((): Reply => {
      return json(LINEAR_OK);
    });
    // Polling may call the override; the create must only ever hit api.linear.app.
    calls = [];
    const op = await linear();
    expect(op.status).toBe("succeeded");
    expect(calls.map((c) => c.url)).toEqual([LINEAR_CREATE_ENDPOINT]);
  });

  it("uses its own write key, never the polling key", async () => {
    await ready({ linearKey: null, pollKey: POLL_KEY, trackers: [] });
    fakeFetch(() => json(LINEAR_OK));
    const op = await linear();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/No linear_write_key is set/);
    expect(calls).toEqual([]);
    noSecrets(everything(op));
  });

  it("a write key with spaces or control characters is refused before any request", async () => {
    await ready({ linearKey: "bad key with spaces 123" });
    fakeFetch(() => json(LINEAR_OK));
    const op = await linear();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/not a usable credential/);
    expect(calls).toEqual([]);
    expect(everything(op)).not.toContain("bad key with spaces");
  });

  const failures: [string, Response, RegExp][] = [
    ["401", json({ errors: [{ message: REMOTE_MARK }] }, 401), /rejected the write key/],
    ["403", json({ message: REMOTE_MARK }, 403), /refused the request \(403\)/],
    ["400", json({ message: REMOTE_MARK }, 400), /rejected the issue \(HTTP 400\)/],
    ["422", json({ message: REMOTE_MARK }, 422), /rejected the issue \(HTTP 422\)/],
    ["429", json({ message: REMOTE_MARK }, 429, { "retry-after": "5" }), /rate limit/],
    ["500", json({ message: REMOTE_MARK }, 500), /may or may not have been created/],
    ["502 html", new Response(`<html>${REMOTE_MARK}</html>`, { status: 502 }), /HTTP 502/],
    ["200 html", new Response(`<html>${REMOTE_MARK}</html>`, { status: 200 }), /could not read/],
    ["200 empty", new Response("", { status: 200 }), /could not read/],
    ["200 wrong shape", json({ data: { issueCreate: { success: false } } }), /could not read/],
    [
      "200 success but no issue",
      json({ data: { issueCreate: { success: true } } }),
      /could not read/,
    ],
  ];
  for (const [name, reply, message] of failures) {
    it(`${name}: fixed message, nothing the server wrote leaks, one request`, async () => {
      await ready();
      fakeFetch(() => reply.clone());
      const op = await linear();
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(message);
      expect(calls).toHaveLength(1);
      noSecrets(everything(op));
      await h!.drain();
      expect(auditActions()).toContain("action.failed");
    });
  }

  const graphql: [string, unknown, RegExp][] = [
    [
      "auth code",
      { errors: [{ message: REMOTE_MARK, extensions: { code: "AUTHENTICATION_ERROR" } }] },
      /rejected the write key/,
    ],
    [
      "forbidden",
      { errors: [{ message: REMOTE_MARK, extensions: { code: "FORBIDDEN" } }] },
      /rejected the write key or it may not create/,
    ],
    [
      "rate limited",
      { errors: [{ message: REMOTE_MARK, extensions: { code: "RATELIMITED" } }] },
      /rate limit/,
    ],
    [
      "validation",
      {
        errors: [{ message: REMOTE_MARK, extensions: { code: "INVALID_INPUT" } }],
        data: LINEAR_OK.data,
      },
      /Linear reported an error/,
    ],
    [
      "errors without extensions",
      { errors: [{ message: REMOTE_MARK }, "junk", 7] },
      /Linear reported/,
    ],
  ];
  for (const [name, body, message] of graphql) {
    it(`GraphQL errors array (${name}) is a fixed message even on HTTP 200`, async () => {
      await ready();
      fakeFetch(() => json(body));
      const op = await linear();
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(message);
      noSecrets(everything(op));
    });
  }

  it("a redirect is refused, not followed, and the message says the outcome is unknown", async () => {
    await ready();
    fakeFetch(
      () => new Response("", { status: 302, headers: { location: "https://evil.test/x" } }),
    );
    const op = await linear();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/may or may not have been created/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.redirect).toBe("error");
    expect(everything(op)).not.toContain("evil.test");
  });

  it("an oversized reply is refused (declared and streamed)", async () => {
    await ready();
    fakeFetch(
      () =>
        new Response("x".repeat(300 * 1024), {
          status: 200,
          headers: { "content-length": String(300 * 1024) },
        }),
    );
    const declared = await linear();
    expect(declared.status).toBe("failed");
    expect(declared.error?.message).toMatch(/may or may not have been created/);
    fakeFetch(() => new Response("y".repeat(300 * 1024), { status: 200 }));
    const streamed = await linear();
    expect(streamed.status).toBe("failed");
    expect(streamed.error?.message).toMatch(/may or may not have been created/);
  });

  it("a hanging server is cut off by the timeout and the outcome is reported unknown", async () => {
    await ready({ limits: { timeoutMs: 40 } });
    fakeFetch("hang");
    const op = await linear();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/did not answer in time/);
    noSecrets(everything(op));
  });

  it("a dropped connection is a fixed message, not the transport's text", async () => {
    await ready();
    fakeFetch("throw");
    const op = await linear();
    expect(op.status).toBe("failed");
    expect(op.error?.message).not.toContain("connection reset");
    expect(op.error?.message).toMatch(/may or may not have been created/);
  });

  const hostileUrls = [
    "https://evil.test/acme/issue/ENG-12/x",
    "https://linear.app.evil.test/acme/issue/ENG-12/x",
    "https://linear.app@evil.test/acme/issue/ENG-12/x",
    "http://linear.app/acme/issue/ENG-12/x",
    "javascript:alert(1)",
    "https://linear.app/acme/issue/ENG-12/x)[click](https://evil.test",
    "https://linear.app/acme/issue/ENG-99/x",
    "https://linear.app/acme/issue/ENG-12/x?next=https://evil.test",
    "https://linear.app/acme/issue/ENG-12/x#frag",
    "https://linear.app:8443/acme/issue/ENG-12/x",
    "https://linear.app/acme/project/ENG-12/x",
    `https://linear.app/acme/issue/ENG-12/${"a".repeat(600)}`,
    "[click](https://evil.test)",
  ];
  for (const url of hostileUrls) {
    it(`refuses a created-issue url that is not a Linear issue link: ${url.slice(0, 60)}`, async () => {
      await ready();
      const issue = { ...LINEAR_OK.data.issueCreate.issue, url };
      fakeFetch(() => json({ data: { issueCreate: { success: true, issue } } }));
      const op = await linear();
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(/could not read/);
      expect(op.result).toBeUndefined();
      expect(everything(op)).not.toContain("evil.test");
    });
  }

  it("refuses a hostile id or identifier from the server", async () => {
    await ready();
    for (const patch of [{ id: "x y" }, { id: "a".repeat(80) }, { identifier: "ENG-1](x)" }]) {
      const issue = { ...LINEAR_OK.data.issueCreate.issue, ...patch };
      fakeFetch(() => json({ data: { issueCreate: { success: true, issue } } }));
      const op = await linear();
      expect(op.status).toBe("failed");
    }
  });
});

describe("jira.issue.create", () => {
  it("POSTs the fixed REST v3 body to the configured site and returns id, key and a built url", async () => {
    await ready();
    fakeFetch(() => json(JIRA_OK, 201));
    const op = await jira({ body: "line1\nline2\n\npara2", issue_type: "Bug" });
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({
      tracker: "jira",
      id: "10001",
      key: "PROJ-7",
      url: `${SITE}/browse/PROJ-7`,
    });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${SITE}/rest/api/3/issue`);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("error");
    expect((call.init.headers as Record<string, string>).authorization).toBe(`Basic ${BASIC}`);
    expect(call.body).toEqual({
      fields: {
        project: { key: "PROJ" },
        issuetype: { name: "Bug" },
        summary: "Fix the bug",
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "line1" },
                { type: "hardBreak" },
                { type: "text", text: "line2" },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "para2" }] },
          ],
        },
      },
    });
    // The reply's own `self` link (here pointing at another host) is never used or returned.
    expect(everything(op)).not.toContain("evil.test");
    noSecrets(everything(op));
  });

  it("defaults the issue type to Task and omits the description without a body", async () => {
    await ready();
    fakeFetch(() => json(JIRA_OK, 201));
    await jira();
    expect(calls[0]!.body.fields).toEqual({
      project: { key: "PROJ" },
      issuetype: { name: "Task" },
      summary: "Fix the bug",
    });
  });

  it("is host-pinned: the polling site is not the write site, and the site is owner config only", async () => {
    await ready({ trackers: [{ kind: "jira", site: "https://other.atlassian.net" }] });
    fakeFetch(() => json(JIRA_OK, 201));
    calls = [];
    const op = await jira();
    expect(op.status).toBe("succeeded");
    expect(calls.map((c) => c.url)).toEqual([`${SITE}/rest/api/3/issue`]);
    // The input cannot name a host or site at all.
    expect(() =>
      h!.manager.invoke("issues", "jira.issue.create", {
        project: "PROJ",
        title: "T",
        site: "https://evil.atlassian.net",
      }),
    ).toThrow(/Invalid command input/);
  });

  it("without config.create.jira_site it fails before any request", async () => {
    await ready({ site: null });
    fakeFetch(() => json(JIRA_OK, 201));
    const op = await jira();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/config\.create\.jira_site/);
    expect(calls).toEqual([]);
  });

  const badSites = [
    "http://acme.atlassian.net",
    "https://evil.test",
    "https://acme.atlassian.net.evil.test",
    "https://acme.atlassian.net@evil.test",
    "https://user:pw@acme.atlassian.net",
    "https://acme.atlassian.net:8443",
    "https://acme.atlassian.net/jira",
    "https://acme.atlassian.net/?next=x",
    "https://evil.test/.atlassian.net",
    "https://atlassian.net",
    "https://ACME.atlassian.net",
    "https://127.0.0.1",
    "https://localhost",
    "ftp://acme.atlassian.net",
    "https://acme.atlassian.net#x",
  ];
  for (const site of badSites) {
    it(`site ${site} is refused when configured and when it reaches the client`, async () => {
      h = createHarness({ modules: [createIssuesCapability()] });
      expect(() => h!.manager.configure("issues", { create: { jira_site: site } })).toThrow();
      expect(() => resolveJiraCloudSite(site)).toThrow(/atlassian\.net/);
    });
  }

  it("accepts the owner's https *.atlassian.net site with or without a trailing slash", () => {
    expect(resolveJiraCloudSite("https://acme.atlassian.net")).toBe(SITE);
    expect(resolveJiraCloudSite("https://acme.atlassian.net/")).toBe(SITE);
    expect(resolveJiraCloudSite("https://a-b-1.atlassian.net")).toBe("https://a-b-1.atlassian.net");
  });

  it("a hand-edited stored config pointing elsewhere still cannot send anything", async () => {
    // Bypass the schema, as a hand-edited store would: the client checks again.
    await ready({ site: null });
    // Test-only reach into the manager's private entry table, to simulate a hand-edited store.
    const internals = h!.manager as unknown as {
      entries: Map<string, { config: Record<string, unknown> }>;
    };
    internals.entries.get("issues")!.config = { create: { jira_site: "https://evil.test" } };
    fakeFetch(() => json(JIRA_OK, 201));
    const op = await jira();
    expect(op.status).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("needs its own write email and token", async () => {
    for (const setup of [{ jiraEmail: null }, { jiraToken: null }]) {
      await ready(setup);
      fakeFetch(() => json(JIRA_OK, 201));
      const op = await jira();
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(/No jira_write_(email|token) is set/);
      expect(calls).toEqual([]);
      await h!.close();
      h = undefined;
    }
  });

  it("an email with a colon or a token with spaces is refused before any request", async () => {
    await ready({ jiraEmail: "a:b@example.test" });
    fakeFetch(() => json(JIRA_OK, 201));
    expect((await jira()).error?.message).toMatch(/not a usable credential/);
    await h!.close();
    await ready({ jiraToken: "token with spaces 12345" });
    expect((await jira()).error?.message).toMatch(/not a usable credential/);
    expect(calls).toEqual([]);
  });

  const failures: [string, Response, RegExp][] = [
    ["401", json({ errorMessages: [REMOTE_MARK] }, 401), /rejected the credentials \(401\)/],
    ["403", json({ errorMessages: [REMOTE_MARK] }, 403), /refused the request \(403\)/],
    ["400", json({ errors: { summary: REMOTE_MARK } }, 400), /rejected the issue \(HTTP 400\)/],
    ["404", json({ errorMessages: [REMOTE_MARK] }, 404), /rejected the issue \(HTTP 404\)/],
    ["429", json({}, 429, { "retry-after": "3" }), /rate limit/],
    ["500", json({ message: REMOTE_MARK }, 500), /may or may not have been created/],
    ["503 html", new Response(`<html>${REMOTE_MARK}</html>`, { status: 503 }), /HTTP 503/],
    ["201 html", new Response(`<html>${REMOTE_MARK}</html>`, { status: 201 }), /could not read/],
    ["200 instead of 201", json(JIRA_OK, 200), /could not read/],
    ["201 empty object", json({}, 201), /could not read/],
    ["201 array", json([JIRA_OK], 201), /could not read/],
  ];
  for (const [name, reply, message] of failures) {
    it(`${name}: fixed message, nothing the server wrote leaks, one request`, async () => {
      await ready();
      fakeFetch(() => reply.clone());
      const op = await jira();
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(message);
      expect(calls).toHaveLength(1);
      noSecrets(everything(op));
      await h!.drain();
      expect(auditActions()).toContain("action.failed");
    });
  }

  it("a redirect is refused, not followed", async () => {
    await ready();
    fakeFetch(
      () => new Response("", { status: 307, headers: { location: "https://evil.test/x" } }),
    );
    const op = await jira();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/may or may not have been created/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.redirect).toBe("error");
    expect(everything(op)).not.toContain("evil.test");
  });

  it("an oversized reply is refused", async () => {
    await ready();
    fakeFetch(() => new Response("z".repeat(300 * 1024), { status: 201 }));
    const op = await jira();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/may or may not have been created/);
  });

  it("a hanging server is cut off by the timeout", async () => {
    await ready({ limits: { timeoutMs: 40 } });
    fakeFetch("hang");
    const op = await jira();
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/did not answer in time/);
  });

  const hostileReplies: [string, Record<string, unknown>][] = [
    ["key of another project", { id: "1", key: "OTHER-1" }],
    ["markdown in the key", { id: "1", key: "PROJ-1](https://evil.test)" }],
    ["lowercase key", { id: "1", key: "proj-1" }],
    ["non-numeric id", { id: "1;DROP", key: "PROJ-1" }],
    ["numeric id type", { id: 1, key: "PROJ-1" }],
    ["huge key number", { id: "1", key: "PROJ-12345678901" }],
  ];
  for (const [name, reply] of hostileReplies) {
    it(`refuses a reply with ${name}`, async () => {
      await ready();
      fakeFetch(() => json(reply, 201));
      const op = await jira();
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(/could not read/);
      expect(everything(op)).not.toContain("evil.test");
    });
  }
});

describe("confirmation and audit", () => {
  for (const [name, command, input] of [
    ["linear", "linear.issue.create", { team_id: TEAM, title: "Launch plan" }],
    ["jira", "jira.issue.create", { project: "PROJ", title: "Launch plan" }],
  ] as const) {
    it(`${name}: declining sends nothing and is audited`, async () => {
      await ready();
      fakeFetch(() => json(LINEAR_OK));
      const op = await h!.run("issues", command, input, false);
      expect(op.status).toBe("failed");
      expect(calls).toEqual([]);
      expect(auditActions()).toContain("confirmation.rejected");
      expect(auditActions()).not.toContain("action.authorized");
    });

    it(`${name}: without a decision the operation waits, sends nothing, and the card names the destination`, async () => {
      await ready();
      fakeFetch(() => json(LINEAR_OK));
      const op = h!.manager.invoke("issues", command, { ...input, body: "Details here" });
      await vi.waitFor(() => expect(h!.permissions.pendingConfirmations()).toHaveLength(1));
      expect(op.status).toBe("pending");
      const card = h!.permissions.pendingConfirmations()[0]!;
      expect(card.sideEffect).toBe("external");
      expect(card.summary).toContain("title: Launch plan");
      expect(card.summary).toContain("body: Details here");
      expect(card.summary).toContain(name === "linear" ? `team_id: ${TEAM}` : "project: PROJ");
      expect(calls).toEqual([]);
      for (const c of h!.permissions.pendingConfirmations())
        h!.permissions.resolveConfirmation(c.id, false);
    });

    it(`${name}: a hostile title cannot forge or hide text on the confirmation card`, async () => {
      await ready();
      fakeFetch(() => json(LINEAR_OK));
      h!.manager.invoke("issues", command, {
        ...input,
        title: "Harmless\n\u202eapproved: yes\u0000 title",
      });
      await vi.waitFor(() => expect(h!.permissions.pendingConfirmations()).toHaveLength(1));
      const card = h!.permissions.pendingConfirmations()[0]!;
      // eslint-disable-next-line no-control-regex
      expect(card.summary).not.toMatch(/[\u0000-\u001f\u202e]/);
      for (const c of h!.permissions.pendingConfirmations())
        h!.permissions.resolveConfirmation(c.id, false);
    });

    it(`${name}: is unreachable while the capability is disabled`, async () => {
      await ready();
      await h!.manager.disable("issues");
      expect(() => h!.manager.invoke("issues", command, input)).toThrow();
      expect(calls).toEqual([]);
    });
  }

  it("an approved create leaves an audit trail without secrets or reply text", async () => {
    await ready();
    fakeFetch(() => json(LINEAR_OK));
    const op = await linear({ body: "Details" });
    await h!.drain();
    const actions = auditActions();
    expect(actions).toEqual(
      expect.arrayContaining([
        "confirmation.requested",
        "confirmation.approved",
        "action.authorized",
        "action.succeeded",
      ]),
    );
    const rows = JSON.stringify(auditRows().filter((r) => r.capability_id === "issues"));
    expect(rows).toContain("linear.issue.create");
    noSecrets(rows);
    noSecrets(everything(op));
  });

  it("each attempt gets its own audit trail (success then failure)", async () => {
    await ready();
    fakeFetch(() => json(LINEAR_OK));
    await linear();
    fakeFetch(() => json({}, 500));
    await linear();
    await h!.drain();
    const actions = auditActions();
    expect(actions.filter((a) => a === "action.authorized")).toHaveLength(2);
    expect(actions).toContain("action.succeeded");
    expect(actions).toContain("action.failed");
  });
});

describe("input validation and hostile text", () => {
  const bad: [string, "linear" | "jira", Record<string, unknown>][] = [
    ["unknown field", "linear", { extra: 1 }],
    ["image field", "linear", { image: "data:image/png;base64,AAAA" }],
    ["team id not a uuid", "linear", { team_id: "../x" }],
    ["team id with newline", "linear", { team_id: `${TEAM}\n` }],
    ["empty title", "linear", { title: "" }],
    ["title over 255", "linear", { title: "x".repeat(256) }],
    ["body over 10000", "linear", { body: "x".repeat(10_001) }],
    ["non-string title", "linear", { title: { a: 1 } }],
    ["lowercase project", "jira", { project: "proj" }],
    ["project with injection", "jira", { project: 'PROJ"}' }],
    ["issue type with quotes", "jira", { issue_type: 'Task","x":"y' }],
    ["issue type with newline", "jira", { issue_type: "Task\nBug" }],
    ["unknown jira field", "jira", { labels: ["a"] }],
    ["jira site in input", "jira", { site: "https://evil.atlassian.net" }],
    ["jira url in input", "jira", { url: "https://evil.test" }],
  ];
  for (const [name, tracker, input] of bad) {
    it(`rejects ${name} without any request`, async () => {
      await ready();
      fakeFetch(() => json(LINEAR_OK));
      const base =
        tracker === "linear" ? { team_id: TEAM, title: "T" } : { project: "PROJ", title: "T" };
      expect(() =>
        h!.manager.invoke("issues", `${tracker}.issue.create`, { ...base, ...input }),
      ).toThrow();
      expect(calls).toEqual([]);
    });
  }

  it("a secret-looking value in the input is refused by Core before anything is sent", async () => {
    await ready();
    fakeFetch(() => json(LINEAR_OK));
    expect(() =>
      h!.manager.invoke("issues", "linear.issue.create", {
        team_id: TEAM,
        title: `Rotate ${FAKE_GITHUB_TOKEN}`,
      }),
    ).toThrow(/secrets/);
    expect(calls).toEqual([]);
  });

  it("control and format characters never leave the machine; markdown stays inert text", async () => {
    await ready();
    fakeFetch(() => json(LINEAR_OK));
    const op = await linear({
      title:
        "Fix\u0000 the\n\u202ebug\u200b [x](javascript:alert(1)) ![i](https://evil.test/p.png)",
      body: "a\u0000b\r\nc\u202ed\u0007\n\n\n\n\ne\u2028f\tg",
    });
    expect(op.status).toBe("succeeded");
    const { title, description } = calls[0]!.body.variables.input;
    // eslint-disable-next-line no-control-regex
    expect(title).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u200b\u202e\u2028]/);
    expect(title).toBe("Fix the bug [x](javascript:alert(1)) ![i](https://evil.test/p.png)");
    // eslint-disable-next-line no-control-regex
    expect(description).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b\u202e\u2028]/);
    expect(description).toBe("ab\nc" + "d\n\ne" + "f\tg");
  });

  it("secrets in title or body are redacted before they are sent", async () => {
    await ready();
    fakeFetch(() => json(JIRA_OK, 201));
    // Core refuses a secret-looking input outright; a disguised one that only the redactor
    // catches must still not be sent. The unit functions are what the commands call.
    expect(cleanTitle(`token ${FAKE_GITHUB_TOKEN} here`)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(cleanBody(`token ${FAKE_GITHUB_TOKEN} here`)).not.toContain(FAKE_GITHUB_TOKEN);
  });

  it("a title with nothing printable is refused without a request", async () => {
    await ready();
    fakeFetch(() => json(LINEAR_OK));
    for (const title of ["   ", "\u200b\u200b", "\n\t"]) {
      const op = await linear({ title });
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(/title is empty/);
    }
    expect(calls).toEqual([]);
  });

  it("a whitespace-only body sends no description", async () => {
    await ready();
    fakeFetch(() => json(LINEAR_OK));
    await linear({ body: " \n\n " });
    expect(calls[0]!.body.variables.input).not.toHaveProperty("description");
  });

  it("jiraDescription never emits empty text nodes or raw markup beyond text", () => {
    expect(jiraDescription("a\n\n\n\nb")).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    });
    expect(jiraDescription("<b>x</b> {code}")).toMatchObject({
      content: [{ content: [{ type: "text", text: "<b>x</b> {code}" }] }],
    });
  });
});

describe("secrets stay secret", () => {
  it("no operation, event, audit row or capability view holds a credential, on success or failure", async () => {
    await ready({ pollKey: POLL_KEY });
    fakeFetch(() => json(LINEAR_OK));
    const ok = await linear();
    fakeFetch(() => json({ errors: [{ message: `${LINEAR_KEY} ${REMOTE_MARK}` }] }));
    const bad = await linear();
    fakeFetch(() => json(JIRA_OK, 201));
    const okJira = await jira();
    fakeFetch(() => json({ errorMessages: [`${BASIC} ${JIRA_TOKEN}`] }, 400));
    const badJira = await jira();
    await h!.drain();
    noSecrets(everything(ok, bad, okJira, badJira));
  });

  it("secrets are refused in config", async () => {
    h = createHarness({ modules: [createIssuesCapability()] });
    expect(() =>
      h!.manager.configure("issues", { create: { jira_site: SITE, jira_write_token: JIRA_TOKEN } }),
    ).toThrow();
  });
});
