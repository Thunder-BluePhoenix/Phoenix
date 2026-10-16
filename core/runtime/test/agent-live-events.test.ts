// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The live agent-session event types belong to Core. A durable POST /api/events from another
// source cannot carry them, and the WebSocket never pushes an ephemeral copy that is not Core's.
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { connect, event, startCore } from "./helpers";

type Core = Awaited<ReturnType<typeof startCore>>;
let core: Core | undefined;
const open: { ws: { close(): void } }[] = [];
afterEach(async () => {
  for (const c of open.splice(0)) c.ws.close();
  await core?.runtime.stop();
  core = undefined;
});

describe("POST /api/events and the live agent-session types", () => {
  it.each(["agent.session.step", "agent.usage.updated"])(
    "refuses %s from a non-core source and stores nothing",
    async (type) => {
      core = await startCore();
      const res = await core.api("POST", "/api/events", event(type, { source: "terminal" }));
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("SECURITY_POLICY_BLOCKED");
      const stored = await core.api("GET", `/api/events?type=${type}`);
      expect(stored.json.events).toEqual([]);
    },
  );

  it("still accepts other agent.* events from other sources", async () => {
    core = await startCore();
    const res = await core.api("POST", "/api/events", event("agent.something.else"));
    expect(res.status).toBe(202);
  });
});

describe("WebSocket pass-through of ephemeral live events", () => {
  it("pushes an ephemeral agent.session.step only when its source is core", async () => {
    core = await startCore();
    const c = connect(core.port);
    open.push(c);
    await c.opened;
    c.send({ type: "subscribe", channels: ["event.created"] });
    await c.next((m) => m.type === "subscribed");
    const live = (source: string, n: number) =>
      core!.runtime.bus.publish(
        createEvent({
          event_type: "agent.session.step",
          source,
          severity: "info",
          payload: { n },
        }),
        { ephemeral: true },
      );
    expect(live("terminal", 1).ok).toBe(true);
    expect(live("core", 2).ok).toBe(true);
    await core.runtime.bus.drain();
    const seen = await c.next(
      (m) => m.channel === "event.created" && m.data.event.event_type === "agent.session.step",
    );
    expect(seen.data.event.source).toBe("core");
    expect(seen.data.event.payload.n).toBe(2);
    expect(c.messages.filter((m) => m.data?.event?.event_type === "agent.session.step")).toEqual(
      [],
    );
  });
});
