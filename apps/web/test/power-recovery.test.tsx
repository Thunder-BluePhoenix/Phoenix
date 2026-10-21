// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { readRecoveryStatus } from "../src/core/power";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { doubleClick, expectInert, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

const capability = (id: string, status: "enabled" | "installed") => ({
  id,
  name: id,
  version: "0.1.0",
  description: id,
  kind: "builtin",
  status,
  health: { status: "healthy" },
  permissions: [],
  commands: [],
  data_categories: [],
});

type Routes = Parameters<typeof fakeApi>[0];
type Outcome = { status: string; error?: { message: string } };

const STATUS = "/api/capabilities/awake/commands/recovery.status";
const HEADING = "Lid-closed mode and recovery";
const HASH = "a".repeat(64);

/** A `recovery.status` result that is healthy and ready to start lid-closed mode. */
function status(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_active: true,
    journal: { pending: [], untrusted: 0, partial_tail: false, size_bytes: 0 },
    can_quit: true,
    helper: { installed: true },
    lid: { supported: true, state: "open" },
    lid_closed: { engaged: false, since: null, session_id: null },
    floors: {
      enabled: true,
      low_power_percent: 20,
      end_percent: 10,
      thermal_low_power_level: "fair",
      thermal_end_level: "critical",
      low_power_active: false,
      last: null,
    },
    safety: {
      acknowledged: true,
      version: 3,
      acknowledged_at: "2026-10-20T10:00:00Z",
      text_sha256: HASH,
    },
    ...over,
  };
}

/** `recovery.status`: POST starts `op-status`, GET returns the current result. */
function recoveryStatus(result: () => unknown): Routes {
  return {
    [`POST ${STATUS}`]: () => ({ id: "op-status" }),
    "GET /api/operations/op-status": () => ({ status: "succeeded", result: result() }),
  };
}

/** An approval-gated command: POST starts `op-awake-<cmd>`, GET reports `outcome`. */
function action(cmd: string, outcome: () => Outcome = () => ({ status: "succeeded" })): Routes {
  return {
    [`POST /api/capabilities/awake/commands/${cmd}`]: () => ({ id: `op-awake-${cmd}` }),
    [`GET /api/operations/op-awake-${cmd}`]: () => outcome(),
  };
}

const awakeEnabled: Routes = {
  "GET /api/capabilities": () => ({ capabilities: [capability("awake", "enabled")] }),
};

function open(routes: Routes) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
  return { api, ws: FakeWebSocket.last, container: view.container };
}

const bodies = (api: FakeApi, cmd: string) =>
  api.posts(`/api/capabilities/awake/commands/${cmd}`).map((c) => c.body);

const section = async () =>
  (await screen.findByRole("heading", { name: HEADING })).closest("section")!;

const startButton = (sec: HTMLElement) =>
  within(sec).getByRole("button", { name: "Start lid-closed mode" }) as HTMLButtonElement;

/** Opens the glance with this status and waits until it is on screen. */
async function load(over: Record<string, unknown> = {}, extra: Routes = {}) {
  const opened = open({
    ...awakeEnabled,
    ...recoveryStatus(() => status(over)),
    ...action("lid_closed.start"),
    ...action("lid_closed.end"),
    ...action("recovery.undo_now"),
    ...action("safety.acknowledge"),
    ...action("recovery.discard"),
    ...extra,
  });
  const sec = await section();
  await within(sec).findByRole("button", { name: /lid-closed mode$/ });
  return { ...opened, sec };
}

describe("Lid-closed mode and recovery glance", () => {
  it("is absent, and calls nothing, while Keep awake is not enabled", async () => {
    const { api } = open({
      "GET /api/capabilities": () => ({ capabilities: [capability("awake", "installed")] }),
    });
    await screen.findByRole("heading", { name: "Active tasks" });
    expect(screen.queryByRole("heading", { name: HEADING })).toBeNull();
    expect(api.calls.some((c) => c.path.includes("/commands/"))).toBe(false);
  });

  it("says nothing is waiting when the journal is empty", async () => {
    const { sec } = await load();
    expect(within(sec).getByText("Nothing is waiting to be undone.")).toBeTruthy();
    expect(within(sec).queryByRole("button", { name: "Undo now" })).toBeNull();
    expect(within(sec).queryByText(/Quitting Phoenix is refused/)).toBeNull();
  });

  it("warns about pending changes and sends Undo now once, even on a double click", async () => {
    const { api, sec } = await load({
      journal: {
        pending: [
          {
            id: "a",
            kind: "pmset.disablesleep",
            at: 1_760_000_000_000,
            session: "s1",
            owner: "dead",
          },
          {
            id: "b",
            kind: "pmset.lowpowermode",
            at: 1_760_000_100_000,
            session: null,
            owner: "self",
          },
        ],
        untrusted: 2,
        partial_tail: false,
        size_bytes: 120,
      },
      can_quit: false,
    });
    const alert = within(sec).getByRole("alert");
    expect(alert.textContent).toContain(
      "Phoenix could not restore 2 system changes. Sleep settings may still be changed.",
    );
    expect(within(alert).getByText("Sleep with lid closed")).toBeTruthy();
    expect(within(alert).getByText("Low Power Mode")).toBeTruthy();
    expect(
      within(sec).getByText("2 unreadable journal lines were ignored, not trusted."),
    ).toBeTruthy();
    expect(
      within(sec).getByText("Quitting Phoenix is refused until these are undone."),
    ).toBeTruthy();

    doubleClick(() => fireEvent.click(within(alert).getByRole("button", { name: "Undo now" })));
    await waitFor(() => expect(bodies(api, "recovery.undo_now")).toEqual([{ input: {} }]));
  });

  it("reloads the status after Undo now succeeds", async () => {
    let pending = [{ id: "a", kind: "pmset.disablesleep", at: 0, session: null, owner: "dead" }];
    const { api, sec } = await load(
      {},
      recoveryStatus(() =>
        status({ journal: { pending, untrusted: 0, partial_tail: false, size_bytes: 1 } }),
      ),
    );
    fireEvent.click(await within(sec).findByRole("button", { name: "Undo now" }));
    pending = [];
    expect(await within(sec).findByText("Nothing is waiting to be undone.")).toBeTruthy();
    expect(api.posts(STATUS)).toHaveLength(2);
  });

  it("shows a failed command as an alert", async () => {
    const { sec } = await load(
      {
        journal: {
          pending: [{ id: "a", kind: "x", at: 0, session: null, owner: "dead" }],
          untrusted: 0,
          partial_tail: false,
          size_bytes: 1,
        },
      },
      action("recovery.undo_now", () => ({
        status: "failed",
        error: { message: "Helper refused" },
      })),
    );
    fireEvent.click(within(sec).getByRole("button", { name: "Undo now" }));
    expect(await within(sec).findByText("Helper refused")).toBeTruthy();
  });

  it("tells the user it waits for approval while a command is pending", async () => {
    const { sec } = await load(
      {},
      action("lid_closed.start", () => ({ status: "pending" })),
    );
    fireEvent.click(startButton(sec));
    expect(await within(sec).findByText("Waiting for your approval…")).toBeTruthy();
    expect(startButton(sec).disabled).toBe(true);
  });

  it("refreshes on awake.* events only", async () => {
    let lid = "open";
    const { api, ws, sec } = await load(
      {},
      recoveryStatus(() => status({ lid: { supported: true, state: lid } })),
    );
    expect(within(sec).getByText("The lid is open.")).toBeTruthy();
    lid = "closed";
    sendEvent(ws, 1, "calendar.event.created");
    await act(async () => {});
    expect(api.posts(STATUS)).toHaveLength(1);
    sendEvent(ws, 2, "awake.lid.closed");
    expect(await within(sec).findByText("The lid is closed.")).toBeTruthy();
    expect(api.posts(STATUS)).toHaveLength(2);
  });

  it("reports an unsupported lid and cannot start", async () => {
    const { sec } = await load({ lid: { supported: false, state: "unsupported" } });
    expect(
      within(sec).getByText(
        "This computer has no lid sensor, so lid-closed mode is not available.",
      ),
    ).toBeTruthy();
    expect(startButton(sec).disabled).toBe(true);
  });

  it("keeps hostile strings and unknown kinds inert", async () => {
    const { sec, container } = await load({
      journal: {
        pending: [{ id: XSS, kind: XSS, at: 1_760_000_000_000, session: XSS, owner: XSS }],
        untrusted: 0,
        partial_tail: false,
        size_bytes: 1,
      },
      floors: {
        enabled: true,
        low_power_percent: 20,
        end_percent: 10,
        thermal_low_power_level: XSS,
        thermal_end_level: "critical",
        low_power_active: false,
        last: { battery: { kind: XSS }, thermal: { kind: "level", level: XSS } },
      },
    });
    expect(within(sec).getByText("Other change")).toBeTruthy();
    expectInert(container);
  });

  it("describes the floors, Low Power Mode and the last readings", async () => {
    const { sec } = await load({
      floors: {
        enabled: true,
        low_power_percent: 20,
        end_percent: 10,
        thermal_low_power_level: "fair",
        thermal_end_level: "critical",
        low_power_active: true,
        last: {
          battery: { kind: "battery", percent: 42, on_battery: true },
          thermal: { kind: "level", level: "serious" },
        },
      },
    });
    expect(
      within(sec).getByText(
        "Low Power Mode below 20 %, end the session below 10 %; heat: Low Power Mode at warm, end at critical.",
      ),
    ).toBeTruthy();
    expect(within(sec).getByText("Low Power Mode is on")).toBeTruthy();
    expect(within(sec).getByText("Battery 42 %, unplugged · Heat: hot")).toBeTruthy();
  });

  it("says when the floors are off", async () => {
    const { sec } = await load({
      floors: {
        enabled: false,
        low_power_percent: 20,
        end_percent: 10,
        thermal_low_power_level: "fair",
        thermal_end_level: "critical",
        low_power_active: false,
        last: null,
      },
    });
    expect(within(sec).getByText("Floors are off")).toBeTruthy();
  });

  it("says what it cannot read instead of guessing", async () => {
    open({ ...awakeEnabled, ...recoveryStatus(() => ({ journal: "nope" })) });
    const sec = await section();
    expect(await within(sec).findByText("The recovery status could not be read.")).toBeTruthy();
    expect(within(sec).queryByRole("button")).toBeNull();
  });
});

describe("safety acknowledgement and starting", () => {
  const unacknowledged = {
    safety: { acknowledged: false, version: 7, acknowledged_at: null, text_sha256: HASH },
  };

  it("keeps Start and Acknowledge off until the box is ticked, then acknowledges the shown version", async () => {
    const { api, sec } = await load(unacknowledged);
    expect(
      within(sec).getByText(
        "Never carry the computer in a bag, case or other closed space while lid-closed mode is on: it can overheat. Keep vents clear.",
      ),
    ).toBeTruthy();
    const ack = within(sec).getByRole("button", { name: "Acknowledge" }) as HTMLButtonElement;
    expect(ack.disabled).toBe(true);
    expect(startButton(sec).disabled).toBe(true);
    fireEvent.click(ack);
    expect(bodies(api, "safety.acknowledge")).toHaveLength(0);

    fireEvent.click(within(sec).getByRole("checkbox", { name: "I understand" }));
    expect(ack.disabled).toBe(false);
    expect(startButton(sec).disabled).toBe(true);
    doubleClick(() => fireEvent.click(ack));
    await waitFor(() =>
      expect(bodies(api, "safety.acknowledge")).toEqual([
        { input: { acknowledge: true, version: 7, text_sha256: HASH } },
      ]),
    );
  });

  it("enables Start after the status reports the acknowledgement", async () => {
    let acknowledged = false;
    const { api, sec } = await load(
      {},
      recoveryStatus(() =>
        status({
          safety: { acknowledged, version: 7, acknowledged_at: null, text_sha256: HASH },
        }),
      ),
    );
    expect(startButton(sec).disabled).toBe(true);
    fireEvent.click(within(sec).getByRole("checkbox", { name: "I understand" }));
    acknowledged = true;
    fireEvent.click(within(sec).getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(startButton(sec).disabled).toBe(false));
    expect(within(sec).queryByRole("checkbox")).toBeNull();
    expect(api.posts(STATUS)).toHaveLength(2);
  });

  it("sends lid_closed.start once when acknowledged, helper installed and a session runs", async () => {
    const { api, sec } = await load();
    expect(startButton(sec).disabled).toBe(false);
    doubleClick(() => fireEvent.click(startButton(sec)));
    await waitFor(() => expect(bodies(api, "lid_closed.start")).toEqual([{ input: {} }]));
  });

  it.each([
    ["the helper is not installed", { helper: { installed: false } }],
    ["the helper state is unknown", { helper: { installed: null } }],
    ["no keep-awake session is running", { session_active: false }],
    ["the lid is unsupported", { lid: { supported: false, state: "unsupported" } }],
  ])("keeps Start off when %s", async (_name, over) => {
    const { api, sec } = await load(over);
    expect(startButton(sec).disabled).toBe(true);
    fireEvent.click(startButton(sec));
    expect(bodies(api, "lid_closed.start")).toHaveLength(0);
  });

  it("says when the helper is not installed", async () => {
    const { sec } = await load({ helper: { installed: false } });
    expect(
      within(sec).getByText(
        "Privileged helper not installed (lid-closed mode unavailable). See docs/awake-helper.md.",
      ),
    ).toBeTruthy();
  });

  it("says when the helper is installed", async () => {
    const { sec } = await load();
    expect(within(sec).getByText("Privileged helper installed")).toBeTruthy();
  });

  it("offers only End while lid-closed mode is engaged, and sends it once", async () => {
    const { api, sec } = await load({
      lid_closed: { engaged: true, since: "2026-10-21T08:00:00Z", session_id: "s1" },
    });
    expect(within(sec).queryByRole("button", { name: "Start lid-closed mode" })).toBeNull();
    doubleClick(() =>
      fireEvent.click(within(sec).getByRole("button", { name: "End lid-closed mode" })),
    );
    await waitFor(() => expect(bodies(api, "lid_closed.end")).toEqual([{ input: {} }]));
  });
});

describe("findings 3, 8, 9: lock, journal path, discard, hash-bound acknowledgement", () => {
  it("keeps Acknowledge off when Core sent no warning hash, so nothing unbound is ever sent", async () => {
    const { api, sec } = await load({
      safety: { acknowledged: false, version: 7, acknowledged_at: null },
    });
    fireEvent.click(within(sec).getByRole("checkbox", { name: "I understand" }));
    const ack = within(sec).getByRole("button", { name: "Acknowledge" }) as HTMLButtonElement;
    expect(ack.disabled).toBe(true);
    fireEvent.click(ack);
    expect(bodies(api, "safety.acknowledge")).toHaveLength(0);
  });

  it("shows the journal path, a held recovery lock and unexplained disabled sleep", async () => {
    const { sec } = await load({
      journal_path: "/Users/me/.phoenix/dev/awake/recovery-journal.jsonl",
      recovery_lock: { blocked: true, since: "2026-10-21T08:00:00Z" },
      sleep_disabled_unjournaled: true,
    });
    expect(
      within(sec).getByText("Journal: /Users/me/.phoenix/dev/awake/recovery-journal.jsonl"),
    ).toBeTruthy();
    expect(within(sec).getByText(/Another recovery process holds the lock/)).toBeTruthy();
    expect(within(sec).getByText(/Phoenix has no record of turning it off/)).toBeTruthy();
  });

  it("shows none of them when the status does not report them", async () => {
    const { sec } = await load();
    expect(within(sec).queryByText(/Another recovery process/)).toBeNull();
    expect(within(sec).queryByText(/no record of turning it off/)).toBeNull();
    expect(within(sec).queryByText(/^Journal:/)).toBeNull();
  });

  it("offers Discard only for an entry Core says nothing can undo, and sends its id once", async () => {
    const pending = [
      {
        id: "c1",
        kind: "pmset.disablesleep",
        at: 1,
        session: null,
        owner: "dead",
        discardable: false,
      },
      { id: "x9", kind: "forged.kind", at: 1, session: null, owner: "dead", discardable: true },
    ];
    const { api, sec } = await load({
      journal: { pending, untrusted: 0, partial_tail: false, size_bytes: 0 },
      can_quit: false,
    });
    const discard = within(sec).getAllByRole("button", { name: "Discard this entry" });
    expect(discard).toHaveLength(1);
    doubleClick(() => fireEvent.click(discard[0]!));
    await waitFor(() => expect(bodies(api, "recovery.discard")).toEqual([{ input: { id: "x9" } }]));
  });
});

describe("readRecoveryStatus", () => {
  it.each([
    ["null", null],
    ["a string", "status"],
    ["an array", []],
    ["no journal", { safety: { acknowledged: true, version: 1 } }],
    [
      "a journal without a pending list",
      { journal: {}, safety: { acknowledged: true, version: 1 } },
    ],
    ["no safety block", { journal: { pending: [] } }],
    [
      "a fractional safety version",
      { journal: { pending: [] }, safety: { acknowledged: true, version: 1.5 } },
    ],
    [
      "a string safety version",
      { journal: { pending: [] }, safety: { acknowledged: true, version: "1" } },
    ],
  ])("rejects %s", (_name, raw) => {
    expect(readRecoveryStatus(raw)).toBeNull();
  });

  it("falls back to the cautious reading for everything it cannot trust", () => {
    const read = readRecoveryStatus({
      journal: { pending: [] },
      safety: { acknowledged: "yes", version: 2 },
      helper: { installed: "yes" },
      lid: { supported: "yes", state: "sideways" },
      lid_closed: { engaged: 1, since: "not a date" },
      can_quit: "true",
      session_active: 1,
    });
    expect(read).toMatchObject({
      session_active: false,
      can_quit: false,
      helper_installed: null,
      lid: { supported: false, state: "unknown" },
      lid_closed: { engaged: false, since: null, session_id: null },
      safety: { acknowledged: false, version: 2, acknowledged_at: null },
      floors: null,
    });
  });

  it("clamps numbers, clips text, caps the list and keeps unknown kinds", () => {
    const read = readRecoveryStatus({
      journal: {
        pending: Array.from({ length: 500 }, (_, i) => ({
          id: `id-${i}`,
          kind: i === 0 ? "x".repeat(5000) : "weird.kind",
          at: i === 0 ? -5 : Number.POSITIVE_INFINITY,
          session: 12,
          owner: "nobody",
        })),
        untrusted: 1e12,
        size_bytes: -1,
      },
      safety: { acknowledged: true, version: 1 },
      floors: {
        enabled: true,
        low_power_percent: 500,
        end_percent: -3,
        thermal_low_power_level: "fair",
        thermal_end_level: "critical",
        last: {
          battery: { kind: "battery", percent: 250, on_battery: "no" },
          thermal: { kind: "level" },
        },
      },
    });
    expect(read).not.toBeNull();
    expect(read!.journal.pending).toHaveLength(200);
    expect(read!.journal.pending[0]!.kind).toHaveLength(200);
    expect(read!.journal.pending[0]!.at).toBe(0);
    expect(read!.journal.pending[1]).toMatchObject({
      kind: "weird.kind",
      at: 0,
      session: null,
      owner: "other",
    });
    expect(read!.journal.untrusted).toBe(1_000_000);
    expect(read!.journal.size_bytes).toBe(0);
    expect(read!.floors).toMatchObject({
      low_power_percent: 100,
      end_percent: 0,
      last: {
        battery: { kind: "battery", percent: 100, on_battery: null },
        thermal: { kind: "unknown" },
      },
    });
  });
});
