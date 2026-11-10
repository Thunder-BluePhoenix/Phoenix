// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Stream Deck plugin against a FAKE WebSocket and a fake host: registration, the two actions,
// and what a key may and may not do. Stream Deck itself never ran.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KEEP_AWAKE_COOLDOWN_MS,
  PLUGIN_ACTIONS,
  parseLaunchArgs,
  startPlugin,
  stateImage,
} from "../com.phoenix.fawkes.sdPlugin/bin/plugin-core.js";
interface HostReply {
  ok: boolean;
  state?: string;
  error?: string;
}
interface Sent {
  event: string;
  context?: string;
  payload?: { title?: string; image?: string };
}

const MANIFEST_PATH = new URL("../com.phoenix.fawkes.sdPlugin/manifest.json", import.meta.url);

class FakeWebSocket {
  static last: FakeWebSocket | undefined;
  sent: Sent[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const ARGV = [
  "-port",
  "28196",
  "-pluginUUID",
  "plugin-uuid-1",
  "-registerEvent",
  "registerPlugin",
  "-info",
  "{}",
];

const flush = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};

function boot(askHost: (m: { kind: string }) => Promise<HostReply>, clock = { t: 1_000_000 }) {
  FakeWebSocket.last = undefined;
  const timers: { fn: () => void; ms: number }[] = [];
  const plugin = startPlugin(ARGV, {
    WebSocket: FakeWebSocket,
    askHost,
    now: () => clock.t,
    setInterval: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearInterval: () => {},
    setTimeout: (fn: () => void) => fn(),
  });
  expect(plugin).not.toBeNull();
  const ws = FakeWebSocket.last!;
  return { ws, plugin: plugin!, timers, clock };
}

describe("registration", () => {
  it("connects to the loopback port and sends the register event with the plugin uuid", () => {
    const { ws } = boot(async () => ({ ok: true, state: "IDLE" }));
    expect(ws.url).toBe("ws://127.0.0.1:28196");
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(ws.sent).toEqual([{ event: "registerPlugin", uuid: "plugin-uuid-1" }]);
  });

  it("refuses launch parameters that are missing or out of range", () => {
    expect(parseLaunchArgs(ARGV)).toEqual({
      port: 28196,
      uuid: "plugin-uuid-1",
      registerEvent: "registerPlugin",
    });
    expect(parseLaunchArgs([])).toBeNull();
    expect(parseLaunchArgs(["-port", "0", "-pluginUUID", "u", "-registerEvent", "e"])).toBeNull();
    expect(
      parseLaunchArgs(["-port", "70000", "-pluginUUID", "u", "-registerEvent", "e"]),
    ).toBeNull();
    expect(parseLaunchArgs(["-port", "1", "-registerEvent", "e"])).toBeNull();
    expect(parseLaunchArgs(["-port", "1", "-pluginUUID", "u"])).toBeNull();
    expect(startPlugin([], { WebSocket: FakeWebSocket })).toBeNull();
  });

  it("exits through onClose when Stream Deck closes the socket", () => {
    let closed = 0;
    FakeWebSocket.last = undefined;
    startPlugin(ARGV, {
      WebSocket: FakeWebSocket,
      askHost: async () => ({ ok: true }),
      onClose: () => closed++,
    });
    FakeWebSocket.last!.close();
    expect(closed).toBe(1);
  });
});

describe("state key", () => {
  it("shows the state name and a colour when the key appears", async () => {
    const { ws } = boot(async () => ({ ok: true, state: "WORKING" }));
    ws.open();
    ws.receive({ event: "willAppear", action: PLUGIN_ACTIONS.state, context: "ctx-a" });
    await flush();
    expect(ws.sent).toContainEqual({
      event: "setTitle",
      context: "ctx-a",
      payload: { title: "WORKING" },
    });
    expect(ws.sent).toContainEqual({
      event: "setImage",
      context: "ctx-a",
      payload: { image: stateImage("WORKING") },
    });
    expect(stateImage("WORKING")).not.toBe(stateImage("ERROR"));
  });

  it("polls on the timer and shows OFFLINE when the host cannot answer", async () => {
    let reply: HostReply = { ok: true, state: "IDLE" };
    const { ws, timers } = boot(async () => reply);
    ws.open();
    ws.receive({ event: "willAppear", action: PLUGIN_ACTIONS.state, context: "ctx-a" });
    await flush();
    reply = { ok: false, error: "core_unreachable" };
    expect(timers).toHaveLength(1);
    timers[0]!.fn();
    await flush();
    const titles = ws.sent.filter((m) => m.event === "setTitle").map((m) => m.payload.title);
    expect(titles).toEqual(["IDLE", "OFFLINE"]);
  });

  it("does not ask the host while no state key is on screen", async () => {
    let asked = 0;
    const { ws, timers } = boot(async () => {
      asked++;
      return { ok: true, state: "IDLE" };
    });
    ws.open();
    timers[0]!.fn();
    await flush();
    expect(asked).toBe(0);
    ws.receive({ event: "willAppear", action: PLUGIN_ACTIONS.state, context: "c" });
    await flush();
    expect(asked).toBe(1);
    ws.receive({ event: "willDisappear", action: PLUGIN_ACTIONS.state, context: "c" });
    timers[0]!.fn();
    await flush();
    expect(asked).toBe(1);
  });

  it("a press only refreshes: it never asks for keep-awake or anything else", async () => {
    const asks: unknown[] = [];
    const { ws } = boot(async (m) => {
      asks.push(m);
      return { ok: true, state: "WAITING" };
    });
    ws.open();
    ws.receive({ event: "willAppear", action: PLUGIN_ACTIONS.state, context: "c" });
    await flush();
    ws.receive({ event: "keyDown", action: PLUGIN_ACTIONS.state, context: "c" });
    await flush();
    expect(asks).toEqual([{ kind: "state" }, { kind: "state" }]);
  });
});

describe("keep-awake key", () => {
  it("a press sends exactly the keep_awake request and tells the person to confirm on screen", async () => {
    const asks: unknown[] = [];
    const { ws } = boot(async (m) => {
      asks.push(m);
      return { ok: true };
    });
    ws.open();
    ws.receive({ event: "willAppear", action: PLUGIN_ACTIONS.keepAwake, context: "k" });
    ws.receive({ event: "keyDown", action: PLUGIN_ACTIONS.keepAwake, context: "k" });
    await flush();
    expect(asks).toEqual([{ kind: "keep_awake" }]);
    expect(ws.sent).toContainEqual({
      event: "setTitle",
      context: "k",
      payload: { title: "Confirm on screen" },
    });
    // Nothing on a key claims that awake started.
    expect(JSON.stringify(ws.sent)).not.toMatch(/started|active|approved/i);
  });

  it("shows an alert when the host fails and never reports success", async () => {
    const { ws } = boot(async () => ({ ok: false, error: "core_unreachable" }));
    ws.open();
    ws.receive({ event: "willAppear", action: PLUGIN_ACTIONS.keepAwake, context: "k" });
    ws.receive({ event: "keyDown", action: PLUGIN_ACTIONS.keepAwake, context: "k" });
    await flush();
    expect(ws.sent).toContainEqual({ event: "showAlert", context: "k" });
    expect(ws.sent.some((m) => m.payload?.title === "Confirm on screen")).toBe(false);
  });

  it("allows one request per cooldown, so a mashed key cannot queue prompts", async () => {
    let asked = 0;
    const clock = { t: 5_000_000 };
    const { ws } = boot(async () => {
      asked++;
      return { ok: true };
    }, clock);
    ws.open();
    const press = async () => {
      ws.receive({ event: "keyDown", action: PLUGIN_ACTIONS.keepAwake, context: "k" });
      await flush();
    };
    await press();
    await press();
    await press();
    expect(asked).toBe(1);
    expect(ws.sent.filter((m) => m.event === "showAlert")).toHaveLength(2);
    clock.t += KEEP_AWAKE_COOLDOWN_MS;
    await press();
    expect(asked).toBe(2);
  });
});

describe("what the plugin never does", () => {
  it("ignores other actions, malformed frames and unknown events", async () => {
    const asks: unknown[] = [];
    const { ws } = boot(async (m) => {
      asks.push(m);
      return { ok: true, state: "IDLE" };
    });
    ws.open();
    const before = ws.sent.length;
    ws.onmessage?.({ data: "not json" });
    ws.receive(null);
    ws.receive({ event: "keyDown", action: "com.other.plugin.thing", context: "k" });
    ws.receive({ event: "keyDown", action: PLUGIN_ACTIONS.keepAwake });
    ws.receive({ event: "approve", action: PLUGIN_ACTIONS.keepAwake, context: "k" });
    ws.receive({
      event: "sendToPlugin",
      action: PLUGIN_ACTIONS.keepAwake,
      context: "k",
      payload: { kind: "approve" },
    });
    await flush();
    expect(asks).toEqual([]);
    expect(ws.sent.length).toBe(before);
  });

  it("only ever asks the host for the two fixed messages, whatever Stream Deck sends", async () => {
    const asks: { kind: string }[] = [];
    const { ws } = boot(async (m) => {
      asks.push(m);
      return { ok: true, state: "IDLE" };
    });
    ws.open();
    for (const action of Object.values(PLUGIN_ACTIONS)) {
      ws.receive({
        event: "willAppear",
        action,
        context: action,
        payload: { settings: { minutes: 9999, confirmation: "x", approve: true } },
      });
      ws.receive({
        event: "keyDown",
        action,
        context: action,
        payload: { settings: { minutes: 9999, confirmation: "x", approve: true } },
      });
    }
    await flush();
    expect(asks.length).toBeGreaterThan(0);
    for (const ask of asks) {
      expect(Object.keys(ask)).toEqual(["kind"]);
      expect(["state", "keep_awake"]).toContain(ask.kind);
    }
  });

  it("the plugin sources hold no token, no confirmation route and no approve call", () => {
    for (const name of ["plugin-core.js", "plugin.js", "host-client.js"]) {
      const text = readFileSync(
        new URL(`../com.phoenix.fawkes.sdPlugin/bin/${name}`, import.meta.url),
        "utf8",
      );
      expect(text).not.toMatch(/session\.token|PHOENIX_SESSION_TOKEN|authorization|bearer/i);
      expect(text).not.toMatch(/\/api\/confirmations|resolveConfirmation/);
      expect(text).not.toMatch(/fetch\(|node:http|node:net/);
    }
  });
});

describe("manifest", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

  it("names the two actions the plugin serves and no others", () => {
    expect(manifest.Actions.map((a: { UUID: string }) => a.UUID).sort()).toEqual(
      Object.values(PLUGIN_ACTIONS).sort(),
    );
    for (const a of manifest.Actions) expect(a.UUID.startsWith(`${manifest.UUID}.`)).toBe(true);
    expect(manifest.CodePath).toBe("bin/plugin.js");
  });

  it("uses Elgato's documented required fields and the reverse-DNS uuid pattern", () => {
    for (const field of [
      "Actions",
      "Author",
      "CodePath",
      "Description",
      "Icon",
      "Name",
      "OS",
      "Software",
      "UUID",
      "Version",
    ]) {
      expect(manifest).toHaveProperty(field);
    }
    expect(manifest.UUID).toMatch(/^([a-z0-9-]+)(\.[a-z0-9-]+)+$/);
    expect(manifest.Version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(["20", "24", "26"]).toContain(manifest.Nodejs.Version);
  });

  it("describes the keep-awake action as asking, not as doing", () => {
    const awake = manifest.Actions.find(
      (a: { UUID: string }) => a.UUID === PLUGIN_ACTIONS.keepAwake,
    );
    expect(awake.Tooltip).toMatch(/confirm on screen/i);
  });
});
