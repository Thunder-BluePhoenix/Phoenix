// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createCalendarCapability, type CalendarEvent } from "@phoenix/capability-calendar";
import { defaults } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import { afterEach, describe, expect, it } from "vitest";
import { CALENDAR_REMINDERS_KEY, settingsReminderStore } from "../src/calendar";
import { PhoenixRuntime } from "../src";
import { TOKEN, type TestCore } from "./helpers";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const MINUTE = 60_000;

const meeting = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "fake:standup",
  title: "Daily standup",
  start: new Date(NOW + 3 * MINUTE).toISOString(),
  end: new Date(NOW + 33 * MINUTE).toISOString(),
  timezone: "UTC",
  attendees: ["alex@example.com"],
  private: false,
  ...over,
});
const planning = () =>
  meeting({ id: "fake:planning", title: "Quarterly planning", attendees: ["sam@example.com"] });

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A real Core on `databasePath` with the real calendar capability reading a fake calendar. Like
 * `main.ts`, the runtime is assigned before `start()`, because a calendar that was enabled before
 * the restart is re-enabled (and reads its stored reminder keys) during `start()`.
 */
async function boot(databasePath: string, events: CalendarEvent[]): Promise<TestCore> {
  let runtime: PhoenixRuntime | undefined;
  const capability = createCalendarCapability({
    adapters: { macos: { list: () => Promise.resolve(events) } },
    now: () => NOW,
    sleep: (_ms, abort) => {
      const wait = Promise.withResolvers<void>();
      abort.addEventListener("abort", () => wait.resolve(), { once: true });
      return wait.promise;
    },
    reminderStore: settingsReminderStore(() => runtime!.settings),
  });
  runtime = new PhoenixRuntime({
    config: { ...defaults("dev"), port: 0, dataDir: dirname(databasePath) },
    logger: silentLogger,
    databasePath,
    token: TOKEN,
    writeTokenFile: false,
    capabilities: [capability],
  });
  cleanups.push(() => runtime!.stop());
  const { port } = await runtime.start();
  const base = `http://127.0.0.1:${port}`;
  const api: TestCore["api"] = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
  };
  const core: TestCore = { runtime, port, base, api, dataDir: dirname(databasePath) };
  expect(
    (await api("POST", "/api/capabilities/calendar/config", { config: { macos: true } })).status,
  ).toBe(200);
  expect((await api("POST", "/api/capabilities/calendar/enable", {})).status).toBe(200);
  return core;
}

async function bodies(c: TestCore): Promise<string[]> {
  const res = await c.api("GET", "/api/notifications");
  return (res.json.notifications as { body: string | null }[]).map((n) => n.body ?? "");
}

async function tick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

async function until(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 2_000; i++) {
    if (await done()) return;
    await tick();
  }
  expect(await done()).toBe(true);
}

const quiet = async () => {
  for (let i = 0; i < 300; i++) await tick();
};

function freshDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-calendar-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "core.sqlite");
}

const count = (all: string[], title: string) => all.filter((b) => b.includes(title)).length;

describe("calendar reminders survive a Core restart", () => {
  it("does not remind again inside the window after a restart, but reminds for another event", async () => {
    const databasePath = freshDatabase();
    const first = await boot(databasePath, [meeting()]);
    await until(async () => count(await bodies(first), "Daily standup") === 1);
    await first.runtime.stop();

    // Same database, same five-minute window: the standup must not be announced again.
    const second = await boot(databasePath, [meeting(), planning()]);
    await until(async () => count(await bodies(second), "Quarterly planning") === 1);
    await quiet();
    const all = await bodies(second);
    expect(count(all, "Daily standup")).toBe(1);
    expect(count(all, "Quarterly planning")).toBe(1);
  });

  it("stores only opaque keys and start times, never a title, id, attendee or link", async () => {
    const databasePath = freshDatabase();
    const c = await boot(databasePath, [meeting({ url: "https://example.com/secret-room" })]);
    await until(async () => count(await bodies(c), "Daily standup") === 1);
    const stored = c.runtime.settings.get<{
      version: number;
      sent: { key: string; start: number }[];
    }>(CALENDAR_REMINDERS_KEY, { version: 0, sent: [] });
    expect(stored.version).toBe(1);
    expect(stored.sent).toHaveLength(1);
    expect(Object.keys(stored.sent[0]!).sort()).toEqual(["key", "start"]);
    expect(stored.sent[0]!.start).toBe(NOW + 3 * MINUTE);
    const raw = JSON.stringify(stored);
    for (const secret of ["Daily standup", "fake:standup", "alex@example.com", "secret-room"])
      expect(raw).not.toContain(secret);
    // The same value is what is in the database file.
    const row = c.runtime.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(CALENDAR_REMINDERS_KEY) as { value: string };
    for (const secret of ["Daily standup", "standup", "alex", "example.com"])
      expect(row.value).not.toContain(secret);
  });

  it("ignores corrupt stored data and still reminds once", async () => {
    for (const corrupt of [
      "{not json",
      JSON.stringify("a string"),
      JSON.stringify({ version: 2, sent: [] }),
      JSON.stringify({ version: 1, sent: "nope" }),
      JSON.stringify({ version: 1, sent: [null, 7, { key: "short", start: 1 }, { key: 5 }] }),
    ]) {
      const databasePath = freshDatabase();
      const seed = await boot(databasePath, []);
      seed.runtime.db
        .prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(CALENDAR_REMINDERS_KEY, corrupt);
      await seed.runtime.stop();

      const c = await boot(databasePath, [meeting()]);
      await until(async () => count(await bodies(c), "Daily standup") === 1);
      await quiet();
      expect(count(await bodies(c), "Daily standup")).toBe(1);
      await c.runtime.stop();
      // The corrupt value was replaced by a valid one.
      const after = await boot(databasePath, [meeting()]);
      await quiet();
      expect(count(await bodies(after), "Daily standup")).toBe(1);
      await after.runtime.stop();
    }
  });
});
