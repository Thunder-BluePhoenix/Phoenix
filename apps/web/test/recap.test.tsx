// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recap } from "../src/core/recap";
import { formatCodingTime, formatDayKey, gridLevel, isEmptyWeek } from "../src/core/recap";
import { downloadRecapPng } from "../src/core/recap-image";
import { FakeWebSocket } from "./fake-ws";
import { openAt, XSS } from "./views-harness";
import { fakeApi } from "./fake-api";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { RecapPage } from "../src/components/Recap";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const DAYS = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
];

function recap(over: Partial<Recap> = {}): Recap {
  return {
    week: { start: "2026-10-26", end: "2026-11-01", days: DAYS, time_zone: "UTC", current: false },
    coding: {
      seconds: 5400,
      sessions: 3,
      steps: 13,
      files: 2,
      lines_added: 18,
      lines_removed: 3,
      lines_changed: 21,
      commands: 3,
      longest_session_seconds: 1200,
    },
    permissions: { granted: 3, denied: 4 },
    top_agent: { name: "claude-code", steps: 10 },
    top_project: { name: "alpha", steps: 10 },
    busiest_day: { day: "2026-11-01", steps: 6, seconds: 1200 },
    days: DAYS.map((day) => ({ day, steps: 0, seconds: 0, commits: 0 })),
    commits: 4,
    ci: { passed: 2, failed: 1 },
    meetings: { count: 2, decisions: 2 },
    meetings_allowed: true,
    grid: {
      weeks: [{ start: "2026-10-26", days: DAYS.map((day, i) => ({ day, count: i })) }],
      max: 6,
      total: 21,
      source: "local-git-events",
    },
    ...over,
  };
}

const stat = (label: string) => screen.getByText(label, { selector: "dt" }).closest("div")!;

describe("recap page", () => {
  it("shows the week's numbers from Core", async () => {
    openAt("#/recap", { "GET /api/recap": () => recap() });
    const time = await screen.findByText("Time coding", { selector: "dt" });
    expect(within(time.closest("div")!).getByText("1 h 30 min")).toBeTruthy();
    expect(within(stat("Lines changed")).getByText("21")).toBeTruthy();
    expect(within(stat("Permissions granted")).getByText("3")).toBeTruthy();
    expect(within(stat("Permissions denied")).getByText("4")).toBeTruthy();
    expect(within(stat("Top agent")).getByText("claude-code")).toBeTruthy();
    expect(within(stat("Busiest day")).getByText("Sun 1 Nov")).toBeTruthy();
    expect(within(stat("CI passed / failed")).getByText("2 / 1")).toBeTruthy();
    expect(within(stat("Meetings / decisions")).getByText("2 / 2")).toBeTruthy();
    expect(screen.getByText("Mon 26 Oct – Sun 1 Nov")).toBeTruthy();
  });

  it("says so when the week is empty and when meeting data is off", async () => {
    openAt("#/recap", {
      "GET /api/recap": () =>
        recap({
          coding: { ...recap().coding, steps: 0, sessions: 0, seconds: 0 },
          permissions: { granted: 0, denied: 0 },
          commits: 0,
          ci: { passed: 0, failed: 0 },
          meetings: null,
          meetings_allowed: false,
          top_agent: null,
          top_project: null,
          busiest_day: null,
        }),
    });
    expect(await screen.findByText("Nothing was recorded this week.")).toBeTruthy();
    expect(within(stat("Meetings / decisions")).getByText("off")).toBeTruthy();
    expect(within(stat("Top agent")).getByText("none")).toBeTruthy();
    expect(
      screen.getByText(/stay out of the recap while sensitive meeting data is off/),
    ).toBeTruthy();
  });

  it("renders a hostile agent or project name as text", async () => {
    const { container } = openAt("#/recap", {
      "GET /api/recap": () => recap({ top_agent: { name: XSS, steps: 1 } }),
    });
    await screen.findByText("Time coding", { selector: "dt" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(XSS);
  });

  it("moves between weeks through the API; next week is disabled for the current one", async () => {
    const weeks: (string | null)[] = [];
    openAt("#/recap", {
      "GET /api/recap": (_body, url) => {
        weeks.push(url.searchParams.get("week"));
        const week = url.searchParams.get("week");
        return week === "2026-10-19"
          ? recap({
              week: {
                start: "2026-10-19",
                end: "2026-10-25",
                days: [],
                time_zone: "UTC",
                current: false,
              },
            })
          : recap({
              week: {
                start: "2026-10-26",
                end: "2026-11-01",
                days: DAYS,
                time_zone: "UTC",
                current: true,
              },
            });
      },
    });
    const next = await screen.findByRole("button", { name: "Next week" });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(await screen.findByText("Mon 19 Oct – Sun 25 Oct")).toBeTruthy();
    expect(weeks).toEqual([null, "2026-10-19"]);
  });

  it("shows a load failure instead of numbers", async () => {
    openAt("#/recap", {
      "GET /api/recap": () =>
        new Response(JSON.stringify({ code: "INTERNAL_ERROR", message: "Recap broke" }), {
          status: 500,
        }),
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Recap broke");
    expect(screen.queryByText("Time coding")).toBeNull();
  });

  it("deleting needs a second click, calls DELETE with confirm and reloads", async () => {
    let deleted = false;
    const { api } = openAt("#/recap", {
      "GET /api/recap": () =>
        deleted
          ? recap({
              coding: { ...recap().coding, steps: 0, sessions: 0 },
              permissions: { granted: 0, denied: 0 },
              commits: 0,
              ci: { passed: 0, failed: 0 },
              meetings: { count: 0, decisions: 0 },
            })
          : recap(),
      "DELETE /api/recap": () => {
        deleted = true;
        return { deleted: 9 };
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete all recap statistics…" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm: delete all recap statistics" }));
    expect(await screen.findByText("Deleted 9 recap records.")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Nothing was recorded this week.")).toBeTruthy());
    expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
      "/api/recap?confirm=true",
    ]);
  });
});

/** The page alone, with an injected image exporter (the real one needs a canvas). */
function mountPage(download: typeof downloadRecapPng) {
  const api = fakeApi({ "GET /api/recap": () => recap() });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <RecapPage download={download} />
    </CoreProvider>,
  );
}

describe("the share image controls", () => {
  it("hides the project by default and passes the choice to the image export", async () => {
    const download = vi.fn(async (..._args: Parameters<typeof downloadRecapPng>) => undefined);
    mountPage(download);
    const box = (await screen.findByRole("checkbox", {
      name: "Show the project name in the image",
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Save image/ }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]![1]).toEqual({ showProjects: false });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /Save image/ }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(download.mock.calls[1]![1]).toEqual({ showProjects: true });
    expect(await screen.findByText("Recap image saved.")).toBeTruthy();
  });

  it("reports an export failure", async () => {
    mountPage(async () => {
      throw new Error("This browser cannot draw the recap image");
    });
    fireEvent.click(await screen.findByRole("button", { name: /Save image/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot draw");
  });
});

describe("navigation", () => {
  it("has a Recap link that marks itself current", async () => {
    openAt("#/recap", { "GET /api/recap": () => recap() });
    await screen.findByText("Time coding", { selector: "dt" });
    const link = screen.getByRole("link", { name: "Recap" });
    expect([link.getAttribute("href"), link.getAttribute("aria-current")]).toEqual([
      "#/recap",
      "page",
    ]);
  });
});

describe("formatters", () => {
  it("format time at weekly precision", () => {
    expect([0, 29, 31, 3540, 3600, 11_100].map(formatCodingTime)).toEqual([
      "0 min",
      "0 min",
      "1 min",
      "59 min",
      "1 h 00 min",
      "3 h 05 min",
    ]);
  });
  it("format a day key without a time zone shift, Sunday last", () => {
    expect(formatDayKey("2026-11-01")).toBe("Sun 1 Nov");
    expect(formatDayKey("2026-10-26")).toBe("Mon 26 Oct");
    expect(formatDayKey("not a day")).toBe("");
  });
  it("grid levels run 0..4 and never show a commit as nothing", () => {
    expect([0, 1, 2, 3, 6].map((n) => gridLevel(n, 6))).toEqual([0, 1, 2, 2, 4]);
    expect(gridLevel(1, 1000)).toBe(1);
    expect(gridLevel(5, 0)).toBe(0);
  });
  it("treat a week with only commits as not empty", () => {
    const quiet = recap({
      coding: { ...recap().coding, steps: 0, sessions: 0 },
      permissions: { granted: 0, denied: 0 },
      ci: { passed: 0, failed: 0 },
      meetings: null,
      commits: 1,
    });
    expect(isEmptyWeek(quiet)).toBe(false);
    expect(isEmptyWeek({ ...quiet, commits: 0 })).toBe(true);
  });
});
