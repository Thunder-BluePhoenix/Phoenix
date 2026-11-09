// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 70: lets a window that is NOT the main one (the floating Fawkes window, the island) follow
// a running demo. While the real Core is online it polls `GET /api/demo/view` on the real client
// it already has; a running demo's state and tasks are shown, and the real ones come back the
// moment the answer says the demo ended, is malformed, or the request fails. Nothing is stored and
// no URL or token is involved. The main window does not mount this: it switches clients itself.
import { useEffect, useState, type ReactNode } from "react";
import { useClient, useConnection } from "./context";
import { DEMO_VIEW_PATH, DemoViewContext, parseDemoView, type DemoViewData } from "./demo-view";

export const DEMO_POLL_MS = 1_500;

export interface DemoPollTimers {
  setInterval(run: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}
const realTimers: DemoPollTimers = {
  setInterval: (run, ms) => globalThis.setInterval(run, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

export function DemoFollowProvider({
  children,
  timers = realTimers,
  intervalMs = DEMO_POLL_MS,
}: {
  children: ReactNode;
  timers?: DemoPollTimers;
  intervalMs?: number;
}) {
  const client = useClient();
  const status = useConnection();
  const [view, setView] = useState<DemoViewData | null>(null);
  const online = status === "online";

  useEffect(() => {
    if (!online) {
      setView(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      client
        .request("GET", DEMO_VIEW_PATH)
        .then(parseDemoView, () => null)
        .then((next) => {
          if (!cancelled) setView(next);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    poll();
    const handle = timers.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      timers.clearInterval(handle);
      setView(null);
    };
  }, [client, online, timers, intervalMs]);

  return <DemoViewContext.Provider value={view}>{children}</DemoViewContext.Provider>;
}
