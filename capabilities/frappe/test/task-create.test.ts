// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappeCapability } from "../src";
import { buildTaskDocument, writeOrigin, type TaskInput } from "../src/tasks";
import {
  REMOTE_MARKER,
  startMockFrappe,
  type MockFrappe,
  type WriteMode,
} from "../testing/mock-frappe";

// A Frappe `api_key:api_secret`, assembled at runtime (no token-shaped literal in the tree).
const CREDENTIAL = [["mock", "key"].join(""), ["mock", "secret"].join("")].join(":");
const SITE = "erp.localhost";
const KEY = "phoenix-test-key-0001";

const dirs: string[] = [];
let h: Harness | undefined;
let mock: MockFrappe | undefined;

afterEach(async () => {
  await h?.close();
  await mock?.close();
  h = mock = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(process.stdout, "write");
  vi.spyOn(process.stderr, "write");
});

interface RigOptions {
  /** Value of the write_token secret; null stores none. */
  token?: string | null;
  /** The `api` config; receives the mock's URL. */
  api?: (url: string) => Record<string, string>;
  /** Per-site polling overrides (`sites`), which must never serve as write targets. */
  sites?: (url: string) => Record<string, string>;
  /** Also watch a bench (and so ping its site) against the mock. */
  bench?: boolean;
}

interface Rig {
  h: Harness;
  mock: MockFrappe;
}

async function rig(options: RigOptions = {}): Promise<Rig> {
  const server = await startMockFrappe();
  mock = server;
  server.expectedAuth = `token ${CREDENTIAL}`;
  const config: Record<string, unknown> = {
    api: options.api ? options.api(server.url) : { [SITE]: server.url },
  };
  if (options.sites) config.sites = options.sites(server.url);
  if (options.bench) {
    const bench = mkdtempSync(join(tmpdir(), "phoenix-frappe-task-"));
    dirs.push(bench);
    mkdirSync(join(bench, "sites", SITE), { recursive: true });
    writeFileSync(join(bench, "sites", "apps.txt"), "frappe\n");
    writeFileSync(join(bench, "sites", SITE, "site_config.json"), "{}");
    writeFileSync(
      join(bench, "sites", "common_site_config.json"),
      JSON.stringify({ webserver_port: server.port }),
    );
    config.benches = [bench];
  }
  // The poller sleeps until the capability is disabled, so it pings exactly once.
  const sleep = (_ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  const harness = createHarness({ modules: [createFrappeCapability({ sleep })] });
  h = harness;
  harness.manager.configure("frappe", config);
  if (options.token !== null) {
    await harness.manager.setSecret("frappe", "write_token", options.token ?? CREDENTIAL);
  }
  await harness.enable("frappe");
  return { h: harness, mock: server };
}

const input = (extra: Record<string, unknown> = {}) => ({
  site: SITE,
  subject: "Fix the login page",
  idempotency_key: KEY,
  ...extra,
});

/** Everything an operator or a log reader could see after a run. */
function everything(r: Rig, ...extra: unknown[]): string {
  return JSON.stringify([
    r.h.events,
    r.h.db.prepare("SELECT * FROM audit_log").all(),
    r.h.db.prepare("SELECT * FROM events").all(),
    r.h.manager.get("frappe"),
    vi.mocked(process.stdout.write).mock.calls,
    vi.mocked(process.stderr.write).mock.calls,
    ...extra,
  ]);
}

const posts = (r: Rig) => r.mock.writes.filter((w) => w.method === "POST");

describe("frappe task.create: manifest", () => {
  it("is an external, confirmed write with its own secret and write targets", async () => {
    const r = await rig();
    const view = r.h.manager.get("frappe");
    expect(view.commands.find((c) => c.name === "task.create")).toMatchObject({
      side_effect: "external",
    });
    const spec = createFrappeCapability().manifest.commands.find((c) => c.name === "task.create");
    expect(spec).toMatchObject({
      side_effect: "external",
      permissions: ["network", "external_api"],
      timeout_ms: 30_000,
    });
    expect(view.commands.filter((c) => c.side_effect !== "read").map((c) => c.name)).toEqual([
      "task.create",
    ]);
    expect(view.secrets.map((s) => s.name)).toEqual(["write_token"]);
    expect(view.permissions.map((p) => p.permission)).toContain("external_api");
  });
});

describe("frappe task.create: creating", () => {
  it("makes one lookup and one POST carrying only the allow-listed fields", async () => {
    const r = await rig();
    const op = await r.h.run(
      "frappe",
      "task.create",
      input({
        description: "Users cannot sign in.",
        priority: "High",
        exp_end_date: "2026-12-31",
        project: "PROJ-0001",
      }),
    );
    expect(op.error).toBeUndefined();
    expect(op.result).toEqual({
      status: "created",
      site: SITE,
      name: "TASK-00001",
      url: `${r.mock.url}/app/task/TASK-00001`,
      idempotency_key: KEY,
    });
    expect(r.mock.writes.map((w) => w.method)).toEqual(["GET", "POST"]);
    const post = posts(r)[0];
    expect(post).toMatchObject({
      path: "/api/resource/Task",
      site: SITE,
      authorization: `token ${CREDENTIAL}`,
      body: {
        doctype: "Task",
        subject: "Fix the login page",
        description: `Users cannot sign in.\n\nPhoenix ref: ${KEY}`,
        priority: "High",
        exp_end_date: "2026-12-31",
        project: "PROJ-0001",
      },
    });
    expect(Object.keys(post?.body as object).sort()).toEqual(
      ["description", "doctype", "exp_end_date", "priority", "project", "subject"].sort(),
    );
    expect(r.mock.tasks).toHaveLength(1);
  });

  it("sends the key as a visible last line and looks it up with a bounded JSON query", async () => {
    const r = await rig();
    await r.h.run("frappe", "task.create", input());
    const lookup = r.mock.writes[0];
    expect(lookup?.method).toBe("GET");
    const query = new URL(lookup?.path ?? "", "http://x").searchParams;
    expect(JSON.parse(query.get("filters") ?? "")).toEqual([["description", "like", `%${KEY}%`]]);
    expect(JSON.parse(query.get("fields") ?? "")).toEqual(["name"]);
    expect(query.get("limit_page_length")).toBe("5");
    expect(lookup?.authorization).toBe(`token ${CREDENTIAL}`);
    expect(r.mock.tasks[0]?.doc.description).toBe(`Phoenix ref: ${KEY}`);
  });

  it("returns the existing task for the same key without a second POST", async () => {
    const r = await rig();
    const first = await r.h.run("frappe", "task.create", input());
    const second = await r.h.run("frappe", "task.create", input({ subject: "Other words" }));
    expect(first.result).toMatchObject({ status: "created", name: "TASK-00001" });
    expect(second.result).toMatchObject({ status: "existing", name: "TASK-00001" });
    expect(posts(r)).toHaveLength(1);
    expect(r.mock.tasks).toHaveLength(1);
    // A different key is a different task.
    const third = await r.h.run("frappe", "task.create", input({ idempotency_key: `${KEY}-b` }));
    expect(third.result).toMatchObject({ status: "created", name: "TASK-00002" });
  });

  it("percent-encodes the name in the returned URL and keeps its case", async () => {
    const r = await rig();
    r.mock.tasks.push({
      name: "Task With Space",
      doc: { description: `Phoenix ref: ${KEY}` },
    });
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.result).toMatchObject({
      status: "existing",
      name: "Task With Space",
      url: `${r.mock.url}/app/task/Task%20With%20Space`,
    });
    expect(posts(r)).toHaveLength(0);
  });

  it("reduces the configured URL to its origin", async () => {
    const r = await rig({ api: (url) => ({ [SITE]: `${url}/some/path?x=1` }) });
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("succeeded");
    expect(r.mock.writes.map((w) => w.path.split("?")[0])).toEqual([
      "/api/resource/Task",
      "/api/resource/Task",
    ]);
  });
});

describe("frappe task.create: unknown outcome", () => {
  it("says so when the connection drops after the task was stored, and a retry finds it", async () => {
    const r = await rig();
    r.mock.setWriteMode("drop-after-create", "POST");
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/outcome is unknown/);
    expect(op.error?.message).toMatch(/safe to retry with the same idempotency_key/);
    expect(r.mock.tasks).toHaveLength(1);
    expect(posts(r)).toHaveLength(1); // never retried automatically

    r.mock.setWriteMode("ok");
    const retry = await r.h.run("frappe", "task.create", input());
    expect(retry.result).toMatchObject({ status: "existing", name: "TASK-00001" });
    expect(r.mock.tasks).toHaveLength(1);
    expect(posts(r)).toHaveLength(1);
  });

  it("reports cancellation of an in-flight POST as unknown too", async () => {
    const r = await rig();
    r.mock.setWriteMode("hang", "POST");
    const op = r.h.manager.invoke("frappe", "task.create", input());
    await vi.waitFor(() => {
      for (const c of r.h.permissions.pendingConfirmations()) {
        r.h.permissions.resolveConfirmation(c.id, true);
      }
      expect(posts(r)).toHaveLength(1);
    });
    await r.h.manager.disable("frappe");
    await vi.waitFor(() => expect(op.status).toBe("failed"));
    expect(op.error?.message).toMatch(/cancelled/);
    expect(op.error?.message).toMatch(/outcome is unknown/);
    expect(posts(r)).toHaveLength(1);
  });
});

describe("frappe task.create: refusing before any request", () => {
  it("fails clearly when the site has no write URL under api", async () => {
    const r = await rig({ api: () => ({ "other.localhost": "http://127.0.0.1:1" }) });
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/No write URL configured for site erp\.localhost under api/);
    expect(r.mock.requests).toHaveLength(0);
  });

  it("never falls back to the polling overrides or a bench for the write URL", async () => {
    const r = await rig({ api: () => ({}), sites: (url) => ({ [SITE]: url }), bench: true });
    await vi.waitFor(() => expect(r.mock.pingAuthorizations.length).toBeGreaterThan(0));
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(posts(r)).toHaveLength(0);
    expect(r.mock.writes).toHaveLength(0);
  });

  it("fails clearly without a write_token", async () => {
    const r = await rig({ token: null });
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/No write_token secret is set/);
    expect(r.mock.requests).toHaveLength(0);
  });

  it.each([
    "nocolon",
    "has space:abcdef",
    "abc:def",
    ":secretvalue",
    "key12345:",
    "a:b:c-too-many",
  ])("rejects the malformed write_token %j without echoing it", async (token) => {
    const r = await rig({ token });
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/must have the form api_key:api_secret/);
    expect(op.error?.message).not.toContain(token);
    expect(r.mock.requests).toHaveLength(0);
    expect(everything(r)).not.toContain(token);
  });

  it("asks for confirmation and sends nothing when the user says no", async () => {
    const r = await rig();
    const op = await r.h.run("frappe", "task.create", input(), false);
    expect(op.status).toBe("failed");
    expect(r.mock.requests).toHaveLength(0);
    expect(r.mock.tasks).toHaveLength(0);
  });

  it("is unreachable while the capability is disabled", async () => {
    const r = await rig();
    await r.h.manager.disable("frappe");
    expect(() => r.h.manager.invoke("frappe", "task.create", input())).toThrow(/not enabled/);
    expect(r.mock.requests).toHaveLength(0);
  });

  it("refuses an api URL the schema allowed but that is not a usable origin", async () => {
    const r = await rig({ api: () => ({ [SITE]: "https://[bad" }) });
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(
      /write URL for site erp\.localhost under api is not acceptable/,
    );
    expect(r.mock.requests).toHaveLength(0);
  });

  it.each([
    ["an unknown field", { extra: "x" }],
    ["a field that tries to set the doctype", { doctype: "User" }],
    ["a field that tries to set the owner", { owner: "Administrator" }],
    ["a priority outside the enum", { priority: "Critical" }],
    ["an empty subject", { subject: "" }],
    ["a subject over 140 characters", { subject: "s".repeat(141) }],
    ["a description over 10000 characters", { description: "d".repeat(10_001) }],
    ["a malformed date", { exp_end_date: "31/12/2026" }],
    ["a project with a control character", { project: "PROJ\u0000-1" }],
    ["a project with a newline", { project: "PROJ\n1" }],
    ["a short idempotency key", { idempotency_key: "short" }],
    ["an idempotency key with a space", { idempotency_key: "has space in the key" }],
    ["a site name that climbs directories", { site: "../etc" }],
    ["a non-string subject", { subject: { $ne: 1 } }],
  ])("rejects %s through the input schema", async (_label, extra) => {
    const r = await rig();
    await expect(r.h.run("frappe", "task.create", input(extra))).rejects.toThrow(
      /Invalid command input/,
    );
    expect(r.mock.requests).toHaveLength(0);
  });

  it("rejects a missing required field", async () => {
    const r = await rig();
    await expect(r.h.run("frappe", "task.create", { site: SITE, subject: "x" })).rejects.toThrow(
      /Invalid command input/,
    );
    expect(r.mock.requests).toHaveLength(0);
  });

  it("lets the manager refuse a secret-looking subject", async () => {
    const r = await rig();
    const leaked = ["Bear", "er ", "abcdefghijklmnop"].join("");
    await expect(r.h.run("frappe", "task.create", input({ subject: leaked }))).rejects.toThrow(
      /must not contain secrets/,
    );
    expect(r.mock.requests).toHaveLength(0);
  });
});

describe("frappe api config", () => {
  it("accepts https anywhere and plain http only for loopback", async () => {
    h = createHarness({ modules: [createFrappeCapability()] });
    for (const url of [
      "https://erp.example.com",
      "https://erp.example.com/sub/path",
      "http://127.0.0.1:8000",
      "http://localhost:8000",
      "http://[::1]:8000",
      "http://localhost",
    ]) {
      expect(() => h?.manager.configure("frappe", { api: { [SITE]: url } }), url).not.toThrow();
    }
  });

  it.each([
    "http://erp.example.com",
    "http://127.0.0.1.evil.example",
    "http://localhost@evil.example",
    "http://localhost:80@evil.example",
    "https://user:pass@erp.example.com",
    "https://erp.example.com@evil.example",
    "ftp://erp.example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://erp .example.com",
    "",
    `https://${"a".repeat(300)}.example`,
  ])("rejects the api URL %j", (url) => {
    h = createHarness({ modules: [createFrappeCapability()] });
    expect(() => h?.manager.configure("frappe", { api: { [SITE]: url } })).toThrow(
      /Invalid configuration/,
    );
  });

  it.each(["../x", "a/b", "", ".hidden", "a b", "x".repeat(150), "a:b"])(
    "rejects the site key %j",
    (site) => {
      h = createHarness({ modules: [createFrappeCapability()] });
      expect(() =>
        h?.manager.configure("frappe", { api: { [site]: "http://127.0.0.1:8000" } }),
      ).toThrow(/Invalid configuration/);
    },
  );

  it("rejects more than 20 targets and non-string values", () => {
    h = createHarness({ modules: [createFrappeCapability()] });
    const many = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`s${i}.localhost`, "http://127.0.0.1:1"]),
    );
    expect(() => h?.manager.configure("frappe", { api: many })).toThrow(/Invalid configuration/);
    expect(() => h?.manager.configure("frappe", { api: { [SITE]: 8000 } })).toThrow(
      /Invalid configuration/,
    );
    expect(() => h?.manager.configure("frappe", { api: "http://127.0.0.1:1" })).toThrow(
      /Invalid configuration/,
    );
  });

  it("is re-checked when the command runs (writeOrigin)", () => {
    const api = {
      ok: "http://127.0.0.1:8000/x?y=1",
      secure: "https://erp.example.com/a",
      plain: "http://erp.example.com",
      creds: "https://u:p@erp.example.com",
      lookalike: "http://localhost.evil.example",
      ftp: "ftp://erp.example.com",
      number: 8000,
    };
    expect(writeOrigin(api, "ok")).toBe("http://127.0.0.1:8000");
    expect(writeOrigin(api, "secure")).toBe("https://erp.example.com");
    for (const site of ["plain", "creds", "lookalike", "ftp", "number"]) {
      expect(() => writeOrigin(api, site), site).toThrow(/not acceptable/);
    }
    expect(() => writeOrigin(api, "missing")).toThrow(/No write URL configured/);
    expect(() => writeOrigin(api, "__proto__")).toThrow(/No write URL configured/);
    expect(() => writeOrigin(undefined, "ok")).toThrow(/No write URL configured/);
  });
});

describe("frappe task.create: hostile servers", () => {
  const credentialHalves = CREDENTIAL.split(":");

  /** Nothing the server said and nothing secret may appear anywhere a user or log can look. */
  function expectClean(r: Rig, op: { error?: unknown; result?: unknown }) {
    const seen = everything(r, op);
    expect(seen).not.toContain(REMOTE_MARKER);
    for (const half of credentialHalves) expect(seen).not.toContain(half);
  }

  it("does not follow a redirect (the credential stays put)", async () => {
    const r = await rig();
    r.mock.setWriteMode("redirect");
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(r.mock.writes).toHaveLength(1); // the lookup; no follow-up, no POST
    expect(r.mock.tasks).toHaveLength(0);
    expectClean(r, op);
  });

  it("does not follow a redirect on the POST and calls the outcome unknown", async () => {
    const r = await rig();
    r.mock.setWriteMode("redirect", "POST");
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/outcome is unknown/);
    expect(r.mock.writes.map((w) => w.method)).toEqual(["GET", "POST"]);
    expectClean(r, op);
  });

  it.each<[string, WriteMode, RegExp]>([
    ["403", "forbidden", /may not read or create Tasks \(HTTP 403\)$/],
    ["404", "not-found", /did not find the Task endpoint for this site \(HTTP 404\)/],
    ["417", "validation", /^Frappe rejected the task \(validation failed\)$/],
    ["500", "http500", /^Frappe returned HTTP 500\. The outcome is unknown/],
    ["malformed JSON", "malformed", /not valid JSON\. The outcome is unknown/],
    ["a huge chunked body", "huge", /too large\. The outcome is unknown/],
    ["a huge declared body", "huge-declared", /too large\. The outcome is unknown/],
    ["an implausible task name", "bad-name", /unexpected response\. The outcome is unknown/],
  ])("maps a hostile POST response (%s) to a fixed message", async (_label, mode, message) => {
    const r = await rig();
    r.mock.setWriteMode(mode, "POST");
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(message);
    expect(posts(r)).toHaveLength(1);
    expectClean(r, op);
  });

  it.each<[string, WriteMode, RegExp]>([
    ["401-style 403", "forbidden", /^Looking for an existing task failed: .*HTTP 403/],
    ["417", "validation", /^Looking for an existing task failed: Frappe rejected the task/],
    ["500", "http500", /^Looking for an existing task failed: Frappe returned HTTP 500$/],
    ["malformed JSON", "malformed", /Looking for an existing task failed: .*not valid JSON/],
    ["a huge chunked body", "huge", /Looking for an existing task failed: .*too large/],
    ["a huge declared body", "huge-declared", /Looking for an existing task failed: .*too large/],
    ["a task name that is not a name", "bad-name", /not creating a possible duplicate/],
  ])("never POSTs after a hostile lookup response (%s)", async (_label, mode, message) => {
    const r = await rig();
    r.mock.setWriteMode(mode, "GET");
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(message);
    expect(posts(r)).toHaveLength(0);
    expect(op.error?.message).not.toMatch(/unknown/);
    expectClean(r, op);
  });

  it("maps a wrong credential to a fixed 401 message", async () => {
    const r = await rig();
    r.mock.expectedAuth = "token some:other-credential";
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toBe(
      "Looking for an existing task failed: Frappe rejected the write credential (HTTP 401)",
    );
    expect(posts(r)).toHaveLength(0);
    expectClean(r, op);
  });

  it("maps a site the server does not know to the fixed 404 message", async () => {
    const r = await rig();
    r.mock.serveOnly(["another.localhost"]);
    const op = await r.h.run("frappe", "task.create", input());
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/HTTP 404/);
    expectClean(r, op);
  });
});

describe("frappe task.create: credential scope", () => {
  it("never puts the write credential on a health ping", async () => {
    const r = await rig({ bench: true });
    await vi.waitFor(() => expect(r.mock.pingAuthorizations.length).toBeGreaterThan(0));
    await r.h.run("frappe", "task.create", input());
    expect(r.mock.pingAuthorizations.every((a) => a === undefined)).toBe(true);
    expect(posts(r)).toHaveLength(1);
    expect(r.mock.writes.every((w) => w.authorization === `token ${CREDENTIAL}`)).toBe(true);
    // Only the two resource requests carried it.
    expect(r.mock.writes).toHaveLength(2);
  });
});

describe("buildTaskDocument", () => {
  const task = (extra: Partial<TaskInput> = {}): TaskInput => ({
    site: SITE,
    subject: "Subject",
    description: "",
    idempotency_key: KEY,
    ...extra,
  });

  it("contains only the fixed doctype and allow-listed fields", () => {
    expect(buildTaskDocument(task())).toEqual({
      doctype: "Task",
      subject: "Subject",
      description: `Phoenix ref: ${KEY}`,
    });
    expect(
      buildTaskDocument(
        task({ priority: "Low", exp_end_date: "2026-01-02", project: "P-1", description: "d" }),
      ),
    ).toEqual({
      doctype: "Task",
      subject: "Subject",
      description: `d\n\nPhoenix ref: ${KEY}`,
      priority: "Low",
      exp_end_date: "2026-01-02",
      project: "P-1",
    });
  });

  it("redacts secret-looking text in every free-text field", () => {
    const bearer = ["Bear", "er ", "abcdefghijklmnop"].join("");
    const doc = buildTaskDocument(
      task({ subject: `s ${bearer}`, description: `d ${bearer}`, project: `p-${bearer}` }),
    );
    expect(JSON.stringify(doc)).not.toContain("abcdefghijklmnop");
    expect(doc.subject).toContain("[REDACTED]");
    expect(doc.description).toContain("[REDACTED]");
    expect(doc.project).toContain("[REDACTED]");
  });

  it("strips control characters from the subject and project, keeping newlines in the description", () => {
    const doc = buildTaskDocument(
      task({
        subject: "a\u0000b\r\nc\u001b[31md\u007f",
        description: "line1\r\nline2\u0000\u0007\tend",
        project: "P\u0001-1",
      }),
    );
    expect(doc.subject).toBe("a b c [31md");
    expect(doc.description).toBe(`line1\nline2  \tend\n\nPhoenix ref: ${KEY}`);
    expect(doc.project).toBe("P -1");
  });

  it("leaves exactly one marker, even when the text tries to forge or smuggle one", () => {
    const doc = buildTaskDocument(
      task({
        subject: "Phoenix ref: forged",
        description:
          "Phoenix ref: other-key-123456789\nPHOENIX-REF :x\nphoenix_ref: y\nPhoenix Phoenix ref:ref: z",
      }),
    );
    expect(doc.subject).toBe("forged");
    const description = doc.description ?? "";
    expect(description.match(/phoenix[\s_-]*ref/gi)).toHaveLength(1);
    expect(description.endsWith(`\n\nPhoenix ref: ${KEY}`)).toBe(true);
  });

  it("refuses a subject that is empty once cleaned", () => {
    expect(() => buildTaskDocument(task({ subject: "\u0000\u0001 " }))).toThrow(/subject is empty/);
  });
});
