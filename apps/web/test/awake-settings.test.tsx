// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AwakeSettingsSection } from "../src/components/AwakeSettings";
import { parseAwakeLabel, type AwakeUiClock } from "../src/core/awake";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { CapabilityView } from "../src/core/types";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability, expectInert, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
});

const T0 = Date.parse("2026-10-20T09:00:00Z");
/** A clock that never moves: the countdown is not what this file is about. */
const frozen: AwakeUiClock = { now: () => T0, every: () => () => undefined };

const idle = { active: false, battery_floor_percent: 10, min_minutes: 1, max_minutes: 10080 };
const running = (over: Record<string, unknown> = {}) => ({
  active: true,
  session: {
    id: "awk_1",
    mode: "timed",
    started_at: new Date(T0).toISOString(),
    ends_at: new Date(T0 + 90 * 60_000).toISOString(),
    remaining_seconds: 5400,
    ...over,
  },
  battery_floor_percent: 15,
  min_minutes: 1,
  max_minutes: 10080,
});

type Operation = { status: string; result?: unknown; error?: { code: string; message: string } };

interface Core {
  api: FakeApi;
  /** What Core says about the operation behind the next start, extend or end. */
  operation: Operation;
  status: unknown;
  caps: CapabilityView[];
}

/** A fake Core. The test, never the UI, decides how the confirmation ends. */
function mount(
  initial: { status?: unknown; capStatus?: CapabilityView["status"] | null } = {},
): Core {
  const core: Core = {
    api: undefined as unknown as FakeApi,
    operation: { status: "succeeded", result: {} },
    status: initial.status ?? idle,
    caps: initial.capStatus === null ? [] : [capability("awake", initial.capStatus ?? "enabled")],
  };
  core.api = fakeApi({
    "GET /api/capabilities": () => ({ capabilities: core.caps }),
    "POST /api/capabilities/awake/commands/status": () => ({ id: "op-status" }),
    "POST /api/capabilities/awake/commands/start": () => ({ id: "op-act" }),
    "POST /api/capabilities/awake/commands/extend": () => ({ id: "op-act" }),
    "POST /api/capabilities/awake/commands/end": () => ({ id: "op-act" }),
    "POST /api/capabilities/awake/enable": () => {
      core.caps = [capability("awake", "enabled")];
      return {};
    },
    "GET /api/operations/*": (_body, url) =>
      url.pathname.endsWith("/op-status")
        ? { status: "succeeded", result: core.status }
        : core.operation,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: core.api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale="en">
        <AwakeSettingsSection clock={frozen} />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return core;
}

const commandBodies = (core: Core, command: string) =>
  core.api.posts(`/api/capabilities/awake/commands/${command}`).map((c) => c.body);

const typeMinutes = async (value: string) =>
  fireEvent.change(await screen.findByLabelText("Minutes"), { target: { value } });
const typeLabel = (value: string) =>
  fireEvent.change(screen.getByLabelText(/Label \(optional\)/), { target: { value } });
const clickStart = () => fireEvent.click(screen.getByRole("button", { name: "Ask to start" }));

/** Nobody but the person answers a confirmation: the UI must never call these. */
const decidedByUi = (core: Core) =>
  core.api.calls.filter((c) => c.method !== "GET" && c.path.startsWith("/api/confirmations"));

describe("Keep awake settings: status", () => {
  it("says nothing is running, the battery floor, that the lid still sleeps and that approval is needed", async () => {
    mount({ status: running() });
    expect(await screen.findByRole("timer")).toBeTruthy();
    cleanup();
    FakeWebSocket.reset();
    mount();
    expect(
      await screen.findByText("No session is running. The computer sleeps as usual."),
    ).toBeTruthy();
    expect(screen.getByText(/below 10%/)).toBeTruthy();
    expect(screen.getByText(/Closing the lid still puts the computer to sleep/)).toBeTruthy();
    expect(screen.getByText(/each ask for your approval in Approvals first/)).toBeTruthy();
  });

  it("shows a running session: mode, label, time left, end time and the battery floor", async () => {
    mount({ status: running({ label: "overnight build" }) });
    expect((await screen.findByRole("timer")).textContent).toBe("1:30:00");
    expect(screen.getByText("(timed)")).toBeTruthy();
    expect(screen.getByText("Label: overnight build")).toBeTruthy();
    expect(screen.getByText(/Ends at/)).toBeTruthy();
    expect(screen.getByText(/below 15%/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "+30 minutes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+1 hour" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask to start" })).toBeNull();
  });

  it("shows who holds an agents_grace session and offers no extend", async () => {
    mount({
      status: running({
        mode: "agents_grace",
        ends_at: null,
        remaining_seconds: null,
        agents_working: 2,
      }),
    });
    expect(await screen.findByText("2 agents working")).toBeTruthy();
    expect(screen.getByText("(while agents work)")).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("button", { name: /^\+/ })).toBeNull();
    expect(screen.getByRole("button", { name: "End session" })).toBeTruthy();
  });

  it("says so when the status cannot be read, and offers no start", async () => {
    mount({ status: { nonsense: true } });
    expect(await screen.findByText("The Keep awake status could not be read.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask to start" })).toBeNull();
  });

  it("renders nothing when the capability is not installed", async () => {
    const core = mount({ capStatus: null });
    await waitFor(() =>
      expect(core.api.calls.some((c) => c.path === "/api/capabilities")).toBe(true),
    );
    expect(screen.queryByRole("heading", { name: "Keep awake" })).toBeNull();
  });
});

describe("Keep awake settings: starting", () => {
  it("posts the exact command body, with the preset minutes and a trimmed label", async () => {
    const core = mount();
    await typeMinutes("5");
    fireEvent.click(screen.getByRole("button", { name: "2 hours" }));
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("120");
    // A preset only fills the form: asking is a separate, deliberate step.
    expect(commandBodies(core, "start")).toEqual([]);
    typeLabel("  release build  ");
    clickStart();
    await waitFor(() =>
      expect(commandBodies(core, "start")).toEqual([
        { input: { minutes: 120, reason: "release build" } },
      ]),
    );
  });

  it("offers 30 minutes, 1 hour, 2 hours and 4 hours, and a custom number of minutes", async () => {
    const core = mount();
    for (const [name, value] of [
      ["30 minutes", "30"],
      ["1 hour", "60"],
      ["2 hours", "120"],
      ["4 hours", "240"],
    ] as const) {
      fireEvent.click(await screen.findByRole("button", { name }));
      expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe(value);
    }
    await typeMinutes("45");
    clickStart();
    await waitFor(() => expect(commandBodies(core, "start")).toEqual([{ input: { minutes: 45 } }]));
  });

  it("waits while Core asks the person, then reports success; the UI never decides the confirmation", async () => {
    const core = mount();
    core.operation = { status: "pending" };
    await typeMinutes("30");
    clickStart();
    expect(await screen.findByText("Waiting for your approval in Approvals…")).toBeTruthy();
    expect(commandBodies(core, "start")).toEqual([{ input: { minutes: 30 } }]);
    // While the approval is pending nothing can be sent twice.
    expect(
      (screen.getByRole("button", { name: "Ask to start" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByText(/Approved/)).toBeNull();

    // The person approves in Approvals; Core finishes the command and says so.
    core.status = running();
    core.operation = { status: "succeeded", result: { id: "awk_1" } };
    sendEvent(FakeWebSocket.last, 1, "security.confirmation.resolved");
    expect(await screen.findByText("Approved: the session has started.")).toBeTruthy();
    expect(await screen.findByRole("timer")).toBeTruthy();
    expect(commandBodies(core, "start")).toHaveLength(1);
    expect(decidedByUi(core)).toEqual([]);
  });

  it("reports a refusal as declined, with nothing changed, and stays ready for another try", async () => {
    const core = mount();
    core.operation = {
      status: "failed",
      error: { code: "PERMISSION_DENIED", message: "Rejected by user" },
    };
    await typeMinutes("30");
    clickStart();
    const alert = await screen.findByText("You declined, so nothing was changed.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText(/Approved/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Ask to start" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(decidedByUi(core)).toEqual([]);
  });

  it("reports the emergency stop, an expired request and any other failure in their own words", async () => {
    const core = mount();
    await typeMinutes("30");
    for (const [code, message, text] of [
      ["SECURITY_POLICY_BLOCKED", "Emergency stop is engaged", /emergency stop is on/],
      ["OPERATION_TIMEOUT", "Confirmation expired", /not approved in time or was cancelled/],
      [
        "INTERNAL_ERROR",
        "Battery 4% is below the 10% floor",
        /could not do that: Battery 4% is below/,
      ],
    ] as const) {
      core.operation = { status: "failed", error: { code, message } };
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Ask to start" }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
      clickStart();
      expect((await screen.findByRole("alert")).textContent).toMatch(text);
    }
  });

  it("sends nothing for a duration Core would refuse, and says why", async () => {
    const core = mount();
    for (const bad of ["", "0", "10081", "-5", "1.5", "1e3", "abc", "5 min", "９", "9999999"]) {
      await typeMinutes(bad);
      clickStart();
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Enter a whole number of minutes from 1 to 10080.",
      );
    }
    expect(commandBodies(core, "start")).toEqual([]);
  });

  it("sends nothing for a label that is too long or hides characters, and says why", async () => {
    const core = mount();
    await typeMinutes("30");
    for (const bad of [
      "x".repeat(81),
      "a\u200Bb",
      "left\u202Eright",
      "tab\there",
      "a\u2028b",
      "ab\uFE0F",
      "a\u034Fb",
      "a\u0000b",
    ]) {
      typeLabel(bad);
      clickStart();
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(
        "The label must be 1 to 80 characters, with no control or invisible characters.",
      );
    }
    expect(commandBodies(core, "start")).toEqual([]);
    // The limit itself is fine.
    typeLabel("x".repeat(80));
    clickStart();
    await waitFor(() =>
      expect(commandBodies(core, "start")).toEqual([
        { input: { minutes: 30, reason: "x".repeat(80) } },
      ]),
    );
  });

  it("treats hostile label text as data: sent as typed, shown as text, never as markup", async () => {
    const core = mount();
    await typeMinutes("30");
    typeLabel(XSS);
    clickStart();
    await waitFor(() =>
      expect(commandBodies(core, "start")).toEqual([{ input: { minutes: 30, reason: XSS } }]),
    );
    // Core echoes it back as the session label.
    core.status = running({ label: XSS });
    sendEvent(FakeWebSocket.last, 1, "awake.session.started");
    await screen.findByText(`Label: ${XSS}`);
    const section = screen.getByRole("heading", { name: "Keep awake" }).closest("section")!;
    expectInert(section);
  });
});

describe("Keep awake settings: extending and ending", () => {
  it("extend posts the minutes and reports the approval", async () => {
    const core = mount({ status: running() });
    core.operation = { status: "pending" };
    fireEvent.click(await screen.findByRole("button", { name: "+30 minutes" }));
    expect(await screen.findByText("Waiting for your approval in Approvals…")).toBeTruthy();
    expect(commandBodies(core, "extend")).toEqual([{ input: { minutes: 30 } }]);
    core.operation = { status: "succeeded", result: {} };
    sendEvent(FakeWebSocket.last, 1, "security.confirmation.resolved");
    expect(await screen.findByText("Approved: time was added to the session.")).toBeTruthy();

    await waitFor(() =>
      expect((screen.getByRole("button", { name: "+1 hour" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "+1 hour" }));
    await waitFor(() =>
      expect(commandBodies(core, "extend")).toContainEqual({ input: { minutes: 60 } }),
    );
    expect(decidedByUi(core)).toEqual([]);
  });

  it("end posts an empty input, and a declined end leaves the session as it was", async () => {
    const core = mount({ status: running() });
    core.operation = {
      status: "failed",
      error: { code: "PERMISSION_DENIED", message: "Rejected by user" },
    };
    fireEvent.click(await screen.findByRole("button", { name: "End session" }));
    expect(await screen.findByText("You declined, so nothing was changed.")).toBeTruthy();
    expect(commandBodies(core, "end")).toEqual([{ input: {} }]);
    expect(screen.getByRole("timer")).toBeTruthy();

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "End session" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    core.operation = { status: "succeeded", result: { ended: true } };
    core.status = idle;
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(await screen.findByText("Approved: the session has ended.")).toBeTruthy();
    expect(
      await screen.findByText("No session is running. The computer sleeps as usual."),
    ).toBeTruthy();
    expect(commandBodies(core, "end")).toHaveLength(2);
    expect(decidedByUi(core)).toEqual([]);
  });
});

describe("Keep awake settings: capability off", () => {
  it("shows the existing enable path instead of failing, and starts nothing", async () => {
    const core = mount({ capStatus: "disabled" });
    expect(
      await screen.findByText(/Keep awake is turned off, so no session can start/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask to start" })).toBeNull();
    expect(core.api.calls.some((c) => c.path.endsWith("/commands/status"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Turn on Keep awake" }));
    await waitFor(() => expect(core.api.posts("/api/capabilities/awake/enable")).toHaveLength(1));
    // Once Core reports it enabled, the section follows: status read, start form shown.
    sendEvent(FakeWebSocket.last, 1, "capability.enabled");
    expect(await screen.findByRole("button", { name: "Ask to start" })).toBeTruthy();
    expect(commandBodies(core, "start")).toEqual([]);
  });

  it("offers no enable button for a disconnected capability", async () => {
    mount({ capStatus: "disconnected" });
    expect(await screen.findByText(/Keep awake is turned off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn on Keep awake" })).toBeNull();
  });
});

describe("parseAwakeLabel", () => {
  it("is blank for nothing, trims, and refuses what the capability refuses", () => {
    expect(parseAwakeLabel("")).toBeUndefined();
    expect(parseAwakeLabel("   ")).toBeUndefined();
    expect(parseAwakeLabel("  ok  ")).toBe("ok");
    expect(parseAwakeLabel("x".repeat(80))).toBe("x".repeat(80));
    expect(parseAwakeLabel("x".repeat(81))).toBeNull();
    expect(parseAwakeLabel("a\u200Bb")).toBeNull();
    expect(parseAwakeLabel("a\nb")).toBeNull();
    expect(parseAwakeLabel("a b")).toBe("a b");
    expect(parseAwakeLabel("é")).toBe("é");
  });
});
