// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shared helpers for the relay tests: temp data dirs (short paths: a macOS unix socket path must be
// under 104 characters), a raw one-shot socket exchange, and a manual timer the test fires itself.
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { RelayServer, type RelayServerOptions, type RelayTimers } from "../src/relay/server";

const dirs: string[] = [];
const servers: RelayServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

export async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "phr-"));
  dirs.push(dir);
  return dir;
}

/** Starts a RelayServer in a fresh temp data dir; it is stopped after the test. */
export async function startRelay(
  options: Partial<RelayServerOptions> = {},
): Promise<{ server: RelayServer; dataDir: string; path: string }> {
  const dataDir = options.dataDir ?? (await tempDataDir());
  const server = new RelayServer({ handlers: {}, ...options, dataDir });
  servers.push(server);
  const { path } = await server.start();
  return { server, dataDir, path };
}

/** Everything the server sent before it closed the connection. */
export interface Exchange {
  text: string;
}

/** Connects, writes `payload` (if any), and resolves when the server closes the connection. */
export function exchange(path: string, payload?: string | Buffer): Promise<Exchange> {
  const done = Promise.withResolvers<Exchange>();
  const chunks: Buffer[] = [];
  const socket = connect(path);
  socket.on("connect", () => {
    if (payload !== undefined) socket.write(payload);
  });
  socket.on("data", (c: Buffer) => chunks.push(c));
  // A server that answers and closes early can reset an in-flight large write; the reply is what counts.
  socket.on("error", () => {});
  socket.on("close", () => done.resolve({ text: Buffer.concat(chunks).toString("utf8") }));
  return done.promise;
}

export const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

export const parse = (reply: Exchange): unknown => JSON.parse(reply.text.split("\n")[0]!);

/** Timers the test fires by hand. */
export function manualTimers() {
  const pending: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  let armed = Promise.withResolvers<void>();
  const timers: RelayTimers = {
    after(ms, fn) {
      const entry = { ms, fn, cancelled: false };
      pending.push(entry);
      armed.resolve();
      return () => {
        entry.cancelled = true;
      };
    },
  };
  return {
    timers,
    pending,
    /** Resolves when the server arms its next timer; call it BEFORE connecting. */
    nextArmed() {
      armed = Promise.withResolvers<void>();
      return armed.promise;
    },
    /** Fires every timer that has not been cancelled. */
    fireAll() {
      for (const entry of pending.splice(0)) if (!entry.cancelled) entry.fn();
    },
  };
}
