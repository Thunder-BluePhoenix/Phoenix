// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { MemorySecretStore } from "@phoenix/persistence";
import { describe, expect, it } from "vitest";
import { signWebhook } from "../src/team-status/webhooks";
import { startCore, TOKEN } from "./helpers";

function delivery(eventId: string) {
  return JSON.stringify({ event_id: eventId, event_type: "deploy.started" });
}

async function deliver(base: string, secret: string, raw: string, headers: HeadersInit = {}) {
  const seconds = Math.floor(Date.now() / 1000);
  return fetch(`${base}/api/webhooks/in/ci-main`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-phoenix-timestamp": String(seconds),
      "x-phoenix-signature": signWebhook(secret, seconds, Buffer.from(raw)),
      ...headers,
    },
    body: raw,
  });
}

describe("incoming webhooks through the running Core", () => {
  it("accepts a signed delivery without the session token and publishes it as a webhook source", async () => {
    const core = await startCore({}, { secrets: new MemorySecretStore() });
    await core.api("PUT", "/api/team/webhooks", { enabled: true });
    const created = await core.api("POST", "/api/team/webhooks/sources", {
      id: "ci-main",
      eventTypes: ["deploy.started"],
    });
    expect(created.status).toBe(201);

    const accepted = await deliver(core.base, created.json.secret, delivery("delivery-0001"));
    expect(accepted.status).toBe(202);
    await core.runtime.bus.drain();
    const stored = await core.api("GET", "/api/events?type=deploy.started");
    expect(stored.json.events.map((e: { event: { source: string } }) => e.event.source)).toEqual([
      "webhook-ci-main",
    ]);

    // The session token is not a credential for the ingest route.
    const withToken = await fetch(`${core.base}/api/webhooks/in/ci-main`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: delivery("delivery-0002"),
    });
    expect(withToken.status).toBe(401);
    await core.runtime.stop();
  });

  it("management routes still need the session token", async () => {
    const core = await startCore({}, { secrets: new MemorySecretStore() });
    expect((await fetch(`${core.base}/api/team/webhooks`)).status).toBe(401);
    await core.runtime.stop();
  });

  it("does not let API clients forge events from a webhook source", async () => {
    const core = await startCore({}, { secrets: new MemorySecretStore() });
    const forged = await core.api("POST", "/api/events", {
      event_id: "forged-event-0001",
      event_type: "deploy.started",
      source: "webhook-ci-main",
      severity: "info",
      timestamp: new Date().toISOString(),
      data_classification: "internal",
      payload: {},
    });
    expect(forged.status).toBe(403);
    await core.runtime.stop();
  });

  it("offers no webhook routes when there is no OS secret store", async () => {
    const core = await startCore();
    expect((await core.api("GET", "/api/team/webhooks")).status).toBe(404);
    expect((await core.api("POST", "/api/webhooks/in/ci-main", "{}")).status).toBe(404);
    await core.runtime.stop();
  });
});
