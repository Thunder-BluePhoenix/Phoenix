// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { event, startCore } from "./helpers";

function terminalEvent(id: string) {
  return event("build.failed", { event_id: id, source: "terminal", severity: "error" });
}

describe("the terminal event source choice", () => {
  it("is off by default: a session-token client may still post the terminal source", async () => {
    const core = await startCore();
    expect((await core.api("GET", "/api/events/source-policy")).json).toEqual({
      reserveTerminal: false,
    });
    expect((await core.api("POST", "/api/events", terminalEvent("evt_term_0001"))).status).toBe(
      202,
    );
    await core.runtime.stop();
  });

  it("refuses the terminal source once the user turns the reservation on, and allows it again when off", async () => {
    const core = await startCore();
    const on = await core.api("PUT", "/api/events/source-policy", { reserveTerminal: true });
    expect(on.json).toEqual({ reserveTerminal: true });

    const refused = await core.api("POST", "/api/events", terminalEvent("evt_term_0002"));
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe("SECURITY_POLICY_BLOCKED");
    await core.runtime.bus.drain();
    expect((await core.api("GET", "/api/events?source=terminal")).json.events).toEqual([]);

    // Other sources are unaffected by the choice.
    const other = { ...terminalEvent("evt_other_0001"), source: "ci" };
    expect((await core.api("POST", "/api/events", other)).status).toBe(202);

    await core.api("PUT", "/api/events/source-policy", { reserveTerminal: false });
    expect((await core.api("POST", "/api/events", terminalEvent("evt_term_0003"))).status).toBe(
      202,
    );
    await core.runtime.stop();
  });

  it("keeps the choice across a restart and audits every change", async () => {
    const core = await startCore();
    await core.api("PUT", "/api/events/source-policy", { reserveTerminal: true });
    expect(core.runtime.eventSourcePolicy.get()).toEqual({ reserveTerminal: true });
    const audit = core.runtime.permissions.audit.list({ limit: 5 });
    expect(audit[0]).toMatchObject({
      action: "events.reserve_terminal.changed",
      details: { reserveTerminal: true },
    });
    await core.runtime.stop();
  });

  it("needs the session token and a strict body", async () => {
    const core = await startCore();
    const anonymous = await fetch(`${core.base}/api/events/source-policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reserveTerminal: true }),
    });
    expect(anonymous.status).toBe(401);
    for (const bad of [{}, { reserveTerminal: "yes" }, { reserveTerminal: true, extra: 1 }, []]) {
      const res = await core.api("PUT", "/api/events/source-policy", bad);
      expect([JSON.stringify(bad), res.status]).toEqual([JSON.stringify(bad), 400]);
    }
    expect(core.runtime.eventSourcePolicy.get()).toEqual({ reserveTerminal: false });
    await core.runtime.stop();
  });
});
