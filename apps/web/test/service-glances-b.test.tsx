// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalComGlance, NotionGlance, ResendGlance } from "../src/components/ServiceGlancesB";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  parseCalGlance,
  parseNotionGlance,
  parseResendGlance,
} from "../src/core/service-glances-b";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability, expectInert, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Routes = NonNullable<Parameters<typeof fakeApi>[0]>;
type Status = "enabled" | "installed";

/** What the capability's `status` command returns: `ServiceStatus` from sdk/service-kit. */
const resendItem = (state: string, over: Record<string, unknown> = {}) => ({
  id: `em_${Math.random().toString(36).slice(2, 10)}`,
  title: "Your invoice for October",
  state,
  detail: "2 recipients: customer.example, other.example",
  url: "https://resend.com/emails/abc",
  at: "2026-10-24T09:00:00.000Z",
  ...over,
});

/** `status` for one capability: POST starts `op-<id>`, GET returns the current result. */
function statusRoutes(id: string, result: () => unknown, status: Status = "enabled"): Routes {
  return {
    "GET /api/capabilities": () => ({ capabilities: [capability(id, status)] }),
    [`POST /api/capabilities/${id}/commands/status`]: () => ({ id: `op-${id}` }),
    [`GET /api/operations/op-${id}`]: () => ({ status: "succeeded", result: result() }),
  };
}

function mount(routes: Routes, ui: React.ReactElement) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(<CoreProvider client={client}>{ui}</CoreProvider>);
  act(() => FakeWebSocket.last.open());
  return { api, ws: FakeWebSocket.last, container: view.container };
}

const section = async (name: string) =>
  (await screen.findByRole("heading", { name: `${name} at a glance` })).closest("section")!;

/** Every request the glance made: only the capability's read command, never anything else. */
function expectOnlyStatusCommands(api: FakeApi) {
  const posts = api.calls.filter((c) => c.method === "POST");
  for (const p of posts) expect(p.path).toMatch(/^\/api\/capabilities\/[a-z]+\/commands\/status$/);
  const commands = api.calls.filter((c) => c.path.includes("/commands/"));
  expect(commands.every((c) => c.path.endsWith("/commands/status"))).toBe(true);
}

describe("Resend glance", () => {
  it("shows delivery counts and the newest time, and nothing about subjects or recipients", async () => {
    const { api } = mount(
      statusRoutes("resend", () => ({
        configured: true,
        items: [
          resendItem("delivered", { title: "Secret subject A" }),
          resendItem("opened"),
          resendItem("bounced", { title: "Secret subject B" }),
          resendItem("sent"),
          resendItem("delivery_delayed"),
          resendItem("complained"),
          resendItem("failed"),
          resendItem("weird_state"),
          resendItem("delivered", { at: "2026-10-24T11:30:00.000Z" }),
          // Hostile extra fields a misbehaving Core could send.
          { ...resendItem("delivered"), to: ["jane.doe@customer.example"], subject: "Leaked" },
        ],
      })),
      <ResendGlance />,
    );
    const sec = await section("Resend");
    expect(await within(sec).findByText("10 recent emails")).toBeTruthy();
    const row = (label: string) =>
      within(sec)
        .getByText(new RegExp(`^${label}:`))
        .closest("li")!;
    expect(row("Delivered").textContent).toBe("Delivered: 4");
    expect(row("On the way").textContent).toBe("On the way: 1");
    expect(row("Delayed").textContent).toBe("Delayed: 1");
    expect(row("Bounced").textContent).toBe("Bounced: 1");
    expect(row("Marked as spam").textContent).toBe("Marked as spam: 1");
    expect(row("Failed").textContent).toBe("Failed: 1");
    expect(row("Other").textContent).toBe("Other: 1");
    expect(within(sec).getByText(/^Newest:/)).toBeTruthy();
    const text = sec.textContent ?? "";
    for (const leaked of [
      "Secret subject",
      "Your invoice",
      "Leaked",
      "customer.example",
      "other.example",
      "jane.doe",
      "2 recipients",
      "resend.com",
    ]) {
      expect(text, leaked).not.toContain(leaked);
    }
    expect(sec.querySelector("a")).toBeNull();
    expectOnlyStatusCommands(api);
  });

  it("hides states with a zero count and shows the empty message for no emails", async () => {
    mount(
      statusRoutes("resend", () => ({ configured: true, items: [] })),
      <ResendGlance />,
    );
    const sec = await section("Resend");
    expect(await within(sec).findByText("No recently sent emails to count.")).toBeTruthy();
    expect(within(sec).queryByText(/^Delivered:/)).toBeNull();
  });

  it("says the key is missing when not configured", async () => {
    mount(
      statusRoutes("resend", () => ({
        configured: false,
        items: [],
        note: "Add a Resend API key in the capability's secrets",
      })),
      <ResendGlance />,
    );
    const sec = await section("Resend");
    expect(await within(sec).findByText(/Add a Resend API key/)).toBeTruthy();
  });
});

describe("Notion glance", () => {
  const page = (over: Record<string, unknown> = {}) => ({
    id: "11111111-2222-3333-4444-555555555555",
    title: "Roadmap",
    state: "page",
    url: "https://www.notion.so/Roadmap-111122223333",
    at: "2026-10-24T08:00:00.000Z",
    ...over,
  });

  it("lists titles, kinds and edit times as text, newest edit first, with a safe Notion link", async () => {
    const { api } = mount(
      statusRoutes("notion", () => ({
        configured: true,
        items: [
          page({ id: "a", title: "Old notes", at: "2026-10-01T08:00:00.000Z", url: undefined }),
          page({ id: "b", title: "Tasks", state: "database", at: "2026-10-24T10:00:00.000Z" }),
          page({ id: "c", title: "Gone", state: "archived", url: "https://evil.example/x" }),
          page({ id: "d", title: "", url: "javascript:alert(1)" }),
        ],
        note: "page 99 was not found: share it with the integration",
      })),
      <NotionGlance />,
    );
    const sec = await section("Notion");
    expect(await within(sec).findByText("4 watched items")).toBeTruthy();
    const items = within(sec).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("strong")!.textContent)).toEqual([
      "Tasks",
      "Gone",
      "Untitled",
      "Old notes",
    ]);
    expect(items[0]!.textContent).toContain("Database");
    expect(items[1]!.textContent).toContain("Archived");
    // Only a Notion address becomes a link, opened without the opener.
    const links = sec.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("https://www.notion.so/Roadmap-111122223333");
    expect(links[0]!.getAttribute("rel")).toContain("noopener");
    expect(links[0]!.getAttribute("aria-label")).toBe("Open Tasks in Notion");
    expect(sec.textContent).not.toContain("evil.example");
    expect(sec.textContent).not.toContain("javascript:");
    expectOnlyStatusCommands(api);
  });

  it("renders a hostile title as inert text, cleaned and truncated", async () => {
    const long = "x".repeat(500);
    const { container } = mount(
      statusRoutes("notion", () => ({
        configured: true,
        items: [
          page({ id: "a", title: XSS }),
          page({ id: "b", title: `Line\u0000one\n\ntwo\u202eevil\u2066`, state: "page" }),
          page({ id: "c", title: long }),
        ],
      })),
      <NotionGlance />,
    );
    await section("Notion");
    await screen.findByText("Line one two evil");
    expectInert(container);
    const titles = [...container.querySelectorAll("li strong")].map((s) => s.textContent!);
    expect(titles.some((x) => x.includes("\u202e") || x.includes("\u0000"))).toBe(false);
    const clipped = titles.find((x) => x.startsWith("xxx"))!;
    expect(Array.from(clipped)).toHaveLength(80);
    expect(clipped.endsWith("…")).toBe(true);
  });

  it("shows the empty message when nothing is watched", async () => {
    mount(
      statusRoutes("notion", () => ({ configured: true, items: [] })),
      <NotionGlance />,
    );
    const sec = await section("Notion");
    expect(await within(sec).findByText(/No watched pages or databases/)).toBeTruthy();
  });

  it("never shows page content fields even if present in the output", async () => {
    mount(
      statusRoutes("notion", () => ({
        configured: true,
        items: [
          {
            ...page(),
            content: "BODY TEXT OF THE PAGE",
            detail: "paragraph one",
            properties: { Secret: "prop value" },
          },
        ],
      })),
      <NotionGlance />,
    );
    const sec = await section("Notion");
    await within(sec).findByText("Roadmap");
    const text = sec.textContent ?? "";
    for (const leaked of ["BODY TEXT", "paragraph one", "prop value"]) {
      expect(text, leaked).not.toContain(leaked);
    }
  });
});

describe("Cal.com glance", () => {
  const booking = (over: Record<string, unknown> = {}) => ({
    id: "bk1",
    title: "30 min between Alex Doe and Sam Roe",
    state: "accepted",
    detail: "2 attendees",
    url: "https://app.cal.com/booking/bk1",
    at: "2026-10-25T14:30:00.000Z",
    ...over,
  });

  it("lists upcoming bookings soonest first with status and attendee counts only", async () => {
    const { api } = mount(
      statusRoutes("calcom", () => ({
        configured: true,
        items: [
          booking({
            id: "late",
            at: "2026-10-30T09:00:00.000Z",
            state: "pending",
            detail: "1 attendee",
          }),
          booking({ id: "soon", at: "2026-10-25T09:00:00.000Z" }),
          booking({ id: "gone", state: "cancelled" }),
          // Hostile extra fields a misbehaving Core could send.
          {
            ...booking({ id: "x", at: "2026-10-27T09:00:00.000Z", detail: undefined }),
            attendees: [{ name: "Jane Doe", email: "jane.doe@customer.example" }],
          },
        ],
      })),
      <CalComGlance />,
    );
    const sec = await section("Cal.com");
    expect(await within(sec).findByText("3 upcoming bookings")).toBeTruthy();
    const items = within(sec).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("Confirmed · 2 attendees");
    expect(items[1]!.textContent).toContain("Confirmed");
    expect(items[1]!.textContent).not.toContain("attendee");
    expect(items[2]!.textContent).toContain("Waiting for confirmation · 1 attendee");
    const text = sec.textContent ?? "";
    for (const leaked of [
      "Alex",
      "Sam Roe",
      "between",
      "Jane",
      "customer.example",
      "cal.com/booking",
    ]) {
      expect(text, leaked).not.toContain(leaked);
    }
    expect(sec.querySelector("a")).toBeNull();
    expectOnlyStatusCommands(api);
  });

  it("caps the list and counts the rest", async () => {
    mount(
      statusRoutes("calcom", () => ({
        configured: true,
        items: Array.from({ length: 8 }, (_, i) =>
          booking({ id: `b${i}`, at: `2026-10-2${5 + (i % 4)}T0${i}:00:00.000Z` }),
        ),
      })),
      <CalComGlance />,
    );
    const sec = await section("Cal.com");
    expect(await within(sec).findByText("8 upcoming bookings")).toBeTruthy();
    expect(within(sec).getAllByRole("listitem")).toHaveLength(5);
    expect(within(sec).getByText("3 more bookings")).toBeTruthy();
  });

  it("shows the empty message when every booking is cancelled", async () => {
    mount(
      statusRoutes("calcom", () => ({
        configured: true,
        items: [booking({ state: "cancelled" })],
      })),
      <CalComGlance />,
    );
    const sec = await section("Cal.com");
    expect(await within(sec).findByText("No upcoming bookings.")).toBeTruthy();
  });
});

describe("the shared states, for each of the three", () => {
  const cases = [
    {
      id: "resend",
      name: "Resend",
      ui: <ResendGlance />,
      ok: { configured: true, items: [resendItem("delivered")] },
    },
    {
      id: "notion",
      name: "Notion",
      ui: <NotionGlance />,
      ok: { configured: true, items: [{ id: "n1", title: "Roadmap", state: "page" }] },
    },
    {
      id: "calcom",
      name: "Cal.com",
      ui: <CalComGlance />,
      ok: {
        configured: true,
        items: [{ id: "b1", title: "t", state: "accepted", at: "2026-10-25T09:00:00Z" }],
      },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: absent when not installed and calls nothing`, async () => {
      const { api } = mount({ "GET /api/capabilities": () => ({ capabilities: [] }) }, c.ui);
      await waitFor(() => expect(api.calls.some((x) => x.path === "/api/capabilities")).toBe(true));
      expect(screen.queryByRole("heading")).toBeNull();
      expect(api.calls.some((x) => x.path.includes("/commands/"))).toBe(false);
    });

    it(`${c.name}: prompts to enable when installed but off, and calls nothing`, async () => {
      const { api } = mount(
        statusRoutes(c.id, () => c.ok, "installed"),
        c.ui,
      );
      const sec = await section(c.name);
      expect(within(sec).getByText(/turned off|not enabled|Enable/i)).toBeTruthy();
      expect(api.calls.some((x) => x.path.includes("/commands/"))).toBe(false);
    });

    it(`${c.name}: shows loading while the command runs`, async () => {
      const routes = statusRoutes(c.id, () => c.ok);
      routes[`GET /api/operations/op-${c.id}`] = () => ({ status: "running" });
      mount(routes, c.ui);
      const sec = await section(c.name);
      expect(within(sec).getByRole("status").textContent).toBe("Loading…");
    });

    it(`${c.name}: shows an error from a failed command`, async () => {
      const routes = statusRoutes(c.id, () => c.ok);
      routes[`GET /api/operations/op-${c.id}`] = () => ({
        status: "failed",
        error: { message: "Service said no" },
      });
      mount(routes, c.ui);
      const sec = await section(c.name);
      expect((await within(sec).findByRole("alert")).textContent).toContain("Service said no");
    });

    it(`${c.name}: an unexpected result shape is reported, not rendered`, async () => {
      mount(
        statusRoutes(c.id, () => ({ configured: "yes", items: "nope" })),
        c.ui,
      );
      const sec = await section(c.name);
      expect(await within(sec).findByRole("alert")).toBeTruthy();
    });

    it(`${c.name}: keeps the last data and says it is stale when a refresh fails`, async () => {
      let fail = false;
      const routes = statusRoutes(c.id, () => c.ok);
      routes[`GET /api/operations/op-${c.id}`] = () =>
        fail
          ? { status: "failed", error: { message: "offline" } }
          : { status: "succeeded", result: c.ok };
      const { ws } = mount(routes, c.ui);
      const sec = await section(c.name);
      await waitFor(() => expect(within(sec).getByText(/^Updated /)).toBeTruthy());
      fail = true;
      sendEvent(
        ws,
        1,
        `${c.id}.${c.id === "resend" ? "email" : c.id === "calcom" ? "booking" : "page"}.updated`,
      );
      expect((await within(sec).findByRole("alert")).textContent).toContain("offline");
      // The earlier numbers are still on screen.
      expect(within(sec).getByText(/^Updated /)).toBeTruthy();
    });
  }
});

describe("refresh", () => {
  const setVisibility = (state: "visible" | "hidden") =>
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);

  it("re-reads on a bounded interval only while the page is visible", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const hidden = setVisibility("hidden");
    const { api } = mount(
      statusRoutes("calcom", () => ({ configured: true, items: [] })),
      <CalComGlance />,
    );
    const reads = () => api.calls.filter((c) => c.path.endsWith("/commands/status")).length;
    await waitFor(() => expect(reads()).toBe(1));

    // Hidden: the interval fires but nothing is read.
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(reads()).toBe(1);

    hidden.mockReturnValue("visible");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await waitFor(() => expect(reads()).toBe(2));
    // Never faster than one read per minute.
    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    expect(reads()).toBe(2);
    expectOnlyStatusCommands(api);
  });

  it("stops its timer when it goes away", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    mount(
      statusRoutes("resend", () => ({ configured: true, items: [] })),
      <ResendGlance />,
    );
    await screen.findByRole("heading", { name: "Resend at a glance" });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the parsers", () => {
  it("reject a result that is not a status", () => {
    for (const bad of [null, 3, "x", {}, { configured: true }, { configured: 1, items: [] }]) {
      expect(parseResendGlance(bad)).toBeNull();
      expect(parseNotionGlance(bad)).toBeNull();
      expect(parseCalGlance(bad)).toBeNull();
    }
  });

  it("bound the number of items they read", () => {
    const items = Array.from({ length: 1000 }, () => resendItem("delivered"));
    expect(parseResendGlance({ configured: true, items })!.total).toBeLessThanOrEqual(25);
  });

  it("copy no subject, recipient or booking title out of the result", () => {
    const resend = parseResendGlance({ configured: true, items: [resendItem("delivered")] })!;
    expect(JSON.stringify(resend)).not.toMatch(/invoice|customer|recipient|resend\.com/);
    const cal = parseCalGlance({
      configured: true,
      items: [{ id: "b", title: "Call with Jane", state: "accepted", at: "2026-10-25T09:00:00Z" }],
    })!;
    expect(JSON.stringify(cal)).not.toMatch(/Jane|Call/);
  });
});
