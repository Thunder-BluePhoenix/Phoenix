// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// RelayServer on real Unix sockets in temp directories. Nothing waits in real time: the idle timer
// is a manual one the test fires, and every wait resolves on an event.
import { chmod, lstat, mkdir, readFile, rename, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  isRelayOp,
  MAX_REQUEST_BYTES,
  relayDir,
  relaySocketPath,
  RELAY_OPS,
  RELAY_VERSION,
} from "../src/relay/protocol";
import { RelayServer, RelayStartError } from "../src/relay/server";
import { exchange, line, manualTimers, parse, startRelay, tempDataDir } from "./relay-helpers";

const call = async (path: string, op: string, body?: unknown) =>
  parse(await exchange(path, line({ v: RELAY_VERSION, op, body })));

describe("RelayServer: filesystem", () => {
  it("creates the dir 0700 and the socket 0600, and removes the socket on stop (idempotent)", async () => {
    const { server, dataDir, path } = await startRelay();
    expect((await stat(relayDir(dataDir))).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(path).toBe(join(dataDir, "relay", "relay.sock"));
    await server.stop();
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it("refuses a relay directory that is group/world accessible", async () => {
    const dataDir = await tempDataDir();
    await mkdir(relayDir(dataDir));
    await chmod(relayDir(dataDir), 0o755);
    const server = new RelayServer({ dataDir, handlers: {} });
    await expect(server.start()).rejects.toThrow(RelayStartError);
    await expect(server.start()).rejects.toThrow(/mode 755/);
    await expect(lstat(server.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a relay directory not owned by the expected uid", async () => {
    const dataDir = await tempDataDir();
    const server = new RelayServer({ dataDir, handlers: {}, uid: process.getuid!() + 1 });
    await expect(server.start()).rejects.toThrow(/not owned by the current user/);
    await expect(lstat(server.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a relay directory that is a symlink", async () => {
    const dataDir = await tempDataDir();
    const elsewhere = await tempDataDir();
    await chmod(elsewhere, 0o700);
    await symlink(elsewhere, relayDir(dataDir));
    const server = new RelayServer({ dataDir, handlers: {} });
    await expect(server.start()).rejects.toThrow(/not a real directory/);
  });

  it("refuses to start over a regular file at the socket path, and leaves the file alone", async () => {
    const dataDir = await tempDataDir();
    await mkdir(relayDir(dataDir), { mode: 0o700 });
    const file = relaySocketPath(dataDir);
    await writeFile(file, "precious");
    const server = new RelayServer({ dataDir, handlers: {} });
    await expect(server.start()).rejects.toThrow(/not a socket/);
    expect(await readFile(file, "utf8")).toBe("precious");
  });

  it("cleans a stale socket left by a dead Core and serves on the same path", async () => {
    const dataDir = await tempDataDir();
    await mkdir(relayDir(dataDir), { mode: 0o700 });
    const path = relaySocketPath(dataDir);
    // A bound socket with no listener behind it, as a killed Core leaves. Closing a Node server
    // unlinks its path, so move the socket file away first, close, then move it back.
    const parked = `${path}.old`;
    const dead = createServer();
    const listening = Promise.withResolvers<void>();
    dead.listen(path, () => listening.resolve());
    await listening.promise;
    await rename(path, parked);
    const closed = Promise.withResolvers<void>();
    dead.close(() => closed.resolve());
    await closed.promise;
    await rename(parked, path);
    expect((await lstat(path)).isSocket()).toBe(true);
    await expect(exchange(path)).resolves.toEqual({ text: "" }); // nobody is listening: it closes at once

    const { server } = await startRelay({ dataDir, handlers: { report: () => "fresh" } });
    expect(await call(server.path, "report")).toEqual({ v: 1, ok: true, result: "fresh" });
  });

  it("refuses when a live Core already serves the path", async () => {
    const first = await startRelay();
    const second = new RelayServer({ dataDir: first.dataDir, handlers: {} });
    await expect(second.start()).rejects.toThrow(
      "another Phoenix Core is already serving this relay",
    );
    // The live server is untouched.
    expect(await call(first.path, "ping")).toMatchObject({ ok: true });
  });
});

describe("RelayServer: protocol", () => {
  it("ping is answered by the server itself", async () => {
    const { path } = await startRelay({ coreVersion: "9.9.9-test" });
    expect(await call(path, "ping")).toEqual({
      v: 1,
      ok: true,
      result: { v: 1, core_version: "9.9.9-test", pid: process.pid },
    });
  });

  it("routes an allowed op to its handler with the body, one reply then close", async () => {
    const handler = vi.fn((body: unknown) => ({ echoed: body }));
    const { path } = await startRelay({ handlers: { report: handler } });
    const reply = await exchange(path, line({ v: 1, op: "report", body: { a: 1 } }));
    expect(reply.text).toBe(
      `${JSON.stringify({ v: 1, ok: true, result: { echoed: { a: 1 } } })}\n`,
    );
    expect(handler).toHaveBeenCalledExactlyOnceWith({ a: 1 });
  });

  it("an op outside the allow-list is refused and its handler is never called", async () => {
    const handler = vi.fn(() => "ran");
    // Handlers under names outside the allow-list (a non-fresh object, so the type system does
    // not stop it) must still be unreachable.
    const smuggled = { report: handler, "approval.decide": handler, audit: handler };
    const { path } = await startRelay({ handlers: smuggled });
    for (const op of [
      "approval.decide",
      "audit",
      "../x",
      "__proto__",
      "constructor",
      "toString",
      "Ping",
      "",
    ]) {
      const reply = await call(path, op);
      expect(reply, op).toMatchObject({
        ok: false,
        error: { code: op === "" ? "invalid_request" : "op_not_allowed" },
      });
    }
    expect(handler).not.toHaveBeenCalled();
    for (const op of RELAY_OPS) expect(isRelayOp(op)).toBe(true);
    expect(isRelayOp("__proto__")).toBe(false);
  });

  it("bad JSON, a non-object and a missing op are invalid_request", async () => {
    const { path } = await startRelay();
    for (const raw of [
      "not json\n",
      "[1,2]\n",
      "null\n",
      '"ping"\n',
      `${JSON.stringify({ v: 1 })}\n`,
      `${JSON.stringify({ v: 1, op: 7 })}\n`,
    ]) {
      expect(parse(await exchange(path, raw)), raw).toMatchObject({
        v: 1,
        ok: false,
        error: { code: "invalid_request" },
      });
    }
  });

  it("a wrong version is unsupported_version and states the server's version", async () => {
    const { path } = await startRelay();
    for (const v of [2, 0, "1", null]) {
      const reply = parse(await exchange(path, line({ v, op: "ping" })));
      expect(reply).toMatchObject({
        ok: false,
        error: { code: "unsupported_version", message: expect.stringContaining("v1") },
      });
    }
    expect(parse(await exchange(path, line({ op: "ping" })))).toMatchObject({
      error: { code: "unsupported_version" },
    });
  });

  it("an allowed op without a handler is not_available", async () => {
    const { path, server } = await startRelay();
    for (const op of RELAY_OPS.filter((o) => o !== "ping")) {
      expect(await call(path, op)).toMatchObject({ ok: false, error: { code: "not_available" } });
    }
    server.setHandler("step", () => 1);
    expect(await call(path, "step")).toEqual({ v: 1, ok: true, result: 1 });
  });

  it("a thrown PhoenixError passes its code and message through", async () => {
    const { path } = await startRelay({
      handlers: {
        report: () => {
          throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "no such approval");
        },
        usage: async () => {
          throw new PhoenixError(ErrorCode.INVALID_EVENT, "bad report");
        },
      },
    });
    expect(await call(path, "report")).toEqual({
      v: 1,
      ok: false,
      error: { code: "RESOURCE_NOT_FOUND", message: "no such approval" },
    });
    expect(await call(path, "usage")).toMatchObject({
      error: { code: "INVALID_EVENT", message: "bad report" },
    });
  });

  it("any other thrown error is internal_error without leaking its message, and is logged", async () => {
    const warn = vi.fn();
    const secretDetail = "/Users/someone/private/path exploded";
    const { path } = await startRelay({
      logger: { warn },
      handlers: {
        report: () => {
          throw new Error(secretDetail);
        },
      },
    });
    const exchanged = await exchange(path, line({ v: 1, op: "report" }));
    expect(parse(exchanged)).toEqual({
      v: 1,
      ok: false,
      error: { code: "internal_error", message: "relay handler failed" },
    });
    expect(exchanged.text).not.toContain("exploded");
    expect(warn).toHaveBeenCalledWith(
      "relay handler failed",
      expect.objectContaining({ op: "report", error: secretDetail }),
    );
  });

  it("ignores bytes after the first newline", async () => {
    const handler = vi.fn(() => "once");
    const { path } = await startRelay({ handlers: { report: handler } });
    const payload = `${line({ v: 1, op: "report" })}${line({ v: 1, op: "report" })}garbage`;
    const reply = await exchange(path, payload);
    expect(reply.text.split("\n").filter(Boolean)).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("RelayServer: limits", () => {
  it("a request line over the cap is too_large, before any newline arrives", async () => {
    const handler = vi.fn();
    const { path } = await startRelay({ maxRequestBytes: 64, handlers: { report: handler } });
    expect(parse(await exchange(path, "x".repeat(65)))).toMatchObject({
      error: { code: "too_large" },
    });
    // A complete but oversized line is refused too.
    const big = line({ v: 1, op: "report", body: "y".repeat(100) });
    expect(parse(await exchange(path, big))).toMatchObject({ error: { code: "too_large" } });
    // Exactly at the cap still works.
    const exact = JSON.stringify({ v: 1, op: "ping" });
    const small = await startRelay({ maxRequestBytes: exact.length });
    expect(parse(await exchange(small.path, `${exact}\n`))).toMatchObject({ ok: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("the real cap is 1 MiB: 1 MiB + 1 bytes without a newline is too_large", async () => {
    const { path } = await startRelay();
    const reply = await exchange(path, Buffer.alloc(MAX_REQUEST_BYTES + 1, 0x61));
    expect(parse(reply)).toMatchObject({ ok: false, error: { code: "too_large" } });
  });

  it("a connection that sends no complete line is closed with idle_timeout", async () => {
    const clock = manualTimers();
    const { path } = await startRelay({ timers: clock.timers, idleTimeoutMs: 1234 });
    const armed = clock.nextArmed();
    const pending = exchange(path, '{"v":1,"op":"pi'); // a partial line, never finished
    await armed;
    expect(clock.pending.at(-1)!.ms).toBe(1234);
    clock.fireAll();
    const reply = await pending; // resolves only because the server closed the connection
    expect(parse(reply)).toMatchObject({ v: 1, ok: false, error: { code: "idle_timeout" } });
  });

  it("the idle timer does not cut off a handler that is still working", async () => {
    const clock = manualTimers();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<string>();
    const { path } = await startRelay({
      timers: clock.timers,
      handlers: {
        "approval.wait": () => {
          started.resolve();
          return release.promise;
        },
      },
    });
    const armed = clock.nextArmed();
    const pending = exchange(path, line({ v: 1, op: "approval.wait", body: {} }));
    await armed;
    await started.promise;
    clock.fireAll(); // the idle timer was cancelled when the line arrived: nothing happens
    expect(clock.pending).toHaveLength(0);
    release.resolve("late decision");
    expect(parse(await pending)).toEqual({ v: 1, ok: true, result: "late decision" });
  });

  it("stop() destroys connections that are still open", async () => {
    const clock = manualTimers();
    const { server, path } = await startRelay({ timers: clock.timers });
    const armed = clock.nextArmed();
    const open = exchange(path);
    await armed;
    await server.stop();
    await expect(open).resolves.toEqual({ text: "" });
  });
});

describe("relay protocol paths", () => {
  it("POSIX uses <dataDir>/relay/relay.sock", () => {
    expect(relaySocketPath("/d", "linux")).toBe(join("/d", "relay", "relay.sock"));
    expect(relaySocketPath("/d", "darwin")).toBe(join("/d", "relay", "relay.sock"));
  });

  it("Windows uses a per-user named pipe: sha256(username), first 16 hex", () => {
    const pipe = relaySocketPath("C:\\data", "win32", "alice");
    expect(pipe).toMatch(/^\\\\\.\\pipe\\phoenix-relay-[0-9a-f]{16}$/);
    expect(pipe).toBe("\\\\.\\pipe\\phoenix-relay-2bd806c97f0e00af");
    expect(relaySocketPath("C:\\other", "win32", "alice")).toBe(pipe);
    expect(relaySocketPath("C:\\data", "win32", "bob")).not.toBe(pipe);
  });
});
