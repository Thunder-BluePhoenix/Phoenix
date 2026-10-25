// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 95: the approval card for a browsing-assistant action. Fake Core, happy-dom; nothing here
// touched a real page or webview.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserActionDetails, Confirmation } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { confirmation, mount, openPanel } from "./harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TYPED = "Pa55 w0rd\nsecond line";

function browserConfirmation(
  browser: BrowserActionDetails | undefined,
  patch: Partial<Confirmation> = {},
): Confirmation {
  return confirmation({
    id: "conf_b1",
    capabilityId: "browser",
    command: "act",
    summary: "Browser: act on the page",
    sideEffect: "external",
    permissions: ["browser_act"],
    ...(browser ? { details: { browser } } : {}),
    ...patch,
  });
}

async function show(c: Confirmation) {
  const { api } = mount({ "GET /api/confirmations": () => ({ confirmations: [c] }) });
  openPanel();
  const el = await screen.findByRole("listitem", { name: c.summary });
  return { api, card: within(el), el };
}

const fact = (el: HTMLElement, name: string) =>
  el.querySelector<HTMLElement>(`[data-browser-fact="${name}"]`);

describe("browser approval card", () => {
  const cases: { name: string; details: BrowserActionDetails; label: string }[] = [
    {
      name: "click",
      label: "Click a control on the page",
      details: { kind: "click", pageUrl: "example.com/form", selector: "button#go" },
    },
    {
      name: "submit",
      label: "Submit a form on the page",
      details: { kind: "submit", pageUrl: "example.com/form", selector: "form#f" },
    },
    {
      name: "download",
      label: "Start a download from the page",
      details: { kind: "download", pageUrl: "example.com/form", selector: "button#dl" },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: shows the localised action, the page and the selector`, async () => {
      const { el, card } = await show(browserConfirmation(c.details));
      expect(card.getByText(c.label)).toBeTruthy();
      expect(fact(el, "page")!.textContent).toBe("example.com/form");
      expect(fact(el, "selector")!.textContent).toBe(c.details.selector);
      expect(fact(el, "text")).toBeNull();
    });
  }

  it("type: shows the FULL 4096-character text unabridged in a pre-wrap block, plus its length", async () => {
    const text = Array.from({ length: 4096 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(
      "",
    );
    const { el, card } = await show(
      browserConfirmation({
        kind: "type",
        pageUrl: "example.com/form",
        selector: "input#q",
        text,
        textLength: 4096,
      }),
    );
    expect(card.getByText("Type text into a field on the page")).toBeTruthy();
    const block = fact(el, "text")!.querySelector("pre")!;
    expect(block.textContent).toBe(text);
    expect(block.textContent).toHaveLength(4096);
    expect(block.className).toBe("browser-typed-text");
    expect(fact(el, "textLength")!.textContent).toBe("4096 characters");
    expect(card.getByText("Text that will be typed (shown in full)")).toBeTruthy();
    expect(fact(el, "selector")!.textContent).toBe("input#q");
  });

  it("type: newline escapes and text stay literal text, never markup", async () => {
    const text = '<img src=x onerror="alert(1)"> \\n \\u{200B}';
    const { el } = await show(
      browserConfirmation({
        kind: "type",
        pageUrl: "example.com/",
        selector: "input#q",
        text,
        textLength: 40,
      }),
    );
    expect(fact(el, "text")!.querySelector("pre")!.textContent).toBe(text);
    expect(el.querySelector("img")).toBeNull();
  });

  it("navigate: shows the destination host+path and says the query is not shown", async () => {
    const { el, card } = await show(
      browserConfirmation({
        kind: "navigate",
        pageUrl: "example.com/form",
        destination: "example.org/next",
        queryHidden: true,
      }),
    );
    expect(card.getByText("Go to another address")).toBeTruthy();
    expect(fact(el, "destination")!.textContent).toContain("example.org/next");
    expect(card.getByText("The address also has a query part, which is not shown.")).toBeTruthy();
    expect(fact(el, "selector")).toBeNull();
  });

  it("navigate without queryHidden has no query note", async () => {
    const { card } = await show(
      browserConfirmation({
        kind: "navigate",
        pageUrl: "example.com/form",
        destination: "example.org/next",
      }),
    );
    expect(card.queryByText(/query part/)).toBeNull();
  });

  it("never shows a query, fragment or credentials, even if Core sent one", async () => {
    const { el } = await show(
      browserConfirmation({
        kind: "navigate",
        pageUrl: "https://user:pw@example.com/form?token=SECRETQ#frag",
        destination: "https://example.org/next?session=SECRETQ2",
      }),
    );
    const html = el.innerHTML;
    expect(html).not.toContain("SECRETQ");
    expect(html).not.toContain("user:pw");
    expect(html).not.toContain("frag");
    expect(fact(el, "page")!.textContent).toBe("https://example.com/form");
    expect(fact(el, "destination")!.textContent).toContain("https://example.org/next");
    expect(el.textContent).toContain("which is not shown");
  });

  it("says plainly when a fact is missing (selector on a click, page, text, length)", async () => {
    const { card } = await show(
      browserConfirmation({ kind: "click", pageUrl: "" } as BrowserActionDetails),
    );
    expect(card.getByText("The request does not name a control.")).toBeTruthy();
    expect(card.getByText("The request does not name the page.")).toBeTruthy();
    cleanup();
    const typed = await show(
      browserConfirmation({ kind: "type", pageUrl: "example.com/", selector: "input#q" }),
    );
    expect(typed.card.getByText("The request does not include the text.")).toBeTruthy();
    expect(typed.card.getByText("The text length is missing.")).toBeTruthy();
  });

  it("a browser-capability confirmation without details.browser says the action is unknown", async () => {
    const { card } = await show(browserConfirmation(undefined));
    expect(card.getByText("The request does not say what kind of action this is.")).toBeTruthy();
    expect(card.getByText("The request does not name the page.")).toBeTruthy();
  });

  it("an unknown kind is flagged as missing rather than shown raw", async () => {
    const { card, el } = await show(
      browserConfirmation({
        kind: "eval" as BrowserActionDetails["kind"],
        pageUrl: "example.com/",
        selector: "button#x",
      }),
    );
    expect(card.getByText("The request does not say what kind of action this is.")).toBeTruthy();
    expect(fact(el, "kind")!.textContent).not.toContain("eval");
  });

  it("other capabilities show no browser rows", async () => {
    const { el } = await show(confirmation({ summary: "Mock: write a note" }));
    expect(fact(el, "kind")).toBeNull();
  });

  it("typed text is not in any aria-label, title, live region, console call or storage, before or after deciding", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const c = browserConfirmation({
      kind: "type",
      pageUrl: "example.com/form",
      selector: "input#q",
      text: TYPED,
      textLength: TYPED.length,
    });
    const { el } = await show(c);
    const attrs = () =>
      Array.from(document.body.querySelectorAll("*")).flatMap((n) =>
        Array.from(n.attributes).map((a) => a.value),
      );
    expect(attrs().some((v) => v.includes("Pa55"))).toBe(false);
    expect(fact(el, "text")!.textContent).toContain("Pa55 w0rd");
    fireEvent.click(within(el).getByRole("button", { name: /^Approve/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/approved/i));
    const live = screen.getByRole("status");
    expect(live.textContent).not.toContain("Pa55");
    expect(attrs().some((v) => v.includes("Pa55"))).toBe(false);
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain("Pa55");
    expect(JSON.stringify({ ...localStorage })).not.toContain("Pa55");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("Pa55");
  });

  it("keeps the existing behaviour: the high-risk 'understand' step still gates Approve", async () => {
    const { el } = await show(
      browserConfirmation(
        { kind: "click", pageUrl: "example.com/", selector: "button#go" },
        { risk: "high" },
      ),
    );
    const approve = within(el).getByRole("button", { name: /^Approve/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(within(el).getByRole("checkbox"));
    expect(approve.disabled).toBe(false);
  });
});
