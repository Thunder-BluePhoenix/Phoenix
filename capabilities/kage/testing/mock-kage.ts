// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for Kage's backend (FastAPI, ~/kage/backend) with the routes,
// auth header and status values Phoenix uses. Tests drive meetings through
// the pipeline with advance().
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { KageMeeting } from "../src";

export const MOCK_KAGE_KEY = "kage-test-key";

export async function startMockKage() {
  const meetings = new Map<number, KageMeeting>();
  let nextId = 1;
  let down = false;
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (down) return void req.socket.destroy();
    const url = new URL(req.url ?? "/", "http://kage");
    if (url.pathname === "/health") return send(200, { status: "ok" });
    if (req.headers["x-api-key"] !== MOCK_KAGE_KEY)
      return send(401, { detail: "authentication required" });
    if (url.pathname === "/api/meetings" && req.method === "GET") {
      return send(
        200,
        [...meetings.values()].sort((a, b) => b.id - a.id),
      );
    }
    const m = /^\/api\/meetings\/(\d+)$/.exec(url.pathname);
    if (m && req.method === "GET") {
      const meeting = meetings.get(Number(m[1]));
      return meeting ? send(200, meeting) : send(404, { detail: "meeting not found" });
    }
    send(404, { detail: "Not Found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    meetings,
    /** Simulates an upload (what the extension or bot does when a call ends). */
    upload(title = "Standup", status = "uploaded"): KageMeeting {
      const m: KageMeeting = {
        id: nextId++,
        title,
        status,
        created_at: "2026-10-04 09:00:00",
        duration_seconds: null,
        participants: ["Ada", "Linus"],
      };
      meetings.set(m.id, m);
      return m;
    },
    /** Moves a meeting to `status`, filling in what Kage would have produced by then. */
    advance(id: number, status: string): void {
      const m = meetings.get(id)!;
      m.status = status;
      if (["transcribed", "summarizing", "summarized"].includes(status)) {
        m.transcript = "We agreed to ship the Kage adapter.";
        m.duration_seconds = 1800;
        m.extractive_summary = "Ship the Kage adapter.";
        m.keywords = ["kage", "adapter"];
      }
      if (status === "summarized") {
        m.summary = "The team agreed to ship the Kage adapter this week.";
        m.key_decisions = ["Ship the Kage adapter"];
        m.action_items = [{ text: "Write the docs", owner: "Ada", due: null }];
      }
      if (status === "failed") m.error_message = "whisper crashed";
    },
    /** Simulates an outage: connections are dropped until set back to false. */
    setDown(value: boolean) {
      down = value;
    },
    close: () =>
      new Promise<void>((r) => {
        // Core's poller keeps connections alive; without this, close() waits ~3 s for them.
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

export type MockKage = Awaited<ReturnType<typeof startMockKage>>;
