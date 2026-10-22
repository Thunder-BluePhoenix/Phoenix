// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { createRelayServer } from "../../../relay/src/server";
import { TEAM_KEY_SECRET } from "../src/team-status/link";
import { event, startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startRelay(): Promise<string> {
  const relay: Server = createRelayServer();
  relay.listen(0, "127.0.0.1");
  await once(relay, "listening");
  cleanups.push(() => {
    relay.closeAllConnections();
    relay.close();
  });
  return `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
}

function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

/** Waits for a condition by yielding to the event loop; no wall-clock timer. */
async function settle(done: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 20_000 && !(await done()); i++) await yieldToEventLoop();
  expect(await done()).toBe(true);
}

interface Member {
  core: TestCore;
  secrets: MemorySecretStore;
  id: string;
  publicKey: string;
  /** Runs one heartbeat by hand. */
  beat(): void;
}

/** Heartbeat and reconnect waits are driven by the test, never by a timer. */
function options(secrets: MemorySecretStore, beats: (() => void)[], databasePath?: string) {
  return {
    secrets,
    runtime: {
      phone: { lanAddresses: () => ["127.0.0.1"], port: 0 },
      teamLink: {
        sleep: () => Promise.withResolvers<void>().promise,
        heartbeat: (beat: () => void) => {
          beats.push(beat);
          return () => undefined;
        },
      },
      ...(databasePath ? { databasePath } : {}),
    },
  };
}

async function join_(
  url: string,
  route?: string,
  secrets = new MemorySecretStore(),
  databasePath?: string,
): Promise<Member> {
  const beats: (() => void)[] = [];
  const core = await startCore({}, options(secrets, beats, databasePath));
  cleanups.push(() => core.runtime.stop());
  const on = await core.api("POST", "/api/team/link", { url, ...(route ? { route } : {}) });
  expect(on.status).toBe(200);
  await settle(() => core.runtime.teamLink!.status().connected);
  return {
    core,
    secrets,
    id: on.json.self.id,
    publicKey: on.json.self.public_key,
    beat: () => beats.at(-1)?.(),
  };
}

async function pin(by: Member, other: Member, label: string): Promise<void> {
  const added = await by.core.api("POST", "/api/team/members", {
    id: other.id,
    label,
    public_key: other.publicKey,
  });
  expect(added.status).toBe(200);
}

async function team(): Promise<{ url: string; ana: Member; bo: Member }> {
  const url = await startRelay();
  const ana = await join_(url);
  const route = (await ana.core.api("GET", "/api/team/link")).json.route as string;
  const bo = await join_(url, route);
  await pin(ana, bo, "Bo");
  await pin(bo, ana, "Ana");
  return { url, ana, bo };
}

const shareDeploys = (m: Member) =>
  m.core.api("PUT", "/api/team/sharing", { enabled: true, consent: { deploying: true } });

interface SeenMember {
  id: string;
  label: string;
  items: { kind: string; since: number }[];
}

const seen = async (m: Member): Promise<SeenMember[]> =>
  (await m.core.api("GET", "/api/team/status")).json.presence.members;

describe("team presence through the running Core", () => {
  it("is off by default and has no team routes without an OS secret store", async () => {
    const core = await startCore();
    cleanups.push(() => core.runtime.stop());
    expect((await core.api("GET", "/api/team/link")).status).toBe(404);
    expect((await core.api("GET", "/api/team/status")).status).toBe(404);
    const withStore = await startCore({}, { secrets: new MemorySecretStore() });
    cleanups.push(() => withStore.runtime.stop());
    expect((await withStore.api("GET", "/api/team/link")).json).toMatchObject({
      enabled: false,
      connected: false,
      self: null,
    });
    expect((await withStore.api("GET", "/api/team/status")).json.sharing).toMatchObject({
      enabled: false,
      consent: { deploying: false, agent_run: false, meeting: false },
    });
    expect((await fetch(`${withStore.base}/api/team/link`)).status).toBe(401);
    expect((await fetch(`${withStore.base}/api/team/members`, { method: "POST" })).status).toBe(
      401,
    );
  });

  it("shows a teammate what I chose to share, and stops the moment I turn sharing off", async () => {
    const { ana, bo } = await team();
    await shareDeploys(ana);
    ana.core.runtime.bus.publish(event("deploy.started", { source: "deployer", subject: "prod" }));
    await ana.core.runtime.bus.drain();
    await ana.core.runtime.teamLink!.idle();
    await settle(async () => (await seen(bo)).length === 1);
    expect(await seen(bo)).toEqual([
      { id: ana.id, label: "Ana", items: [{ kind: "deploying", since: expect.any(Number) }] },
    ]);
    // Bo shares nothing, so Ana sees nothing of Bo.
    expect(await seen(ana)).toEqual([]);

    await ana.core.api("PUT", "/api/team/sharing", { enabled: false });
    await ana.core.runtime.teamLink!.idle();
    await settle(async () => (await seen(bo)).length === 0);
  });

  it("sends nothing while sharing is off, and shares only the kinds I consented to", async () => {
    const { ana, bo } = await team();
    ana.core.runtime.bus.publish(event("deploy.started", { source: "deployer", subject: "prod" }));
    await ana.core.runtime.bus.drain();
    ana.beat();
    await ana.core.runtime.teamLink!.idle();
    expect(await seen(bo)).toEqual([]);

    // Master switch on, but no kind consented: I am listed as present with nothing shared.
    await ana.core.api("PUT", "/api/team/sharing", { enabled: true });
    await settle(async () => (await seen(bo)).length === 1);
    expect(await seen(bo)).toEqual([{ id: ana.id, label: "Ana", items: [] }]);

    await ana.core.api("PUT", "/api/team/sharing", { consent: { deploying: true } });
    await settle(async () => (await seen(bo))[0]?.items.length === 1);
    expect((await seen(bo))[0]!.items).toEqual([{ kind: "deploying", since: expect.any(Number) }]);
  });

  it("never shows something a webhook claimed about me", async () => {
    const { ana, bo } = await team();
    await shareDeploys(ana);
    await settle(async () => (await seen(bo)).length === 1);
    ana.core.runtime.bus.publish(
      event("deploy.started", { source: "webhook-ci", subject: "prod" }),
    );
    await ana.core.runtime.bus.drain();
    ana.beat();
    await ana.core.runtime.teamLink!.idle();
    // What would be sent is exactly what a teammate may see: nothing, although I consented to deploys.
    expect((await ana.core.api("GET", "/api/team/status")).json.sharing.outgoing.items).toEqual([]);
    expect(await seen(bo)).toEqual([{ id: ana.id, label: "Ana", items: [] }]);
  });

  it("ignores a sender who is not on my roster and one who only claims to be on it", async () => {
    const { url, ana, bo } = await team();
    const route = (await ana.core.api("GET", "/api/team/link")).json.route as string;
    const eve = await join_(url, route);
    // Eve pins Bo and shares, but Bo never pinned Eve.
    await pin(eve, bo, "Bo");
    await shareDeploys(eve);
    eve.core.runtime.bus.publish(event("deploy.started", { source: "deployer", subject: "x" }));
    await eve.core.runtime.bus.drain();
    await eve.core.runtime.teamLink!.idle();
    await bo.core.runtime.teamLink!.idle();
    await yieldToEventLoop();
    expect(await seen(bo)).toEqual([]);
    expect((await bo.core.api("GET", "/api/team/status")).json.members).toEqual([
      { id: ana.id, label: "Ana" },
    ]);
  });

  it("the emergency stop takes the team link down and keeps the roster", async () => {
    const { ana, bo } = await team();
    await shareDeploys(ana);
    ana.core.runtime.permissions.engageKillSwitch("test");
    await ana.core.runtime.bus.drain();
    await settle(() => !ana.core.runtime.teamLink!.status().enabled);
    expect(ana.core.runtime.teamLink!.status().connected).toBe(false);
    expect(
      (await ana.core.api("POST", "/api/team/link", { url: "http://127.0.0.1:9" })).status,
    ).toBe(403);
    expect(ana.core.runtime.teamLink!.memberCount()).toBe(1);
    expect(await ana.secrets.get(TEAM_KEY_SECRET)).toBeDefined();
    expect(bo.core.runtime.teamLink!.status().enabled).toBe(true);
  });

  it("keeps its identity, route and roster across a restart", async () => {
    const url = await startRelay();
    const databasePath = join(mkdtempSync(join(tmpdir(), "phoenix-team-")), "core.db");
    const secrets = new MemorySecretStore();
    const first = await join_(url, undefined, secrets, databasePath);
    const bo = await join_(url, (await first.core.api("GET", "/api/team/link")).json.route);
    await pin(first, bo, "Bo");
    const before = (await first.core.api("GET", "/api/team/link")).json;
    await first.core.runtime.stop();

    const beats: (() => void)[] = [];
    const second = await startCore({}, options(secrets, beats, databasePath));
    cleanups.push(() => second.runtime.stop());
    const after = (await second.api("GET", "/api/team/link")).json;
    expect(after).toMatchObject({ enabled: true, route: before.route, self: before.self });
    expect((await second.api("GET", "/api/team/status")).json.members).toEqual([
      { id: bo.id, label: "Bo" },
    ]);
  });

  it("leaving forgets the identity, the route and every teammate", async () => {
    const { ana } = await team();
    expect((await ana.core.api("DELETE", "/api/team/link")).json).toMatchObject({
      enabled: false,
      self: null,
      route: null,
    });
    expect(await ana.secrets.get(TEAM_KEY_SECRET)).toBeUndefined();
    expect((await ana.core.api("GET", "/api/team/status")).json.members).toEqual([]);
    expect(ana.core.runtime.teamLink!.memberCount()).toBe(0);
  });

  it("pins a teammate only on a valid id, label and P-256 key, and never swaps a key silently", async () => {
    const { url, ana, bo } = await team();
    const eve = await join_(url);
    const add = (body: unknown) => ana.core.api("POST", "/api/team/members", body);
    const good = { id: eve.id, label: "Eve", public_key: eve.publicKey };
    expect((await add({ ...good, id: "core" })).status).toBe(400);
    expect((await add({ ...good, id: "dev_0123456789ab" })).status).toBe(400);
    expect((await add({ ...good, label: "" })).status).toBe(400);
    expect((await add({ ...good, label: "a\u202eb" })).status).toBe(400);
    expect((await add({ ...good, public_key: "AAAA" })).status).toBe(400);
    expect((await add({ id: ana.id, label: "Me", public_key: ana.publicKey })).status).toBe(400);
    // Bo is already pinned: the same id with another key is refused until Bo is removed.
    expect((await add({ id: bo.id, label: "Bo", public_key: eve.publicKey })).status).toBe(400);
    expect((await ana.core.api("GET", "/api/team/status")).json.members).toEqual([
      { id: bo.id, label: "Bo" },
    ]);
    expect((await add(good)).status).toBe(200);
    expect((await ana.core.api("DELETE", `/api/team/members/${eve.id}`)).status).toBe(200);
    expect((await ana.core.api("DELETE", `/api/team/members/${eve.id}`)).status).toBe(404);
    expect((await ana.core.api("DELETE", "/api/team/members/core")).status).toBe(400);
  });

  it("never returns the team private key from any route", async () => {
    const { ana } = await team();
    const key = (await ana.secrets.get(TEAM_KEY_SECRET))!;
    const body = JSON.stringify([
      (await ana.core.api("GET", "/api/team/link")).json,
      (await ana.core.api("GET", "/api/team/status")).json,
    ]);
    expect(body).not.toContain("PRIVATE");
    expect(body).not.toContain(key.replace(/-----[A-Z ]+-----|\s/g, ""));
  });
});
