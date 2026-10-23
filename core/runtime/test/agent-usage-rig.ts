// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A real SQLite database, event bus and settings store with an injected clock; the `agents`
// capability port, the kill switch and the AI prices are fakes. No agent, provider or service.
import type { LiveSessionView } from "@phoenix/api";
import type { Price } from "@phoenix/ai-models";
import type { ActiveAgent, SessionView } from "@phoenix/capability-agents";
import { EventBus } from "@phoenix/event-bus";
import { silentLogger } from "@phoenix/logging";
import { AuditLog } from "@phoenix/permissions";
import { EventStore, openDatabase, SettingsStore, type Database } from "@phoenix/persistence";
import type { PhoenixEvent } from "@phoenix/protocol";
import { AgentUsageRuntime } from "../src/agent-usage";

export const T0 = Date.parse("2026-10-20T10:00:00Z");
export const DAY = 86_400_000;

export interface UsageRig {
  usage: AgentUsageRuntime;
  db: Database;
  bus: EventBus;
  settings: SettingsStore;
  clock: { now: number };
  events: PhoenixEvent[];
  port: { reports: ActiveAgent[]; orchestrated: SessionView[]; fail: boolean };
  live: { sessions: LiveSessionView[] };
  aiPrices: { value: Record<string, Price> };
  killSwitch: { engaged: boolean };
  eventStore: EventStore;
  report(body: unknown): { accepted: number };
}

const dbs: Database[] = [];
const runtimes: AgentUsageRuntime[] = [];

export function closeRigs(): void {
  for (const r of runtimes.splice(0)) r.close();
  for (const db of dbs.splice(0)) db.close();
}

export function usageRig(existing?: Database, timeZone = "UTC"): UsageRig {
  const db = existing ?? openDatabase(":memory:");
  if (!existing) dbs.push(db);
  const bus = new EventBus();
  const events: PhoenixEvent[] = [];
  bus.subscribe("rig", "*", (event) => {
    events.push(event);
  });
  const clock = { now: T0 };
  const port: UsageRig["port"] = { reports: [], orchestrated: [], fail: false };
  const live: UsageRig["live"] = { sessions: [] };
  const aiPrices: UsageRig["aiPrices"] = { value: {} };
  const killSwitch = { engaged: false };
  const settings = new SettingsStore(db);
  const eventStore = new EventStore(db);
  const usage = new AgentUsageRuntime({
    db,
    settings,
    bus,
    audit: new AuditLog(db, () => clock.now),
    agents: {
      reports: async () => {
        if (port.fail) throw new Error("agents capability unavailable");
        return port.reports;
      },
      orchestrated: async () => {
        if (port.fail) throw new Error("agents capability unavailable");
        return port.orchestrated;
      },
    },
    liveSessions: () => live.sessions,
    aiPrices: () => aiPrices.value,
    isKillSwitchEngaged: () => killSwitch.engaged,
    logger: silentLogger,
    now: () => clock.now,
    timeZone,
    events: eventStore,
  });
  runtimes.push(usage);
  return {
    usage,
    db,
    bus,
    settings,
    clock,
    events,
    port,
    live,
    aiPrices,
    killSwitch,
    report: (body) => usage.recordTokens(body, () => ""),
    eventStore,
  };
}

/** Lets the bus deliver queued events to subscribers. */
export async function drain(rig: UsageRig): Promise<void> {
  await rig.bus.drain();
}
