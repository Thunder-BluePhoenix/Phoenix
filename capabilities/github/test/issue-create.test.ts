// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `github.issue.create` (Phase 36), exercised ONLY against a mock GitHub on 127.0.0.1. Nothing in
// this file can reach a real GitHub: the capability's api_url points at the mock.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { createGithubCapability, issueMarker, issuePayload } from "../src";
import {
  MOCK_REMOTE_MARKER,
  MOCK_TOKEN,
  MOCK_WRITE_TOKEN,
  startMockGithub,
  type MockGithub,
  type WriteMode,
} from "../testing/mock-github";

const REPO = "octo/phoenix";
const KEY = "plan1-task1-abcdef0123456789";

let h: Harness | undefined;
let gh: MockGithub | undefined;

afterEach(async () => {
  await h?.close();
  await gh?.close();
  h = gh = undefined;
});

async function ready(
  options: { writeToken?: string | null; readToken?: string | null; mode?: WriteMode } = {},
) {
  gh = await startMockGithub();
  if (options.mode) gh.writeMode.current = options.mode;
  h = createHarness({
    modules: [createGithubCapability({ sleep: () => Promise.withResolvers<void>().promise })],
  });
  h.manager.configure("github", { repositories: [], api_url: gh.url });
  const read = options.readToken === undefined ? null : options.readToken;
  if (read) await h.manager.setSecret("github", "token", read);
  const write = options.writeToken === undefined ? MOCK_WRITE_TOKEN : options.writeToken;
  if (write) await h.manager.setSecret("github", "write_token", write);
  await h.enable("github");
  return { h, gh };
}

const create = (input: Record<string, unknown>, approve = true) =>
  h!.run("github", "issue.create", { repository: REPO, idempotency_key: KEY, ...input }, approve);

/** Requests other than the poller's own GET /user (the read token's only use). */
const nonPoll = () => gh!.requests.filter((r) => r.path !== "/user");
const posts = () => gh!.writes.filter((w) => w.method === "POST");
const everything = (ops: unknown[] = []) =>
  JSON.stringify({
    ops,
    events: h!.events,
    audit: h!.db.prepare("SELECT * FROM audit_log").all(),
  });

describe("manifest", () => {
  it("issue.create is external, needs network + external_api, and declares a separate write_token", async () => {
    await ready();
    const view = h!.manager.get("github");
    expect(view.commands).toContainEqual(
      expect.objectContaining({ name: "issue.create", side_effect: "external" }),
    );
    const spec = createGithubCapability().manifest.commands.find((c) => c.name === "issue.create");
    expect(spec?.permissions).toEqual(["network", "external_api"]);
    expect(view.secrets.map((s) => s.name)).toEqual(["token", "write_token"]);
    expect(view.permissions.map((p) => p.permission)).toEqual(["network", "external_api"]);
  });
});

describe("creating an issue", () => {
  it("makes exactly one POST with the allow-listed fields and the hidden marker, and returns the link", async () => {
    await ready();
    const op = await create({ title: "Vendor approval", body: "Do the thing", labels: ["a", "b"] });
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({
      status: "created",
      repository: REPO,
      number: 1,
      url: `https://github.com/${REPO}/issues/1`,
      idempotency_key: KEY,
    });
    expect(posts()).toHaveLength(1);
    const sent = posts()[0]!;
    expect(sent.path).toBe(`/repos/${REPO}/issues`);
    expect(sent.authorization).toBe(`Bearer ${MOCK_WRITE_TOKEN}`);
    expect(sent.contentType).toBe("application/json");
    expect(sent.body).toEqual({
      title: "Vendor approval",
      body: `Do the thing\n\n${issueMarker(KEY)}`,
      labels: ["a", "b"],
    });
    expect(gh!.issues).toHaveLength(1);
  });

  it("a second identical call finds the issue by its marker and does NOT create another", async () => {
    await ready();
    await create({ title: "T", body: "B" });
    const again = await create({ title: "T", body: "B" });
    expect(again.status).toBe("succeeded");
    expect(again.result).toMatchObject({ status: "existing", number: 1 });
    expect(posts()).toHaveLength(1);
    expect(gh!.issues).toHaveLength(1);
  });

  it("finds it through search when the issue is no longer in the recent list (eventual consistency: search wins when indexed)", async () => {
    await ready();
    await create({ title: "T" });
    gh!.issues[0]!.hiddenFromList = true;
    const again = await create({ title: "T" });
    expect(again.result).toMatchObject({ status: "existing", number: 1 });
    expect(posts()).toHaveLength(1);
  });

  it("KNOWN LIMIT: neither listed nor indexed yet => a duplicate is created (documented caveat)", async () => {
    await ready();
    await create({ title: "T" });
    gh!.issues[0]!.hiddenFromList = true;
    gh!.issues[0]!.hiddenFromSearch = true;
    await create({ title: "T" });
    expect(posts()).toHaveLength(2);
  });

  it("unknown outcome (stored, then the connection dropped): the error says so; a retry with the same key finds the issue", async () => {
    await ready({ mode: "store-then-drop" });
    const first = await create({ title: "T" });
    expect(first.status).toBe("failed");
    expect(first.error?.message).toMatch(/may or may not have been created/);
    expect(first.error?.message).toMatch(/same idempotency_key/);
    gh!.writeMode.current = "ok";
    const retry = await create({ title: "T" });
    expect(retry.result).toMatchObject({ status: "existing", number: 1 });
    expect(gh!.issues).toHaveLength(1);
  });

  it("a different key creates a second issue", async () => {
    await ready();
    await create({ title: "T" });
    await create({ title: "T", idempotency_key: ["other-key", "abcdef", "0123456789"].join("-") });
    expect(posts()).toHaveLength(2);
  });

  it("a pull request that carries the marker is not mistaken for the issue", async () => {
    await ready();
    gh!.issues.push({
      number: 7,
      title: "pr",
      body: issueMarker(KEY),
      labels: [],
      pullRequest: true,
      hiddenFromSearch: true,
    });
    const op = await create({ title: "T" });
    expect(op.result).toMatchObject({ status: "created" });
    expect(posts()).toHaveLength(1);
  });

  it("a marker typed by the user is stripped so only Phoenix's own marker exists", () => {
    const sent = issuePayload({
      repository: REPO,
      title: "T",
      body: `x <!-- phoenix-ref:forged-forged-forged-1 --> y`,
      idempotency_key: KEY,
    });
    expect(sent.body.match(/phoenix-ref/g)).toHaveLength(1);
    expect(sent.body).toContain(KEY);
  });

  it("secret-looking text in the body, title and labels is redacted before it leaves the machine", async () => {
    await ready();
    const op = await create({
      title: `leak ${FAKE_GITHUB_TOKEN}`,
      body: `use ${FAKE_GITHUB_TOKEN} here`,
    }).catch((e: unknown) => e);
    // The manager refuses a command input that contains a credential outright...
    expect(op).toBeInstanceOf(Error);
    expect(posts()).toHaveLength(0);
    // ...and the payload builder redacts anything that gets past it (defence in depth).
    const sent = issuePayload({
      repository: REPO,
      title: `leak ${FAKE_GITHUB_TOKEN}`,
      body: `use ${FAKE_GITHUB_TOKEN}`,
      labels: [FAKE_GITHUB_TOKEN],
      idempotency_key: KEY,
    });
    expect(JSON.stringify(sent)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(sent.title).toContain("[REDACTED]");
  });

  it("control characters are removed from the title and newlines collapse", () => {
    const sent = issuePayload({
      repository: REPO,
      title: "a\u0000b\nc\td",
      idempotency_key: KEY,
    });
    expect(sent.title).toBe("ab c d");
  });
});

describe("the write token is separate from the read token", () => {
  it("a read token alone does not enable writes: clear error, no request at all", async () => {
    await ready({ writeToken: null, readToken: MOCK_TOKEN });
    const op = await create({ title: "T" });
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/write_token/);
    expect(nonPoll()).toEqual([]);
    expect(JSON.stringify(op)).not.toContain(MOCK_TOKEN);
  });

  it("the read token is never sent as a write credential, and the write token never polls", async () => {
    await ready({ readToken: MOCK_TOKEN });
    await create({ title: "T" });
    expect(posts()[0]!.authorization).toBe(`Bearer ${MOCK_WRITE_TOKEN}`);
    // Lookups also use the write token; nothing sent the read token anywhere in this flow.
    expect(nonPoll().every((r) => r.authorization !== `Bearer ${MOCK_TOKEN}`)).toBe(true);
  });

  it("a write token the server rejects gives a fixed message and no remote text", async () => {
    await ready({ writeToken: ["gh", "p_", "x".repeat(30)].join("") });
    const op = await create({ title: "T" });
    expect(op.status).toBe("failed");
    expect(posts()).toHaveLength(0);
    expect(op.error?.message).not.toContain(MOCK_REMOTE_MARKER);
  });

  it("a malformed write token (whitespace) is refused before any request", async () => {
    await ready({ writeToken: "has space inside token" });
    const op = await create({ title: "T" });
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/not a usable token/);
    expect(gh!.requests).toEqual([]);
  });
});

describe("confirmation and permission gates", () => {
  it("declining the confirmation sends nothing", async () => {
    await ready();
    const op = await create({ title: "T" }, false);
    expect(op.status).toBe("failed");
    expect(gh!.requests).toEqual([]);
  });

  it("without a decision the operation waits and nothing is sent", async () => {
    await ready();
    const op = h!.manager.invoke("github", "issue.create", {
      repository: REPO,
      title: "T",
      idempotency_key: KEY,
    });
    await vi.waitFor(() => expect(h!.permissions.pendingConfirmations()).toHaveLength(1));
    expect(op.status).toBe("pending");
    expect(h!.permissions.pendingConfirmations()[0]).toMatchObject({ sideEffect: "external" });
    expect(gh!.requests).toEqual([]);
    for (const c of h!.permissions.pendingConfirmations())
      h!.permissions.resolveConfirmation(c.id, false);
  });

  it("is unreachable while the capability is disabled", async () => {
    await ready();
    await h!.manager.disable("github");
    expect(() =>
      h!.manager.invoke("github", "issue.create", {
        repository: REPO,
        title: "T",
        idempotency_key: KEY,
      }),
    ).toThrow();
    expect(gh!.requests).toEqual([]);
  });
});

describe("input validation", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["unknown field", { title: "T", assignees: ["x"] }],
    ["empty title", { title: "" }],
    ["title over 256", { title: "x".repeat(257) }],
    ["body over 10000", { title: "T", body: "x".repeat(10_001) }],
    ["11 labels", { title: "T", labels: Array.from({ length: 11 }, (_, i) => `l${i}`) }],
    ["empty label", { title: "T", labels: [""] }],
    ["bad repository", { title: "T", repository: "../etc" }],
    ["repository with query", { title: "T", repository: "a/b?x=1" }],
    ["short key", { title: "T", idempotency_key: "short" }],
    ["key with space", { title: "T", idempotency_key: "has space has space has" }],
  ];
  for (const [name, input] of bad) {
    it(`rejects ${name} without any request`, async () => {
      await ready();
      expect(() =>
        h!.manager.invoke("github", "issue.create", {
          repository: REPO,
          idempotency_key: KEY,
          ...input,
        }),
      ).toThrow();
      expect(gh!.requests).toEqual([]);
    });
  }
});

describe("hostile responses", () => {
  it("a redirect is refused, not followed, and one request was made", async () => {
    await ready({ mode: "redirect" });
    const op = await create({ title: "T" });
    expect(op.status).toBe("failed");
    expect(posts()).toHaveLength(1);
    expect(gh!.requests.filter((r) => r.path === "/redirected-write")).toEqual([]);
    expect(gh!.issues).toHaveLength(0);
  });

  const modes: [WriteMode, RegExp][] = [
    ["http500", /may or may not have been created/],
    ["http422", /rejected the issue as invalid/],
    ["malformed", /could not read/],
    ["huge", /could not read/],
    ["bad-link", /could not read/],
  ];
  for (const [mode, message] of modes) {
    it(`${mode}: fixed message, nothing the server wrote leaks`, async () => {
      await ready({ mode });
      const op = await create({ title: "T" });
      expect(op.status).toBe("failed");
      expect(op.error?.message).toMatch(message);
      expect(everything([op])).not.toContain(MOCK_REMOTE_MARKER);
      expect(everything([op])).not.toContain(MOCK_WRITE_TOKEN);
      expect(posts()).toHaveLength(1);
    });
  }

  it("the credential appears in no operation, event or audit row on success either", async () => {
    await ready();
    const op = await create({ title: "T" });
    await h!.drain();
    expect(everything([op])).not.toContain(MOCK_WRITE_TOKEN);
  });
});
