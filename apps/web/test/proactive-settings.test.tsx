// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProactiveInsight, ProactiveStatus } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { doubleClick, expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const initial: ProactiveStatus = {
  preferences: {
    enabled: false,
    capabilities: [],
    quietHours: null,
    maxPerHour: 3,
    cadenceMinutes: null,
  },
  source: { capability_id: "kage", available: true, mode: "manual" },
  noise: { delivered: 0, dismissed: 0, suppressed: 0, dismissalRate: 0 },
};
const insight: ProactiveInsight = {
  id: "insight-1",
  kind: "unassigned_action",
  capabilityId: "kage",
  title: "Review meeting action",
  body: "Accepted unassigned item",
  evidenceIds: ["item-1"],
  subjectId: "item-1",
  evidence: { meeting_id: "meeting-1", item_id: "item-1", source: "summary", quote: XSS },
};

function open(overrides: Partial<ProactiveStatus> = {}) {
  let current: ProactiveStatus = { ...initial, ...overrides };
  let dismissals = 0;
  const view = openAt("#/settings", {
    "GET /api/proactive": () => current,
    "POST /api/proactive/preferences": (body) => {
      current = { ...current, preferences: { ...current.preferences, ...(body as object) } };
      return current;
    },
    "GET /api/proactive/preview": () => ({ insights: [insight] }),
    "POST /api/proactive/evaluate": () => ({
      delivered: [{ insight_id: insight.id, notification: { title: insight.title } }],
      suppressed: 0,
    }),
    "POST /api/proactive/dismiss": () => {
      dismissals++;
      return { dismissed: insight.id };
    },
    "GET /api/proactive/noise": () => ({ ...current.noise, dismissed: dismissals }),
  });
  return view;
}

const section = async () =>
  within(
    (await screen.findByRole("heading", { name: "Proactive suggestions" })).closest("section")!,
  );

describe("manual proactive suggestions settings", () => {
  it("loads status only, stays off until global and source opt-in, then previews grounded evidence", async () => {
    const { api, container } = open();
    const s = await section();
    await s.findByText(/Kage source: available/);
    expect(api.calls.filter((call) => call.path.startsWith("/api/proactive"))).toEqual([
      { method: "GET", path: "/api/proactive", body: undefined },
    ]);
    expect((s.getByRole("button", { name: "Evaluate now" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(s.getByText(/advisory provider is unavailable/)).toBeTruthy();
    fireEvent.click(s.getByRole("checkbox", { name: "Enable proactive suggestions" }));
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(1));
    expect(api.posts("/api/proactive/preferences")[0]?.body).toEqual({ enabled: true });
    expect((s.getByRole("button", { name: "Evaluate now" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await waitFor(() =>
      expect(
        (s.getByRole("checkbox", { name: /Kage accepted/ }) as HTMLInputElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(s.getByRole("checkbox", { name: /Kage accepted/ }));
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(2));
    expect(api.posts("/api/proactive/preferences")[1]?.body).toEqual({ capabilities: ["kage"] });
    expect(api.posts("/api/proactive/evaluate")).toHaveLength(0);
    await waitFor(() =>
      expect(
        (s.getByRole("button", { name: "Preview suggestions" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(s.getByRole("button", { name: "Preview suggestions" }));
    expect(await s.findByText(/Evidence: meeting meeting-1, item item-1/)).toBeTruthy();
    expectInert(container);
    expect(api.calls.filter((call) => call.path === "/api/proactive/preview")).toHaveLength(1);
    expect(api.posts("/api/proactive/evaluate")).toHaveLength(0);
    expect(s.queryByRole("button", { name: "Dismiss Review meeting action" })).toBeNull();
    await waitFor(() =>
      expect((s.getByRole("button", { name: "Evaluate now" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(s.getByRole("button", { name: "Evaluate now" }));
    await s.findByText("1 delivered; 0 suppressed.");
    fireEvent.click(s.getByRole("button", { name: "Dismiss Review meeting action" }));
    await waitFor(() =>
      expect(api.posts("/api/proactive/dismiss")[0]?.body).toEqual({ id: "insight-1" }),
    );
    await s.findByText("Suggestion dismissed.");
    expect(s.getByLabelText("Suggestion noise metrics").textContent).toContain("Dismissed1");
  });

  it("configures time-zone quiet hours and rate through the preferences route", async () => {
    const { api } = open();
    const s = await section();
    await s.findByText(/Kage source: available/);
    fireEvent.click(s.getByRole("checkbox", { name: "Use quiet hours" }));
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(1));
    expect(api.posts("/api/proactive/preferences")[0]?.body).toMatchObject({
      quietHours: { start: "22:00", end: "08:00" },
    });
    const zone = s.getByRole("textbox", { name: "Time zone (IANA)" });
    await waitFor(() => expect((zone as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(zone, { target: { value: "America/New_York" } });
    fireEvent.blur(zone);
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(2));
    expect(api.posts("/api/proactive/preferences")[1]?.body).toEqual({
      quietHours: { timezone: "America/New_York", start: "22:00", end: "08:00" },
    });
    await waitFor(() =>
      expect((s.getByLabelText("Quiet from") as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.change(s.getByLabelText("Quiet from"), { target: { value: "21:30" } });
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(3));
    expect(api.posts("/api/proactive/preferences")[2]?.body).toMatchObject({
      quietHours: { start: "21:30" },
    });
    await waitFor(() =>
      expect(
        (s.getByRole("spinbutton", { name: "Maximum suggestions per hour" }) as HTMLInputElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.change(s.getByRole("spinbutton", { name: "Maximum suggestions per hour" }), {
      target: { value: "5" },
    });
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(4));
    expect(api.posts("/api/proactive/preferences")[3]?.body).toEqual({ maxPerHour: 5 });
  });

  it("makes evaluation explicit and single-flight under repeated clicks", async () => {
    const { api } = open({
      preferences: { ...initial.preferences, enabled: true, capabilities: ["kage"] },
    });
    let resolve!: (value: object) => void;
    api.set(
      "POST /api/proactive/evaluate",
      () =>
        new Promise<object>((done) => {
          resolve = done;
        }),
    );
    const s = await section();
    const button = await s.findByRole("button", { name: "Evaluate now" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(api.posts("/api/proactive/evaluate")).toHaveLength(0);
    doubleClick(() => fireEvent.click(button));
    expect(api.posts("/api/proactive/evaluate")).toHaveLength(1);
    resolve({ delivered: [], suppressed: 1 });
    expect(await s.findByText("0 delivered; 1 suppressed.")).toBeTruthy();
    expect(api.calls.some((call) => call.path === "/api/proactive/noise")).toBe(true);
  });

  it("marks the source unavailable without offering preview or evaluation", async () => {
    const { api } = open({ source: { capability_id: "kage", available: false, mode: "manual" } });
    const s = await section();
    await s.findByText(/Kage source: unavailable/);
    expect((s.getByRole("checkbox", { name: /Kage accepted/ }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (s.getByRole("button", { name: "Preview suggestions" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.calls.filter((call) => call.path === "/api/proactive/preview")).toHaveLength(0);
  });

  it("reports load and action failures without pretending preferences were saved", async () => {
    const { api } = open();
    api.set(
      "POST /api/proactive/preferences",
      () => new Response(JSON.stringify({ message: "Invalid timezone" }), { status: 400 }),
    );
    const s = await section();
    await s.findByText(/Kage source: available/);
    fireEvent.click(s.getByRole("checkbox", { name: "Enable proactive suggestions" }));
    expect((await s.findByRole("alert")).textContent).toBe("Invalid timezone");
    expect(
      (s.getByRole("checkbox", { name: "Enable proactive suggestions" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    cleanup();
    openAt("#/settings", {
      "GET /api/proactive": () =>
        new Response(JSON.stringify({ message: "Unavailable" }), { status: 503 }),
    });
    expect((await (await section()).findByRole("alert")).textContent).toBe("Unavailable");
  });
  it("opts in to engineering signals without erasing or enabling the Kage source", async () => {
    const { api } = open({
      preferences: { ...initial.preferences, enabled: true, capabilities: ["kage"] },
    });
    const s = await section();
    const signals = await s.findByRole("checkbox", {
      name: "Engineering signals from watched repositories",
    });
    expect((signals as HTMLInputElement).checked).toBe(false);
    fireEvent.click(signals);
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(1));
    expect(api.posts("/api/proactive/preferences")[0]?.body).toEqual({
      capabilities: ["kage", "engineering-signals"],
    });
    await s.findByText("Engineering signals are on.");
    await waitFor(() => expect((signals as HTMLInputElement).checked).toBe(true));
    fireEvent.click(s.getByRole("checkbox", { name: /Kage accepted/ }));
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(2));
    expect(api.posts("/api/proactive/preferences")[1]?.body).toEqual({
      capabilities: ["engineering-signals"],
    });
    expect(api.posts("/api/proactive/evaluate")).toHaveLength(0);
  });

  it("keeps a saved engineering-signals opt-in when Kage is turned on, and needs global enable to run", async () => {
    const { api } = open({
      preferences: { ...initial.preferences, capabilities: ["engineering-signals"] },
    });
    const s = await section();
    await s.findByText("Engineering signals are off.");
    expect(
      (s.getByRole("combobox", { name: "Automatic evaluation cadence" }) as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(s.getByRole("checkbox", { name: /Kage accepted/ }));
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(1));
    expect(api.posts("/api/proactive/preferences")[0]?.body).toEqual({
      capabilities: ["engineering-signals", "kage"],
    });
  });

  it("offers a cadence for engineering signals even when Kage is unavailable, but never previews Kage", async () => {
    const { api } = open({
      preferences: { ...initial.preferences, enabled: true, capabilities: ["engineering-signals"] },
      source: { capability_id: "kage", available: false, mode: "manual" },
    });
    const s = await section();
    await s.findByText("Engineering signals are on.");
    const cadence = s.getByRole("combobox", {
      name: "Automatic evaluation cadence",
    }) as HTMLSelectElement;
    await waitFor(() => expect(cadence.disabled).toBe(false));
    fireEvent.change(cadence, { target: { value: "60" } });
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(1));
    expect(api.posts("/api/proactive/preferences")[0]?.body).toEqual({ cadenceMinutes: 60 });
    expect(
      (s.getByRole("button", { name: "Preview suggestions" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((s.getByRole("button", { name: "Evaluate now" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("offers scheduling only after explicit opt-in and allows returning to manual mode", async () => {
    const { api } = open();
    const s = await section();
    const cadence = s.getByRole("combobox", {
      name: "Automatic evaluation cadence",
    }) as HTMLSelectElement;
    expect(cadence.disabled).toBe(true);
    expect(cadence.value).toBe("");
    fireEvent.click(s.getByRole("checkbox", { name: "Enable proactive suggestions" }));
    await waitFor(() => expect(api.posts("/api/proactive/preferences")).toHaveLength(1));
    expect(cadence.disabled).toBe(true);
    fireEvent.click(s.getByRole("checkbox", { name: /Kage accepted/ }));
    await waitFor(() => expect(cadence.disabled).toBe(false));
    expect(api.posts("/api/proactive/evaluate")).toHaveLength(0);
    fireEvent.change(cadence, { target: { value: "30" } });
    await waitFor(() =>
      expect(api.posts("/api/proactive/preferences")[2]?.body).toEqual({ cadenceMinutes: 30 }),
    );
    await waitFor(() =>
      expect(s.getByText(/Kage source:/).textContent).toContain("every 30 minutes"),
    );
    await waitFor(() => expect(cadence.disabled).toBe(false));
    fireEvent.change(cadence, { target: { value: "" } });
    await waitFor(() =>
      expect(api.posts("/api/proactive/preferences")[3]?.body).toEqual({ cadenceMinutes: null }),
    );
    expect(api.posts("/api/proactive/evaluate")).toHaveLength(0);
  });
});
