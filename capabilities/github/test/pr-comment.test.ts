// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `github.pr.comment` (Phase 79) against a FAKE fetch. No real pull request, repository, token or
// network was used: every request below is recorded by `vi.stubGlobal("fetch", ...)`.
import { readdirSync, readFileSync } from "node:fs";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGithubCapability,
  MAX_PR_COMMENT_BODY,
  parsePrCommentInput,
  postPrComment,
  PR_COMMENT_MAX_REPLY_BYTES,
  PR_COMMENT_ORIGIN,
  PR_COMMENT_TIMEOUT_MS,
  prCommentBodyHash,
  prCommentPayload,
  prCommentUrl,
} from "../src";

const REPO = "octo/phoenix";
const PR = 77;
const WRITE = ["gh", "p_", "WRITEWRITEWRITEWRITEWRITE0123456789"].join("");
const READ = ["gh", "p_", "READREADREADREADREADREAD0123456789"].join("");
const CI = ["gh", "p_", "CIWRITECIWRITECIWRITECIWRITE0123456789"].join("");
const LEAKY = ["gh", "p_", "LEAKYLEAKYLEAKYLEAKYLEAK0123456789"].join("");
const POST_URL = `https://api.github.com/repos/${REPO}/issues/${PR}/comments`;
const LINK = `https://github.com/${REPO}/pull/${PR}#issuecomment-9001`;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: unknown;
  signal: AbortSignal | undefined;
}

let calls: Call[] = [];
let h: Harness | undefined;

type Responder = (call: Call) => Response | Promise<Response> | Error;

const created = (patch: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ id: 9001, html_url: LINK, body: "echoed", ...patch }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });

function fakeFetch(post: Responder = () => created()) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
        body: init?.body,
        redirect: init?.redirect,
        signal: init?.signal ?? undefined,
      };
      calls.push(call);
      const out = post(call);
      if (out instanceof Error) throw out;
      return out;
    }),
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await h?.close();
  h = undefined;
});

const posts = () => calls.filter((c) => c.method === "POST");

const BODY = "## Handoff\n\nFiles: 2, +10 -3\n";
const input = (patch: Record<string, unknown> = {}, body = BODY) => ({
  repository: REPO,
  number: PR,
  body,
  body_sha256: prCommentBodyHash(body),
  body_chars: body.length,
  ...patch,
});
const direct = (value: unknown, token: string | undefined = WRITE) =>
  postPrComment(value, { token, signal: new AbortController().signal });

async function ready(secrets: { write?: string | null; read?: string | null; ci?: string } = {}) {
  h = createHarness({
    modules: [createGithubCapability({ sleep: () => Promise.withResolvers<void>().promise })],
  });
  // api_url points elsewhere on purpose: the write must still go to api.github.com.
  h.manager.configure("github", {
    repositories: [],
    api_url: "https://ghe.example.invalid/api/v3",
  });
  const write = secrets.write === undefined ? WRITE : secrets.write;
  if (write) await h.manager.setSecret("github", "write_token", write);
  if (secrets.read) await h.manager.setSecret("github", "token", secrets.read);
  if (secrets.ci) await h.manager.setSecret("github", "ci_write_token", secrets.ci);
  await h.enable("github");
  return h;
}

const comment = (patch: Record<string, unknown> = {}, approve = true) =>
  h!.run("github", "pr.comment", input(patch), approve);

describe("manifest", () => {
  it("is a separate external command; the card shows repository, number, hash and size", () => {
    const spec = createGithubCapability().manifest.commands.find((c) => c.name === "pr.comment");
    expect(spec).toMatchObject({
      side_effect: "external",
      permissions: ["network", "external_api"],
    });
    expect(spec?.input_schema).toMatchObject({
      additionalProperties: false,
      required: ["repository", "number", "body", "body_sha256", "body_chars"],
      properties: {
        repository: { "x-phoenix-confirm": true },
        number: { "x-phoenix-confirm": true, minimum: 1 },
        body_sha256: { "x-phoenix-confirm": true },
        body_chars: { "x-phoenix-confirm": true },
        body: { maxLength: MAX_PR_COMMENT_BODY },
      },
    });
    const names = createGithubCapability().manifest.commands.map((c) => c.name);
    expect(names).toContain("issue.create");
    expect(names).toContain("ci.rerun_failed");
    // It reuses the issue write secret; no new secret was added.
    expect(createGithubCapability().manifest.secrets?.map((s) => s.name)).toEqual([
      "token",
      "write_token",
      "ci_write_token",
    ]);
  });

  it("only the command handler calls the write function (nothing automatic does)", () => {
    const dir = new URL("../src/", import.meta.url);
    const callers = readdirSync(dir).filter(
      (f) => f !== "comments.ts" && /postPrComment\(/.test(readFileSync(new URL(f, dir), "utf8")),
    );
    expect(callers).toEqual(["index.ts"]);
    expect(readFileSync(new URL("index.ts", dir), "utf8").match(/postPrComment\(/g)).toHaveLength(
      1,
    );
  });
});

describe("the exact request", () => {
  it("is one POST to the documented URL, JSON body only, pinned origin, redirects refused, write token only", async () => {
    fakeFetch();
    await ready({ write: WRITE, read: READ, ci: CI });
    const op = await comment();
    expect(op.status).toBe("succeeded");
    expect(posts()).toHaveLength(1);
    const sent = posts()[0]!;
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe(POST_URL);
    expect(sent.url.startsWith(`${PR_COMMENT_ORIGIN}/`)).toBe(true);
    expect(prCommentUrl("octo", "phoenix", PR)).toBe(POST_URL);
    expect(JSON.parse(String(sent.body))).toEqual({ body: BODY.trim() });
    expect(sent.redirect).toBe("error");
    expect(sent.headers).toEqual({
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "phoenix-github-capability",
      authorization: `Bearer ${WRITE}`,
    });
  });

  it("ignores the api_url setting: the write stays on api.github.com", async () => {
    fakeFetch();
    await ready();
    await comment();
    for (const c of calls) expect(c.url.startsWith("https://api.github.com/")).toBe(true);
  });

  it("has a 15 s timeout signal combined with the caller's abort signal", async () => {
    fakeFetch();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await postPrComment(input(), { token: WRITE, signal: controller.signal });
    // The first timer is the request's own (the reply reader adds a second one).
    expect(timeout.mock.calls[0]).toEqual([PR_COMMENT_TIMEOUT_MS]);
    expect(PR_COMMENT_TIMEOUT_MS).toBe(15_000);
    controller.abort();
    expect(calls[0]!.signal?.aborted).toBe(true);
    timeout.mockRestore();
  });

  it("returns only the id and the validated link, never anything else GitHub wrote", async () => {
    fakeFetch(() => created({ user: { login: "x" }, body_html: "<script>", extra: LEAKY }));
    await ready();
    const op = await comment();
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({
      status: "commented",
      repository: REPO,
      number: PR,
      id: 9001,
      html_url: LINK,
    });
  });
});

describe("the body", () => {
  it("masks secrets and removes control characters before they leave", async () => {
    fakeFetch();
    const text = `before ${LEAKY} after\u0000\u001b[31m end\n`;
    await direct(input({}, text));
    const sent = prCommentPayload(text).body;
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ body: sent });
    expect(sent).not.toContain(LEAKY);
    expect(sent).toContain("[REDACTED]");
    expect(sent).not.toMatch(/[\u0000\u001b]/);
  });

  it("accepts exactly the maximum and refuses one more", async () => {
    fakeFetch();
    const max = "a".repeat(MAX_PR_COMMENT_BODY);
    await expect(direct(input({}, max))).resolves.toMatchObject({ status: "commented" });
    const over = "a".repeat(MAX_PR_COMMENT_BODY + 1);
    await expect(direct(input({}, over))).rejects.toMatchObject({ kind: "invalid" });
    expect(calls).toHaveLength(1);
  });

  it("refuses a body that is empty once control characters are removed", async () => {
    fakeFetch();
    const text = "\u0000\u0001 \n";
    await expect(direct(input({}, text))).rejects.toMatchObject({ kind: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a hash or size that does not describe the body (the card cannot lie)", async () => {
    fakeFetch();
    await expect(direct(input({ body_sha256: prCommentBodyHash("other") }))).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(direct(input({ body_chars: BODY.length + 1 }))).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(direct(input({ body_sha256: "A".repeat(64) }))).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("validation table", () => {
  const bad: [string, unknown][] = [
    ["no input", undefined],
    ["an array", []],
    ["extra field", { ...input(), labels: [] }],
    ["no repository", { ...input(), repository: undefined }],
    ["repository without owner", input({ repository: "phoenix" })],
    ["three segments", input({ repository: "a/b/c" })],
    ["dot-dot repository", input({ repository: "octo/.." })],
    ["traversal owner", input({ repository: "../x" })],
    ["owner with dash start", input({ repository: "-a/b" })],
    ["query in repository", input({ repository: "octo/phoenix?x=1" })],
    ["fragment in repository", input({ repository: "octo/phoenix#x" })],
    ["too long repository", input({ repository: `o/${"r".repeat(150)}` })],
    ["number zero", input({ number: 0 })],
    ["negative number", input({ number: -1 })],
    ["fractional number", input({ number: 1.5 })],
    ["string number", input({ number: "7" })],
    ["unsafe number", input({ number: Number.MAX_SAFE_INTEGER + 2 })],
    ["NaN number", input({ number: Number.NaN })],
    ["path in number", input({ number: "7/../8" })],
    ["empty body", input({ body: "" })],
    ["non-string body", input({ body: 5 })],
  ];

  it.each(bad)("refuses %s before any secret or network use", async (_name, value) => {
    fakeFetch();
    await expect(direct(value)).rejects.toMatchObject({ kind: "invalid" });
    expect(calls).toHaveLength(0);
    expect(() => parsePrCommentInput(value)).toThrow();
  });

  it("through the manager, a bad input is refused by schema and nothing is sent", async () => {
    fakeFetch();
    await ready();
    expect(() => h!.manager.invoke("github", "pr.comment", input({ number: 0 }))).toThrow(
      /Invalid command input/,
    );
    expect(() => h!.manager.invoke("github", "pr.comment", input({ repository: "../x" }))).toThrow(
      /Invalid command input/,
    );
    expect(() => h!.manager.invoke("github", "pr.comment", input({ body_sha256: "zz" }))).toThrow(
      /Invalid command input/,
    );
    expect(posts()).toHaveLength(0);
  });

  it("the error never echoes the rejected value", async () => {
    fakeFetch();
    const secretish = `octo/${LEAKY}!`;
    const err = await direct(input({ repository: secretish })).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(LEAKY);
  });
});

describe("confirmation and refusal", () => {
  it("asks for confirmation naming the repository, number, hash prefix and size; nothing is sent before approval", async () => {
    fakeFetch();
    await ready();
    const op = h!.manager.invoke("github", "pr.comment", input());
    await vi.waitFor(() => expect(h!.permissions.pendingConfirmations()).toHaveLength(1));
    const card = h!.permissions.pendingConfirmations()[0]!;
    expect(card.sideEffect).toBe("external");
    expect(card.summary).toContain(`repository: ${REPO}`);
    expect(card.summary).toContain(`number: ${PR}`);
    expect(card.summary).toContain(`body_sha256: ${prCommentBodyHash(BODY)}`);
    expect(card.summary).toContain(`body_chars: ${BODY.length}`);
    // The text itself is not the card; it is bound by the hash.
    expect(card.summary).not.toContain("Handoff");
    expect(calls).toHaveLength(0);
    h!.permissions.resolveConfirmation(card.id, true);
    await vi.waitFor(() => expect(op.status).toBe("succeeded"));
    expect(calls).toHaveLength(1);
  });

  it("a rejected confirmation sends nothing", async () => {
    fakeFetch();
    await ready();
    const op = await comment({}, false);
    expect(op.status).toBe("failed");
    expect(calls).toHaveLength(0);
  });
});

describe("credentials", () => {
  it("fails before any request without a write_token, even with the read token and ci_write_token", async () => {
    fakeFetch();
    await ready({ write: null, read: READ, ci: CI });
    const op = await comment();
    expect(op.status).toBe("failed");
    expect(posts()).toHaveLength(0);
    expect(JSON.stringify(op)).not.toContain(READ);
    expect(JSON.stringify(op)).not.toContain(CI);
  });

  it("an empty or unusable token fails before any request", async () => {
    fakeFetch();
    await expect(direct(input(), "")).rejects.toMatchObject({ kind: "auth" });
    await expect(
      postPrComment(input(), { token: undefined, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ kind: "auth" });
    await expect(direct(input(), "has space token")).rejects.toMatchObject({ kind: "auth" });
    expect(calls).toHaveLength(0);
  });
});

describe("status mapping", () => {
  const table: [number, string, RegExp][] = [
    [401, "auth", /401/],
    [403, "forbidden", /403/],
    [404, "not_found", /404/],
    [410, "http", /gone \(410\)/],
    [422, "http", /422/],
    [429, "rate_limit", /429/],
  ];

  it.each(table)(
    "%i is a fixed message that carries nothing GitHub wrote",
    async (status, kind, re) => {
      fakeFetch(() => new Response(`${WRITE} ${LEAKY} <script>`, { status }));
      const err = (await direct(input()).catch((e: Error) => e)) as Error & { kind: string };
      expect(err.kind).toBe(kind);
      expect(err.message).toMatch(re);
      expect(err.message).toMatch(/Nothing was posted/);
      for (const s of [WRITE, LEAKY, "<script>"]) expect(err.message).not.toContain(s);
      expect(calls).toHaveLength(1);
    },
  );

  it("a 5xx says the outcome is unknown and is never retried", async () => {
    fakeFetch(() => new Response("", { status: 502 }));
    const err = (await direct(input()).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/may or may not have been posted/);
    expect(calls).toHaveLength(1);
  });

  it("a non-201 success status (200, 202, 204) is not treated as a post", async () => {
    for (const status of [200, 202, 204]) {
      fakeFetch(() => new Response(status === 204 ? null : "{}", { status }));
      await expect(direct(input())).rejects.toMatchObject({ kind: "http" });
    }
  });

  it("a redirect response is refused, and the fetch is configured never to follow one", async () => {
    fakeFetch(
      () => new Response("", { status: 302, headers: { location: "https://evil.invalid/x" } }),
    );
    await expect(direct(input())).rejects.toMatchObject({ kind: "invalid" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.redirect).toBe("error");
  });

  it("a network failure says the outcome is unknown and is never retried", async () => {
    fakeFetch(() => new Error(`connection reset ${WRITE}`));
    const err = (await direct(input()).catch((e: Error) => e)) as Error & { kind: string };
    expect(err.kind).toBe("network");
    expect(err.message).toMatch(/may or may not have been posted/);
    expect(err.message).not.toContain(WRITE);
    expect(calls).toHaveLength(1);
  });
});

describe("hostile 201 replies", () => {
  it("an oversized reply (by length) is refused", async () => {
    fakeFetch(() => created({ pad: "x".repeat(PR_COMMENT_MAX_REPLY_BYTES) }));
    await expect(direct(input())).rejects.toMatchObject({ kind: "invalid" });
    expect(calls).toHaveLength(1);
  });

  it("an oversized declared content-length is refused without reading", async () => {
    fakeFetch(
      () =>
        new Response("{}", {
          status: 201,
          headers: { "content-length": String(PR_COMMENT_MAX_REPLY_BYTES + 1) },
        }),
    );
    await expect(direct(input())).rejects.toMatchObject({ kind: "invalid" });
  });

  it.each([
    ["an empty reply", () => new Response("", { status: 201 })],
    ["not JSON", () => new Response("<html>", { status: 201 })],
    ["an array", () => new Response("[]", { status: 201 })],
    ["no id", () => created({ id: undefined })],
    ["a string id", () => created({ id: "9001" })],
    ["a zero id", () => created({ id: 0 })],
    ["no link", () => created({ html_url: undefined })],
    ["an http link", () => created({ html_url: LINK.replace("https", "http") })],
    ["another host", () => created({ html_url: `https://evil.invalid/${REPO}/pull/${PR}` })],
    [
      "a lookalike host",
      () => created({ html_url: `https://github.com.evil.invalid/${REPO}/pull/${PR}` }),
    ],
    [
      "userinfo in the link",
      () => created({ html_url: `https://github.com@evil.invalid/a/b/pull/1` }),
    ],
    ["a javascript link", () => created({ html_url: "javascript:alert(1)" })],
    ["a link with a space", () => created({ html_url: `${LINK} x` })],
    ["a link with a query", () => created({ html_url: `${LINK}?x=1` })],
    [
      "a link with a port",
      () => created({ html_url: `https://github.com:444/${REPO}/pull/${PR}` }),
    ],
    [
      "a link that is not a pull request or issue",
      () => created({ html_url: "https://github.com/octo/phoenix" }),
    ],
    [
      "a very long link",
      () => created({ html_url: `https://github.com/${REPO}/pull/${PR}#${"a".repeat(600)}` }),
    ],
  ] as [string, () => Response][])(
    "%s is an error that says to check GitHub, not a result",
    async (_n, reply) => {
      fakeFetch(reply);
      const err = (await direct(input()).catch((e: Error) => e)) as Error & { kind: string };
      expect(err.kind).toBe("invalid");
      expect(err.message).toMatch(/probably posted/);
      expect(calls).toHaveLength(1);
    },
  );

  it("an issue link (a plain issue number was given) is accepted as the same github.com page", async () => {
    fakeFetch(() =>
      created({ html_url: `https://github.com/${REPO}/issues/${PR}#issuecomment-5` }),
    );
    await expect(direct(input())).resolves.toMatchObject({ id: 9001 });
  });
});

describe("secrets never leak", () => {
  it("the credentials appear in no operation, event or audit row, success or failure", async () => {
    fakeFetch();
    await ready({ write: WRITE, read: READ, ci: CI });
    const ok = await comment();
    fakeFetch(() => new Response(`${WRITE}`, { status: 403 }));
    const denied = await comment();
    expect(denied.status).toBe("failed");
    const all = JSON.stringify({
      ops: [ok, denied],
      events: h!.events,
      audit: h!.db.prepare("SELECT * FROM audit_log").all(),
    });
    for (const secret of [WRITE, READ, CI]) expect(all).not.toContain(secret);
  });

  it("the audit trail records the confirmation and the outcome of the write", async () => {
    fakeFetch();
    await ready();
    await comment();
    const rows = h!.db.prepare("SELECT capability_id, details FROM audit_log").all() as {
      capability_id: string;
      details: string;
    }[];
    const mine = rows.filter((r) => r.capability_id === "github");
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.some((r) => r.details.includes("pr.comment"))).toBe(true);
    // The comment text itself is not in the audit trail.
    expect(JSON.stringify(rows)).not.toContain("Handoff");
  });
});
