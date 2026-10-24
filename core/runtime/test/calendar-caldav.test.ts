// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A real Core with the real calendar capability, configured and given its secret through the API
// like the owner would, reading a loopback fake CalDAV server. No real account or server is used.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCalendarCapability } from "@phoenix/capability-calendar";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import { startCore, type TestCore } from "./helpers";

const PASSWORD = ["app", "pass", "marker", "5"].join("-");
const LOGIN = `me@example.com:${PASSWORD}`;
const MINUTE = 60_000;

let core: TestCore | undefined;
interface Dav {
  url: string;
  requests: { method: string; path: string }[];
  close(): Promise<void>;
}
let dav: Dav | undefined;

/** A loopback HTTP server answering every request with `reply()`. */
async function startDav(reply: () => { status: number; body: string }): Promise<Dav> {
  const requests: Dav["requests"] = [];
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests.push({ method: req.method ?? "", path: req.url ?? "" });
      const { status, body } = reply();
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
afterEach(async () => {
  await core?.runtime.stop();
  await dav?.close();
  core = undefined;
  dav = undefined;
});

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
function multistatus(startMs: number): string {
  const data = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:standup",
    `RECURRENCE-ID:${stamp(startMs)}`,
    `DTSTART:${stamp(startMs)}`,
    `DTEND:${stamp(startMs + 30 * MINUTE)}`,
    "SUMMARY:Daily standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/cal/1.ics</D:href><D:propstat><D:prop><C:calendar-data>${data}</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
}

async function until(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 2_000; i++) {
    if (await done()) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  expect(await done()).toBe(true);
}

describe("calendar in production wiring (no adapters supplied by code)", () => {
  it("stays unconfigured until CalDAV is configured, then reads it and reminds", async () => {
    dav = await startDav(() => ({
      status: 207,
      body: multistatus(Date.now() + 3 * MINUTE),
    }));
    const secrets = new MemorySecretStore();
    core = await startCore({}, { capabilities: builtinCapabilities("prod"), secrets });
    const { api } = core;
    expect((await api("POST", "/api/capabilities/calendar/enable", {})).status).toBe(200);
    expect((await api("GET", "/api/calendar/upcoming")).json).toMatchObject({
      enabled: true,
      status: "unconfigured",
      events: [],
    });
    expect(dav.requests).toHaveLength(0);

    // Secrets are refused in config; the URL goes in config, the login in the secret store.
    const smuggled = await api("POST", "/api/capabilities/calendar/config", {
      config: { caldav: true, caldav_credential: LOGIN },
    });
    expect(smuggled.status).toBe(400); // not a config property: the schema forbids extras
    expect(JSON.stringify(smuggled.json)).not.toContain(PASSWORD);
    const bad = await api("POST", "/api/capabilities/calendar/config", {
      config: { caldav: true, caldav_url: "http://dav.example.com/cal/" },
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).not.toContain("dav.example.com");

    expect(
      (
        await api("POST", "/api/capabilities/calendar/config", {
          config: { caldav: true, caldav_url: `${dav.url}/cal/work/` },
        })
      ).status,
    ).toBe(200);
    const stored = await api("POST", "/api/capabilities/calendar/secrets/caldav_credential", {
      value: LOGIN,
    });
    expect(stored.status).toBe(200);
    expect(JSON.stringify(stored.json)).not.toContain(PASSWORD);
    // Config is read when the capability starts: restart it.
    expect((await api("POST", "/api/capabilities/calendar/disable", {})).status).toBe(200);
    expect((await api("POST", "/api/capabilities/calendar/enable", {})).status).toBe(200);

    await until(async () => (await api("GET", "/api/calendar/upcoming")).json.status === "ready");
    const view = (await api("GET", "/api/calendar/upcoming")).json;
    expect(view.events.map((e: { title: string }) => e.title)).toEqual(["Daily standup"]);
    expect(dav.requests[0]).toMatchObject({ method: "REPORT", path: "/cal/work/" });

    await until(async () => {
      const list = (await api("GET", "/api/notifications")).json.notifications as {
        eventType: string;
      }[];
      return list.some((n) => n.eventType === "calendar.meeting.starting_soon");
    });

    // The password appears nowhere Core shows: capability views, privacy inventory, events, notifications.
    const everything = JSON.stringify([
      (await api("GET", "/api/capabilities")).json,
      (await api("GET", "/api/privacy")).json,
      (await api("GET", "/api/events?limit=200")).json,
      (await api("GET", "/api/notifications")).json,
      view,
    ]);
    expect(everything).not.toContain(PASSWORD);
    expect((await api("GET", "/api/privacy")).json.credentials).toEqual([
      { capability: "calendar", name: "caldav_credential", stored_in: "OS keychain" },
    ]);
  });

  it("makes a configured CalDAV feed that fails look unavailable, not empty, and blocks nothing by itself", async () => {
    dav = await startDav(() => ({ status: 401, body: PASSWORD }));
    core = await startCore(
      {},
      {
        capabilities: [createCalendarCapability()],
        secrets: new MemorySecretStore(),
      },
    );
    const { api } = core;
    await api("POST", "/api/capabilities/calendar/config", {
      config: { caldav: true, caldav_url: `${dav.url}/cal/` },
    });
    await api("POST", "/api/capabilities/calendar/secrets/caldav_credential", { value: LOGIN });
    await api("POST", "/api/capabilities/calendar/enable", {});
    await until(async () => dav!.requests.length > 0);
    await until(
      async () => (await api("GET", "/api/calendar/upcoming")).json.status === "unavailable",
    );
    const view = JSON.stringify((await api("GET", "/api/calendar/upcoming")).json);
    expect(view).not.toContain(PASSWORD);
  });
});
