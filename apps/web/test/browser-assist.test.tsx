// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 95: the "Ask Fawkes to help with this page" panel in the Phoenix browser's CHROME. Everything
// runs against a fake shell and a fake Core (a routed fetch). No model, page, webview, window or
// approval card was involved: the approval itself is Core's, and the fake only answers the
// operation Core would have created.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserApp } from "../src/browser/BrowserApp";
import {
  ASSIST_MAX_GOAL,
  goalProblem,
  parseAssistAnswer,
  stepFailure,
  stepRefusal,
} from "../src/browser/assist";
import { createFakeBrowserShell, type FakeBrowserShell } from "../src/browser/fake-shell";
import { BROWSER_CHROME_ASSIST_HEIGHT } from "../src/browser/shell";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await act(async () => Promise.resolve());
}

const PAGE = "https://shop.example.com/cart?item=1";
const OK_PLAN = {
  status: "ok",
  plan: {
    page_url: PAGE,
    actions: [
      { kind: "type", selector: "input#qty", text: "2", model_written: true },
      { kind: "click", selector: "button#add" },
      { kind: "submit", selector: "form#checkout" },
    ],
  },
  dropped: 1,
  processed_by: "ollama",
};

type OperationOutcome = { status: string; error?: { code: string; message: string } };

interface Setup {
  shell: FakeBrowserShell;
  api: FakeApi;
  headers: string[];
  /** Per operation id: what GET /api/operations/<id> answers. */
  operations: Record<string, OperationOutcome>;
}

/** Opens a tab the way a person does: through the address bar. */
async function visit(url: string) {
  const address = screen.getByLabelText("Address or search");
  fireEvent.change(address, { target: { value: url } });
  fireEvent.submit(address.closest("form")!);
  await flush();
}

async function mount(
  answer: unknown = OK_PLAN,
  opts: { tabUrl?: string; assistStatus?: number } = {},
): Promise<Setup> {
  const shell = createFakeBrowserShell();
  const operations: Record<string, OperationOutcome> = {};
  let next = 0;
  const api = fakeApi({
    "GET /api/browser/shields": () => ({ shields: { enabled: true, offSites: [] } }),
    "POST /api/browser/assist": () =>
      opts.assistStatus && opts.assistStatus >= 400
        ? new Response(JSON.stringify({ code: "INTERNAL", message: "boom <b>x</b>" }), {
            status: opts.assistStatus,
          })
        : answer,
    "POST /api/capabilities/browser/commands/*": () => {
      const id = `op-${++next}`;
      operations[id] ??= { status: "succeeded" };
      return { id };
    },
    "GET /api/operations/*": (_body, url) =>
      operations[url.pathname.split("/").pop()!] ?? { status: "succeeded" },
  });
  const headers: string[] = [];
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: ((input: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (new URL(input).pathname === "/api/browser/assist") headers.push(auth ?? "");
      return api.fetchImpl(input, init);
    }) as typeof fetch,
  });
  render(
    <CoreProvider client={client}>
      <BrowserApp shell={shell} schedule={() => () => {}} />
    </CoreProvider>,
  );
  await flush();
  await visit(opts.tabUrl ?? PAGE);
  return { shell, api, headers, operations };
}

const open = async () => {
  fireEvent.click(screen.getByLabelText("Ask Fawkes to help with this page"));
  await flush();
};
const goal = () => screen.getByLabelText("What do you want done on this page?") as HTMLInputElement;
const proposeButton = () => screen.getByRole("button", { name: /^Propose steps$/ });
const runButtons = () => screen.getAllByRole("button", { name: "Run this step" });

async function propose(text = "add two to the cart") {
  fireEvent.change(goal(), { target: { value: text } });
  fireEvent.click(proposeButton());
  await flush();
}

const commandPosts = (api: FakeApi) =>
  api.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/capabilities/browser/"));

describe("goal checks (pure)", () => {
  it("accepts a plain goal and refuses control, bidi, zero-width and over-long text", () => {
    expect(goalProblem("add it to the cart")).toBeNull();
    expect(goalProblem("a".repeat(ASSIST_MAX_GOAL))).toBeNull();
    expect(goalProblem("a".repeat(ASSIST_MAX_GOAL + 1))).toBe("too_long");
    expect(goalProblem("a\u0007b")).toBe("control");
    expect(goalProblem("a\u202eb")).toBe("hidden");
    expect(goalProblem("a\u200bb")).toBe("hidden");
  });
});

describe("answer parsing (pure)", () => {
  it("accepts the route's ok answer and the three fixed failures", () => {
    expect(parseAssistAnswer(OK_PLAN)).toMatchObject({ status: "ok", pageUrl: PAGE, dropped: 1 });
    for (const status of ["no_local_model", "local_model_failed", "no_browser"])
      expect(parseAssistAnswer({ status, detail: "ignored" })).toEqual({ status });
  });

  it("refuses an answer that is not exactly the documented shape", () => {
    const bad = (mut: (p: typeof OK_PLAN.plan) => unknown) =>
      parseAssistAnswer({ ...OK_PLAN, plan: mut(structuredClone(OK_PLAN.plan)) });
    expect(parseAssistAnswer(null)).toBeNull();
    expect(parseAssistAnswer({ status: "ok" })).toBeNull();
    expect(parseAssistAnswer({ status: "weird" })).toBeNull();
    expect(bad((p) => ({ ...p, page_url: "javascript:alert(1)" }))).toBeNull();
    expect(
      bad((p) => ({ ...p, actions: [{ kind: "navigate", destination: "https://e.com/" }] })),
    ).toBeNull();
    expect(
      bad((p) => ({ ...p, actions: [{ kind: "click", selector: "div:nth-of-type(2)" }] })),
    ).toBeNull();
    expect(bad((p) => ({ ...p, actions: [{ kind: "type", selector: "input#a" }] }))).toBeNull();
    // A typed text that Core did not mark as model-written is not an answer we trust.
    expect(
      bad((p) => ({ ...p, actions: [{ kind: "type", selector: "input#a", text: "x" }] })),
    ).toBeNull();
    expect(
      bad((p) => ({ ...p, actions: [{ kind: "click", selector: "button#a", text: "x" }] })),
    ).toBeNull();
    const six = Array.from({ length: 6 }, () => ({ kind: "click", selector: "button#a" }));
    expect(bad((p) => ({ ...p, actions: six }))).toBeNull();
  });

  it("maps Core's error codes to fixed reasons", () => {
    expect(stepFailure("PERMISSION_DENIED")).toBe("denied");
    expect(stepFailure("SECURITY_POLICY_BLOCKED")).toBe("blocked");
    expect(stepFailure("CAPABILITY_UNAVAILABLE")).toBe("unavailable");
    expect(stepFailure("OPERATION_TIMEOUT")).toBe("timeout");
    expect(stepFailure("SOMETHING")).toBe("failed");
  });
});

describe("page re-check (pure)", () => {
  const plan = { tabId: "tab-1", pageUrl: PAGE };
  it("passes only for the same tab on the same page, ignoring the fragment", () => {
    expect(stepRefusal(plan, { tabId: "tab-1", url: PAGE })).toBeNull();
    expect(stepRefusal(plan, { tabId: "tab-1", url: `${PAGE}#top` })).toBeNull();
    expect(stepRefusal(plan, { tabId: "tab-1", url: "https://shop.example.com/cart?item=2" })).toBe(
      "moved",
    );
    expect(stepRefusal(plan, { tabId: "tab-1", url: "https://evil.example.com/cart?item=1" })).toBe(
      "moved",
    );
    expect(stepRefusal(plan, { tabId: "tab-2", url: PAGE })).toBe("moved");
    expect(stepRefusal(plan, null)).toBe("no_tab");
  });
});

describe("assistant panel", () => {
  it("is closed until asked for, then makes room and sends nothing to Core", async () => {
    const { shell, api } = await mount();
    expect(screen.queryByLabelText("What do you want done on this page?")).toBeNull();
    await open();
    expect(goal()).toBeTruthy();
    expect(shell.chromeHeights.at(-1)).toBe(BROWSER_CHROME_ASSIST_HEIGHT);
    expect(api.calls.filter((c) => c.path.includes("/api/browser/assist"))).toHaveLength(0);
  });

  it("shows a visible reason and sends nothing for a goal with hidden characters or too long", async () => {
    const { api } = await mount();
    await open();
    for (const [value, text] of [
      ["go\u0001", "The goal cannot contain control characters."],
      ["go\u202e", "The goal cannot contain text-direction or zero-width characters."],
      ["a".repeat(ASSIST_MAX_GOAL + 1), "The goal can be at most 500 characters."],
    ] as const) {
      fireEvent.change(goal(), { target: { value } });
      await flush();
      expect(screen.getByRole("alert").textContent).toBe(text);
      expect((proposeButton() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(goal().closest("form")!);
      await flush();
    }
    expect(api.calls.filter((c) => c.path === "/api/browser/assist")).toHaveLength(0);
  });

  it("proposes with the session token and lists the steps as inert, labelled text", async () => {
    const hostile = {
      ...OK_PLAN,
      plan: {
        ...OK_PLAN.plan,
        actions: [
          {
            kind: "type",
            selector: "input#qty",
            text: "<img src=x onerror=alert(1)>\u202e2",
            model_written: true,
          },
        ],
      },
    };
    const { api, headers } = await mount(hostile);
    await open();
    await propose("  add two to the cart  ");
    const call = api.calls.find((c) => c.path === "/api/browser/assist")!;
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ goal: "add two to the cart" });
    expect(headers).toEqual(["Bearer tok"]);

    const panel = document.querySelector(".browser-assist") as HTMLElement;
    expect(
      within(panel).getByText(/Proposed by a local model that read this page\. Nothing has run\./),
    ).toBeTruthy();
    // The model's text is text: no element came out of it, and the bidi mark is not passed through.
    expect(panel.querySelector("img, a, script, [onerror]")).toBeNull();
    expect(panel.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(panel.textContent).not.toContain("\u202e");
    expect(panel.textContent).toContain("input#qty");
    expect(panel.textContent).toContain("(written by the local model, not by you)");
    expect(panel.textContent).toContain("1 model suggestion was refused");
    // Proposing alone runs nothing.
    expect(commandPosts(api)).toHaveLength(0);
  });

  it.each([
    [
      "no_local_model",
      "No on-device model is available, so Fawkes did not read this page. Page text is never sent to a cloud service.",
    ],
    [
      "local_model_failed",
      "The on-device model failed. Nothing was run and nothing was sent anywhere else.",
    ],
    ["no_browser", "This Phoenix app has no browser to read a page from."],
  ])("shows a fixed message for %s and not the server's detail", async (status, text) => {
    await mount({ status, detail: "SERVER <b>DETAIL</b>" });
    await open();
    await propose();
    expect(screen.getByRole("alert").textContent).toBe(text);
    expect(document.body.textContent).not.toContain("SERVER");
    expect(screen.queryByRole("button", { name: "Run this step" })).toBeNull();
  });

  it("shows a fixed message when the route fails or answers nonsense", async () => {
    await mount({ status: "ok", plan: { page_url: PAGE, actions: "run everything" } });
    await open();
    await propose();
    expect(screen.getByRole("alert").textContent).toBe(
      "The assistant could not be reached. Nothing was run.",
    );
    cleanup();
    await mount(OK_PLAN, { assistStatus: 500 });
    await open();
    await propose();
    expect(screen.getByRole("alert").textContent).toBe(
      "The assistant could not be reached. Nothing was run.",
    );
    expect(document.body.textContent).not.toContain("boom");
  });

  it("shows a readable try-again message, not the failure text, when Core answers 429 busy", async () => {
    await mount(OK_PLAN, { assistStatus: 429 });
    await open();
    await propose();
    expect(screen.getByRole("alert").textContent).toBe(
      "The assistant is still working on another request. Wait a moment and try again. Nothing was run.",
    );
    expect(document.body.textContent).not.toContain("boom");
    expect(document.body.textContent).not.toContain("could not be reached");
    expect((proposeButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("runs exactly the chosen step through the browser command path and never the next one", async () => {
    const { api } = await mount();
    await open();
    await propose();
    expect(runButtons()).toHaveLength(3);

    fireEvent.click(runButtons()[0]!);
    await flush();
    expect(commandPosts(api).map((c) => [c.path, c.body])).toEqual([
      [
        "/api/capabilities/browser/commands/type",
        { input: { pageUrl: PAGE, selector: "input#qty", text: "2" } },
      ],
    ]);
    expect(screen.getByText("Done. Nothing else was run.")).toBeTruthy();
    // Time passes and nothing advances.
    await flush();
    expect(commandPosts(api)).toHaveLength(1);

    fireEvent.click(runButtons()[1]!);
    await flush();
    expect(commandPosts(api).map((c) => c.path)).toEqual([
      "/api/capabilities/browser/commands/type",
      "/api/capabilities/browser/commands/click",
    ]);
    expect(commandPosts(api)[1]!.body).toEqual({
      input: { pageUrl: PAGE, selector: "button#add" },
    });
    expect(commandPosts(api)).toHaveLength(2);
  });

  it("allows one step at a time while an approval is pending", async () => {
    const { api, operations } = await mount();
    operations["op-1"] = { status: "waiting" };
    await open();
    await propose();
    fireEvent.click(runButtons()[0]!);
    await flush();
    expect(screen.getByText("Waiting for your approval…")).toBeTruthy();
    for (const b of runButtons()) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(runButtons()[1]!);
    await flush();
    expect(commandPosts(api)).toHaveLength(1);
    expect((proposeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows that a declined step was declined and does not run the rest", async () => {
    const { api, operations } = await mount();
    operations["op-1"] = {
      status: "failed",
      error: { code: "PERMISSION_DENIED", message: "SERVER TEXT" },
    };
    await open();
    await propose();
    fireEvent.click(runButtons()[0]!);
    await flush();
    expect(screen.getByText("You declined this step.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("SERVER TEXT");
    expect(commandPosts(api)).toHaveLength(1);
  });

  it("refuses a step, with a visible reason and no command, when the tab moved to another page", async () => {
    const { shell, api } = await mount();
    await open();
    await propose();
    act(() => shell.emitTab({ tabId: "tab-1", url: "https://evil.example.com/cart?item=1" }));
    await flush();
    fireEvent.click(runButtons()[0]!);
    await flush();
    expect(
      screen.getByText(
        "The tab is no longer on the page these steps were proposed for. Ask again.",
      ),
    ).toBeTruthy();
    expect(commandPosts(api)).toHaveLength(0);
  });

  it("refuses a step after a switch to another tab on the same address", async () => {
    const { shell, api } = await mount();
    await open();
    await propose();
    fireEvent.click(screen.getByLabelText("New tab"));
    await flush();
    await visit(PAGE);
    expect(shell.tabs).toHaveLength(2);
    fireEvent.click(runButtons()[0]!);
    await flush();
    expect(screen.getByText(/no longer on the page these steps were proposed for/)).toBeTruthy();
    expect(commandPosts(api)).toHaveLength(0);
  });
});
