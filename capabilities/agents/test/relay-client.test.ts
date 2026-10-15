// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// relayCall against real sockets: a RelayServer for the happy and rejected paths, and tiny scripted
// net servers for protocol faults. The timeout runs on fake timers.
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { relayCall } from "../src/relay/client";
import { defaultDataDir, relaySocketPath, resolveRelaySocket } from "../src/relay/protocol";
import { runSelfTest } from "../src/relay/self-test";
import { startRelay, tempDataDir } from "./relay-helpers";

const scripted: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    scripted.splice(0).map((s) => {
      const closed = Promise.withResolvers<void>();
      s.close(() => closed.resolve());
      return closed.promise;
    }),
  );
});

/** A server that runs `onRequest` for each connection after its first data. */
async function scriptedServer(onRequest: (socket: Socket) => void): Promise<string> {
  const dir = await tempDataDir();
  const path = join(dir, "s.sock");
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", () => onRequest(socket));
  });
  scripted.push(server);
  const listening = Promise.withResolvers<void>();
  server.listen(path, () => listening.resolve());
  await listening.promise;
  return path;
}

describe("relayCall", () => {
  it("returns the result of an answered call", async () => {
    const { path } = await startRelay({ handlers: { report: (body) => ({ got: body }) } });
    expect(await relayCall("report", { x: 1 }, { socketPath: path, timeoutMs: 5_000 })).toEqual({
      ok: true,
      result: { got: { x: 1 } },
    });
  });

  it("is unavailable when nothing listens (no socket file, and via dataDir)", async () => {
    const dir = await tempDataDir();
    const missing = join(dir, "nope.sock");
    expect(await relayCall("ping", {}, { socketPath: missing, timeoutMs: 5_000 })).toMatchObject({
      ok: false,
      kind: "unavailable",
    });
    expect(await relayCall("ping", {}, { dataDir: dir, timeoutMs: 5_000 })).toMatchObject({
      kind: "unavailable",
    });
  });

  it("finds the socket under dataDir", async () => {
    const { dataDir } = await startRelay();
    expect(await relayCall("ping", {}, { dataDir, timeoutMs: 5_000 })).toMatchObject({ ok: true });
  });

  it("is rejected, with the code, when the relay answers ok:false", async () => {
    const { path } = await startRelay({
      handlers: {
        report: () => {
          throw new PhoenixError(ErrorCode.INVALID_EVENT, "bad report");
        },
      },
    });
    expect(await relayCall("report", {}, { socketPath: path, timeoutMs: 5_000 })).toEqual({
      ok: false,
      kind: "rejected",
      code: "INVALID_EVENT",
      message: "bad report",
    });
    expect(await relayCall("step", {}, { socketPath: path, timeoutMs: 5_000 })).toMatchObject({
      kind: "rejected",
      code: "not_available",
    });
  });

  it("is unavailable when the server closes without a reply", async () => {
    const path = await scriptedServer((socket) => socket.end());
    expect(await relayCall("ping", {}, { socketPath: path, timeoutMs: 5_000 })).toMatchObject({
      kind: "unavailable",
    });
  });

  it("is a protocol error for unparsable, wrong-version, or wrong-shape replies", async () => {
    for (const reply of ["not json\n", '{"v":2,"ok":true,"result":1}\n', '{"v":1}\n', "[]\n"]) {
      const path = await scriptedServer((socket) => socket.end(reply));
      expect(
        await relayCall("ping", {}, { socketPath: path, timeoutMs: 5_000 }),
        reply,
      ).toMatchObject({
        ok: false,
        kind: "protocol",
      });
    }
  });

  it("is a protocol error for a reply over 2 MiB", async () => {
    const path = await scriptedServer((socket) =>
      socket.write(Buffer.alloc(2 * 1_048_576 + 1, 0x61)),
    );
    expect(await relayCall("ping", {}, { socketPath: path, timeoutMs: 5_000 })).toMatchObject({
      kind: "protocol",
      message: expect.stringContaining("too large"),
    });
  });

  it("times out as unavailable and destroys the socket (fake timers)", async () => {
    const connected = Promise.withResolvers<Socket>();
    const path = await scriptedServer((socket) => connected.resolve(socket)); // never answers
    vi.useFakeTimers();
    const pending = relayCall("ping", {}, { socketPath: path, timeoutMs: 1_500 });
    const server = await connected.promise;
    const gone = Promise.withResolvers<void>();
    server.on("close", () => gone.resolve());
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await pending).toMatchObject({ ok: false, kind: "unavailable" });
    await gone.promise; // the client really dropped the connection
  });
});

describe("resolveRelaySocket", () => {
  it("prefers PHOENIX_RELAY_SOCKET, else the default data dir", () => {
    expect(resolveRelaySocket({ PHOENIX_RELAY_SOCKET: "/x/y.sock" })).toBe("/x/y.sock");
    expect(resolveRelaySocket({ PHOENIX_DATA_DIR: "/d" })).toBe(relaySocketPath("/d"));
    expect(defaultDataDir({ PHOENIX_DATA_DIR: "/d", PHOENIX_ENV: "prod" })).toBe("/d");
    expect(defaultDataDir({ PHOENIX_ENV: "prod" })).toMatch(/\.phoenix[\\/]prod$/);
    expect(defaultDataDir({})).toMatch(/\.phoenix[\\/]dev$/);
  });
});

describe("runSelfTest", () => {
  it("passes against a live relay and names the Core version", async () => {
    const { path } = await startRelay({ coreVersion: "0.1.0-dev" });
    expect(await runSelfTest({ socketPath: path })).toEqual({
      pass: true,
      v: 1,
      coreVersion: "0.1.0-dev",
      socket: path,
      message: "relay v1 answered (Core 0.1.0-dev)",
    });
  });

  it("fails readably when there is no relay", async () => {
    const path = join(await tempDataDir(), "none.sock");
    const result = await runSelfTest({ socketPath: path, timeoutMs: 5_000 });
    expect(result.pass).toBe(false);
    expect(result.socket).toBe(path);
    expect(result.message).toMatch(`no relay at ${path}: `);
  });

  it("fails when the answer is not relay v1", async () => {
    const path = await scriptedServer((socket) =>
      socket.end(`${JSON.stringify({ v: 1, ok: true, result: { v: 7 } })}\n`),
    );
    const result = await runSelfTest({ socketPath: path, timeoutMs: 5_000 });
    expect(result).toMatchObject({ pass: false, v: 7 });
    expect(result.message).toContain("v7");
  });

  it("fails when the relay rejects ping", async () => {
    const path = await scriptedServer((socket) =>
      socket.end(`${JSON.stringify({ v: 1, ok: false, error: { code: "x", message: "nope" } })}\n`),
    );
    expect(await runSelfTest({ socketPath: path, timeoutMs: 5_000 })).toMatchObject({
      pass: false,
      message: expect.stringContaining("nope"),
    });
  });
});
