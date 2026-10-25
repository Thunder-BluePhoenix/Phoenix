// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 95: the chrome page's relay loop and the shell's page_snapshot / page_action parsing.
// Everything runs against fakes (a scripted client, a fake shell, a fake fetch) in happy-dom. No
// webview, window or page was involved, and no request left this process.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserApp } from "../src/browser/BrowserApp";
import { createFakeBrowserShell, type FakeBrowserShell } from "../src/browser/fake-shell";
import {
  RELAY_MAX_BODY_BYTES,
  boundBody,
  parseRelayRequest,
  relayResultPath,
  runRelayLoop,
} from "../src/browser/relay";
import {
  parsePageActionResult,
  parsePageSnapshotResult,
  tauriBrowserShell,
} from "../src/browser/shell";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SECRET = "hunter2-typed-secret";
const PAGE = "https://example.com/form";

type Step = unknown | Error | Promise<unknown>;

/** A scripted stand-in for PhoenixClient.request: GETs pop `polls`; once empty a poll never answers. */
function scripted(polls: Step[], postFails: Step[] = []) {
  const gets: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const request = vi.fn(async (method: string, path: string, body?: unknown) => {
    if (method === "GET") {
      gets.push(path);
      if (polls.length === 0) return new Promise(() => {});
      const step = polls.shift();
      if (step instanceof Error) throw step;
      return step;
    }
    posts.push({ path, body });
    const fail = postFails.shift();
    if (fail instanceof Error) throw fail;
    return { accepted: true };
  });
  return { client: { request } as unknown as PhoenixClient, gets, posts };
}

/** Records every backoff and returns at once. */
function sleeps() {
  const waited: number[] = [];
  return { waited, sleep: async (ms: number) => void waited.push(ms) };
}

function start(
  client: PhoenixClient,
  shell: FakeBrowserShell,
  sleep?: (ms: number) => Promise<void>,
) {
  const controller = new AbortController();
  const done = runRelayLoop({ client, shell, signal: controller.signal, sleep });
  return { controller, done };
}

const poll = (request: unknown) => ({ request });

describe("relay loop: snapshot", () => {
  it("polls with wait=20000, runs page_snapshot and posts url/title/html/truncated without tabId", async () => {
    const shell = createFakeBrowserShell();
    shell.snapshotOutcome = () => ({
      ok: true,
      tabId: "t9",
      url: PAGE,
      title: "Form",
      html: "<form></form>",
      truncated: true,
    });
    const { client, gets, posts } = scripted([poll({ id: "r1", kind: "snapshot" })]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(gets[0]).toBe("/api/browser/relay/next?wait=20000");
    expect(posts[0]).toEqual({
      path: "/api/browser/relay/r1/result",
      body: {
        ok: true,
        snapshot: { url: PAGE, title: "Form", html: "<form></form>", truncated: true },
      },
    });
    controller.abort();
    await done;
  });

  it("posts the shell's refusal reason", async () => {
    const shell = createFakeBrowserShell();
    shell.snapshotOutcome = () => ({ ok: false, reason: "not_a_web_page" });
    const { client, posts } = scripted([poll({ id: "r1", kind: "snapshot" })]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toEqual({ ok: false, reason: "not_a_web_page" });
    controller.abort();
    await done;
  });

  it("posts 'failed' when the shell rejects, and carries on with the next request", async () => {
    const shell = createFakeBrowserShell();
    shell.failNext("page_snapshot");
    const { client, posts } = scripted([
      poll({ id: "r1", kind: "snapshot" }),
      poll({ id: "r2", kind: "snapshot" }),
    ]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[0]!.body).toEqual({ ok: false, reason: "failed" });
    expect((posts[1]!.body as { ok: boolean }).ok).toBe(true);
    controller.abort();
    await done;
  });
});

describe("relay loop: actions", () => {
  const cases = [
    {
      name: "click",
      request: { id: "a1", kind: "click", expectedUrl: PAGE, selector: "button#go" },
      expected: { kind: "click", selector: "button#go", expectedUrl: PAGE },
    },
    {
      name: "submit",
      request: { id: "a2", kind: "submit", expectedUrl: PAGE, selector: "form#f" },
      expected: { kind: "submit", selector: "form#f", expectedUrl: PAGE },
    },
    {
      name: "download",
      request: { id: "a3", kind: "download", expectedUrl: PAGE, selector: 'button[name="dl"]' },
      expected: { kind: "download", selector: 'button[name="dl"]', expectedUrl: PAGE },
    },
    {
      name: "type",
      request: { id: "a4", kind: "type", expectedUrl: PAGE, selector: "input#q", text: SECRET },
      expected: { kind: "type", selector: "input#q", text: SECRET, expectedUrl: PAGE },
    },
    {
      name: "navigate",
      request: {
        id: "a5",
        kind: "navigate",
        expectedUrl: PAGE,
        destination: "https://example.org/next",
      },
      expected: { kind: "navigate", destination: "https://example.org/next", expectedUrl: PAGE },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: calls page_action with exactly the approved fields and posts {ok:true,url}`, async () => {
      const shell = createFakeBrowserShell();
      shell.actionOutcome = () => ({ ok: true, url: "https://example.com/after" });
      const { client, posts } = scripted([poll(c.request)]);
      const { controller, done } = start(client, shell);
      await vi.waitFor(() => expect(posts).toHaveLength(1));
      expect(shell.calls).toEqual([["page_action", c.expected]]);
      expect(posts[0]).toEqual({
        path: relayResultPath(c.request.id),
        body: { ok: true, url: "https://example.com/after" },
      });
      controller.abort();
      await done;
    });
  }

  it("posts the refusal reason of an action (page_changed, a navigation denial id)", async () => {
    const shell = createFakeBrowserShell();
    const reasons = ["page_changed", "private_network"];
    shell.actionOutcome = () => ({ ok: false, reason: reasons.shift()! });
    const { client, posts } = scripted([
      poll({ id: "a1", kind: "click", expectedUrl: PAGE, selector: "button#go" }),
      poll({ id: "a2", kind: "navigate", expectedUrl: PAGE, destination: "http://10.0.0.1/" }),
    ]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.body)).toEqual([
      { ok: false, reason: "page_changed" },
      { ok: false, reason: "private_network" },
    ]);
    controller.abort();
    await done;
  });

  it("posts 'failed' for an action the shell rejects", async () => {
    const shell = createFakeBrowserShell();
    shell.failNext("page_action");
    const { client, posts } = scripted([
      poll({ id: "a1", kind: "click", expectedUrl: PAGE, selector: "button#go" }),
    ]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toEqual({ ok: false, reason: "failed" });
    controller.abort();
    await done;
  });
});

describe("relay loop: malformed requests are refused", () => {
  const good = { id: "m1", kind: "click", expectedUrl: PAGE, selector: "button#go" };
  const bad: [string, unknown][] = [
    ["unknown kind", { ...good, kind: "eval" }],
    ["kind not a string", { ...good, kind: 5 }],
    ["extra field", { ...good, script: "alert(1)" }],
    ["snapshot with extra field", { id: "m1", kind: "snapshot", selector: "a" }],
    ["selector missing", { id: "m1", kind: "click", expectedUrl: PAGE }],
    ["selector not a string", { ...good, selector: 7 }],
    ["selector too long", { ...good, selector: "b".repeat(513) }],
    ["selector with a control char", { ...good, selector: "button#go\n" }],
    ["expectedUrl missing", { id: "m1", kind: "click", selector: "button#go" }],
    ["expectedUrl too long", { ...good, expectedUrl: "https://e.com/" + "a".repeat(2048) }],
    ["type without text", { ...good, kind: "type" }],
    ["type text too long", { ...good, kind: "type", text: "x".repeat(4097) }],
    ["type text not a string", { ...good, kind: "type", text: 1 }],
    ["click carrying text", { ...good, text: "x" }],
    ["navigate without destination", { id: "m1", kind: "navigate", expectedUrl: PAGE }],
    [
      "navigate destination too long",
      {
        id: "m1",
        kind: "navigate",
        expectedUrl: PAGE,
        destination: "https://e.com/" + "a".repeat(2048),
      },
    ],
  ];

  for (const [name, request] of bad) {
    it(`${name}: posts failed, never calls the shell`, async () => {
      const shell = createFakeBrowserShell();
      const { client, posts } = scripted([poll(request)]);
      const { controller, done } = start(client, shell);
      await vi.waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]!.body).toEqual({ ok: false, reason: "failed" });
      expect(shell.calls).toEqual([]);
      controller.abort();
      await done;
    });
  }

  it("accepts a type text of exactly 4096 characters, including newlines", () => {
    const text = "a\n".repeat(2048);
    expect(
      parseRelayRequest({ id: "t", kind: "type", expectedUrl: PAGE, selector: "input#q", text }),
    ).toMatchObject({ kind: "type", text });
  });

  it("a request without a usable id cannot be answered: nothing is posted and the loop backs off", async () => {
    const shell = createFakeBrowserShell();
    const { client, posts } = scripted([
      poll({ kind: "snapshot" }),
      poll({ id: 5, kind: "snapshot" }),
    ]);
    const { waited, sleep } = sleeps();
    const { controller, done } = start(client, shell, sleep);
    await vi.waitFor(() => expect(waited).toHaveLength(2));
    expect(posts).toEqual([]);
    expect(shell.calls).toEqual([]);
    controller.abort();
    await done;
  });

  it("an empty poll ({request:null}) or a non-object answer runs nothing and does not post", async () => {
    const shell = createFakeBrowserShell();
    const { client, posts, gets } = scripted([poll(null), undefined, {}]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(gets).toHaveLength(4));
    expect(posts).toEqual([]);
    expect(shell.calls).toEqual([]);
    controller.abort();
    await done;
  });
});

describe("relay loop: sequence, abort, backoff, size", () => {
  it("handles one request at a time: no new poll while a request is still running", async () => {
    const shell = createFakeBrowserShell();
    const gate = Promise.withResolvers<void>();
    shell.actionOutcome = async () => {
      await gate.promise;
      return { ok: true, url: PAGE };
    };
    const { client, gets, posts } = scripted([
      poll({ id: "s1", kind: "click", expectedUrl: PAGE, selector: "button#a" }),
      poll({ id: "s2", kind: "click", expectedUrl: PAGE, selector: "button#b" }),
    ]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(shell.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(gets).toHaveLength(1);
    expect(shell.calls).toHaveLength(1);
    gate.resolve();
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(shell.calls.map((c) => (c[1] as { selector: string }).selector)).toEqual([
      "button#a",
      "button#b",
    ]);
    controller.abort();
    await done;
  });

  it("abort while a poll is pending ends the loop and ignores the late answer", async () => {
    const shell = createFakeBrowserShell();
    const late = Promise.withResolvers<unknown>();
    const { client, posts } = scripted([late.promise]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(client.request).toHaveBeenCalledTimes(1));
    controller.abort();
    await done;
    late.resolve(poll({ id: "z1", kind: "snapshot" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(shell.calls).toEqual([]);
    expect(posts).toEqual([]);
  });

  it("abort while the shell is working posts nothing", async () => {
    const shell = createFakeBrowserShell();
    const gate = Promise.withResolvers<void>();
    shell.actionOutcome = async () => {
      await gate.promise;
      return { ok: true, url: PAGE };
    };
    const { client, posts } = scripted([
      poll({ id: "z2", kind: "click", expectedUrl: PAGE, selector: "button#go" }),
    ]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(shell.calls).toHaveLength(1));
    controller.abort();
    gate.resolve();
    await done;
    expect(posts).toEqual([]);
  });

  it("backs off 1s, 2s, 4s, 8s, 15s, 15s on poll errors and resets after a good round trip", async () => {
    const shell = createFakeBrowserShell();
    const boom = () => new Error("down");
    const { client, gets } = scripted([
      boom(),
      boom(),
      boom(),
      boom(),
      boom(),
      boom(),
      poll(null),
      boom(),
    ]);
    const { waited, sleep } = sleeps();
    const { controller, done } = start(client, shell, sleep);
    await vi.waitFor(() => expect(gets.length).toBeGreaterThanOrEqual(9));
    expect(waited).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 1000]);
    controller.abort();
    await done;
  });

  it("a successful result POST resets the backoff", async () => {
    const shell = createFakeBrowserShell();
    const { client, posts, gets } = scripted([
      new Error("down"),
      new Error("down"),
      poll({ id: "q1", kind: "snapshot" }),
      new Error("down"),
    ]);
    const { waited, sleep } = sleeps();
    const { controller, done } = start(client, shell, sleep);
    await vi.waitFor(() => expect(gets.length).toBeGreaterThanOrEqual(5));
    expect(posts).toHaveLength(1);
    expect(waited).toEqual([1000, 2000, 1000]);
    controller.abort();
    await done;
  });

  it("a failed result POST backs off and the loop keeps going", async () => {
    const shell = createFakeBrowserShell();
    const { client, posts } = scripted(
      [poll({ id: "p1", kind: "snapshot" }), poll({ id: "p2", kind: "snapshot" })],
      [new Error("500")],
    );
    const { waited, sleep } = sleeps();
    const { controller, done } = start(client, shell, sleep);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(waited).toEqual([1000]);
    controller.abort();
    await done;
  });

  it("never throws out of the loop, even for hostile answers", async () => {
    const shell = createFakeBrowserShell();
    const { client, gets } = scripted([
      "text",
      42,
      { request: [] },
      { request: "x" },
      poll({ id: "h".repeat(129), kind: "snapshot" }),
      {
        request: {
          get id(): string {
            throw new Error("getter");
          },
          kind: "snapshot",
        },
      },
    ]);
    const { sleep } = sleeps();
    const { controller, done } = start(client, shell, sleep);
    await vi.waitFor(() => expect(gets.length).toBeGreaterThanOrEqual(7));
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  });

  it("posts too_large instead of a snapshot over ~14 MiB (ASCII and multi-byte)", async () => {
    const shell = createFakeBrowserShell();
    const sizes = [15 * 1024 * 1024, 8 * 1024 * 1024];
    const fills = ["a", "é"];
    shell.snapshotOutcome = () => ({
      ok: true,
      tabId: "t1",
      url: PAGE,
      title: "Big",
      html: fills.shift()!.repeat(sizes.shift()!),
      truncated: false,
    });
    const { client, posts } = scripted([
      poll({ id: "b1", kind: "snapshot" }),
      poll({ id: "b2", kind: "snapshot" }),
    ]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts.map((p) => p.body)).toEqual([
      { ok: false, reason: "too_large" },
      { ok: false, reason: "too_large" },
    ]);
    controller.abort();
    await done;
  });

  it("lets a snapshot just under the limit through", () => {
    const body = {
      ok: true as const,
      snapshot: {
        url: PAGE,
        title: "t",
        html: "a".repeat(RELAY_MAX_BODY_BYTES - 1024),
        truncated: false,
      },
    };
    expect(boundBody(body)).toBe(body);
  });

  it("never logs a request: typed text appears in no console call", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const shell = createFakeBrowserShell();
    shell.failNext("page_action");
    const { client, posts } = scripted([
      poll({ id: "l1", kind: "type", expectedUrl: PAGE, selector: "input#q", text: SECRET }),
      poll({ id: "l2", kind: "type", expectedUrl: PAGE, selector: "input#q", text: SECRET }),
    ]);
    const { controller, done } = start(client, shell);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    controller.abort();
    await done;
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain(SECRET);
    expect(JSON.stringify(posts)).not.toContain(SECRET);
  });
});

describe("BrowserApp wiring", () => {
  async function mount(shell: FakeBrowserShell | null, online = true) {
    const next = Promise.withResolvers<unknown>();
    const results: unknown[] = [];
    let polls = 0;
    const api = fakeApi({
      "GET /api/browser/shields": () => ({ shields: { enabled: true, offSites: [] } }),
      "GET /api/browser/relay/next": () => {
        polls += 1;
        return polls === 1 ? next.promise : new Promise(() => {});
      },
      "POST /api/browser/relay/w1/result": (body) => {
        results.push(body);
        return { accepted: true };
      },
    });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    const view = render(
      <CoreProvider client={client}>
        <BrowserApp shell={shell} schedule={() => () => {}} />
      </CoreProvider>,
    );
    if (online) act(() => FakeWebSocket.last.open());
    await act(async () => Promise.resolve());
    const polled = () => api.calls.filter((c) => c.path.startsWith("/api/browser/relay/next"));
    return { api, view, next, results, polled };
  }

  it("starts when a shell exists and Core is online, answers a request and renders none of it", async () => {
    const shell = createFakeBrowserShell();
    shell.snapshotOutcome = () => ({
      ok: true,
      tabId: "t1",
      url: PAGE,
      title: "Form",
      html: `<script>window.pwn=1</script><p>${SECRET}</p>`,
      truncated: false,
    });
    const m = await mount(shell);
    await vi.waitFor(() => expect(m.polled()).toHaveLength(1));
    expect(m.polled()[0]!.path).toBe("/api/browser/relay/next?wait=20000");
    m.next.resolve(poll({ id: "w1", kind: "snapshot" }));
    await vi.waitFor(() => expect(m.results).toHaveLength(1));
    expect(m.results[0]).toMatchObject({ ok: true, snapshot: { url: PAGE, title: "Form" } });
    await act(async () => Promise.resolve());
    expect(m.view.container.innerHTML).not.toContain(SECRET);
    expect(m.view.container.innerHTML).not.toContain("pwn");
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("does not poll without a shell or while Core is not online", async () => {
    const none = await mount(null);
    await new Promise((r) => setTimeout(r, 30));
    expect(none.polled()).toHaveLength(0);
    cleanup();
    const offline = await mount(createFakeBrowserShell(), false);
    await new Promise((r) => setTimeout(r, 30));
    expect(offline.polled()).toHaveLength(0);
  });

  it("unmounting aborts the loop: a request that arrives afterwards is neither run nor answered", async () => {
    const shell = createFakeBrowserShell();
    const m = await mount(shell);
    await vi.waitFor(() => expect(m.polled()).toHaveLength(1));
    m.view.unmount();
    m.next.resolve(poll({ id: "w1", kind: "snapshot" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(shell.calls.filter((c) => c[0] === "page_snapshot")).toEqual([]);
    expect(m.results).toEqual([]);
  });
});

describe("shell: page_snapshot / page_action parsing", () => {
  const snap = {
    ok: true,
    tabId: "t1",
    url: PAGE,
    title: "T",
    html: "<p>x</p>",
    truncated: false,
  };

  it("accepts a well-formed snapshot answer and a refusal", () => {
    expect(parsePageSnapshotResult(snap)).toEqual(snap);
    expect(parsePageSnapshotResult({ ok: false, reason: "no_active_tab" })).toEqual({
      ok: false,
      reason: "no_active_tab",
    });
  });

  it("turns every other shape into {ok:false, reason:'failed'}", () => {
    const failed = { ok: false, reason: "failed" };
    for (const bad of [
      undefined,
      null,
      "ok",
      7,
      [],
      {},
      { ok: "true" },
      { ...snap, tabId: "" },
      { ...snap, tabId: 1 },
      { ...snap, url: 1 },
      { ...snap, title: null },
      { ...snap, html: undefined },
      { ...snap, truncated: "no" },
    ])
      expect(parsePageSnapshotResult(bad)).toEqual(failed);
    for (const bad of [undefined, null, {}, { ok: true }, { ok: true, url: 4 }, { ok: 1 }])
      expect(parsePageActionResult(bad)).toEqual(failed);
  });

  it("accepts only closed-id reasons and bounds url and title", () => {
    expect(parsePageActionResult({ ok: true, url: PAGE })).toEqual({ ok: true, url: PAGE });
    for (const reason of ["Has Space", "x".repeat(65), "", 5, "<b>", "a\nb"])
      expect(parsePageActionResult({ ok: false, reason })).toEqual({ ok: false, reason: "failed" });
    const act = parsePageActionResult({ ok: true, url: "u".repeat(5000) });
    expect(act.ok && act.url.length).toBe(2048);
    const long = parsePageSnapshotResult({
      ...snap,
      url: "u".repeat(5000),
      title: "t".repeat(900),
    });
    expect(long.ok && long.url.length).toBe(2048);
    expect(long.ok && long.title.length).toBe(300);
  });

  it("tauriBrowserShell maps to page_snapshot / page_action with camelCase args, and rejection to failed", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    let answer: unknown = snap;
    let boom = false;
    const invoke = async (command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      if (boom) throw new Error(`denied ${SECRET}`);
      return command === "page_snapshot" ? answer : { ok: true, url: PAGE };
    };
    const win = {
      __TAURI__: { core: { invoke }, event: { listen: async () => () => {} } },
    } as unknown as Window;
    const shell = tauriBrowserShell(win)!;
    expect(await shell.pageSnapshot()).toEqual(snap);
    await shell.pageAction({ kind: "type", selector: "input#q", text: "hi", expectedUrl: PAGE });
    await shell.pageAction({
      kind: "navigate",
      destination: "https://example.org/",
      expectedUrl: PAGE,
    });
    await shell.pageAction({ kind: "click", selector: "button#go", expectedUrl: PAGE });
    expect(calls).toEqual([
      ["page_snapshot", {}],
      ["page_action", { kind: "type", selector: "input#q", text: "hi", expectedUrl: PAGE }],
      ["page_action", { kind: "navigate", destination: "https://example.org/", expectedUrl: PAGE }],
      ["page_action", { kind: "click", selector: "button#go", expectedUrl: PAGE }],
    ]);
    answer = { nonsense: true };
    expect(await shell.pageSnapshot()).toEqual({ ok: false, reason: "failed" });
    boom = true;
    expect(await shell.pageSnapshot()).toEqual({ ok: false, reason: "failed" });
    const refused = await shell.pageAction({
      kind: "click",
      selector: "button#go",
      expectedUrl: PAGE,
    });
    expect(refused).toEqual({ ok: false, reason: "failed" });
    expect(JSON.stringify(refused)).not.toContain(SECRET);
  });
});
