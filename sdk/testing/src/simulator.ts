// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createEvent, type NewEvent } from "@phoenix/protocol";
import { SCENARIOS, type EventInput } from "@phoenix/sdk-events";

export interface CoreTarget {
  url: string;
  token: string;
}

export interface SimulateOptions {
  /** 2 = twice as fast; Infinity = no delays. */
  speed?: number;
  log?: (line: string) => void;
  signal?: AbortSignal;
}

/** Publishes one event to Phoenix Core through POST /api/events. */
export async function publish(
  core: CoreTarget,
  source: string,
  input: EventInput,
): Promise<string> {
  const event = createEvent({ ...input, source } as NewEvent);
  const res = await fetch(`${core.url.replace(/\/$/, "")}/api/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${core.token}`, "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok)
    throw new Error(`${res.status} ${body.code ?? ""}: ${body.message ?? res.statusText}`);
  return event.event_id;
}

/** Plays a named scenario against a running core. */
export async function simulate(
  core: CoreTarget,
  name: string,
  options: SimulateOptions = {},
): Promise<number> {
  const scenario = SCENARIOS[name];
  if (!scenario)
    throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(", ")}`);
  const speed = options.speed ?? 1;
  let sent = 0;
  for (const s of scenario.steps) {
    const wait = speed === Infinity ? 0 : s.afterMs / speed;
    if (wait > 0) await sleep(wait, options.signal);
    if (options.signal?.aborted) break;
    await publish(core, s.source, s.event);
    options.log?.(`→ ${s.source.padEnd(9)} ${s.event.event_type}`);
    sent++;
  }
  return sent;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
