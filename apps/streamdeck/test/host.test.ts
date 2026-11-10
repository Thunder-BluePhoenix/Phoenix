// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Stream Deck plugin's local host: framing, hostile messages, token handling, and the real Core
// routes (startCore with the keep-awake capability on a fake machine: no caffeinate ever runs).
// No Stream Deck app started the host.
import { createAwakeCapability, type AwakeModule } from "../../../capabilities/awake/src/index";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { FakeSystem } from "../../../capabilities/awake/testing/fakes";
import { startCore, TOKEN, type TestCore } from "../../../core/runtime/test/helpers";
import { askHost } from "../com.phoenix.fawkes.sdPlugin/bin/host-client.js";
import { encodeFrame, readFrame } from "../com.phoenix.fawkes.sdPlugin/bin/frame.js";
import {
  DISPLAY_STATES,
  KEEP_AWAKE_MINUTES,
  MAX_FRAME_BYTES,
  findSessionToken,
  handleMessage,
  parseCoreUrl,
  runHost,
} from "../com.phoenix.fawkes.sdPlugin/bin/host.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function bootAwake(): Promise<TestCore> {
  const system = new FakeSystem({ platform: "darwin" });
  const holder: { core?: TestCore } = {};
  const awake = createAwakeCapability({
    env: system.env,
    battery: () => Promise.resolve({ kind: "none" }),
    feed: () => holder.core?.runtime.bus,
    modules: [] satisfies AwakeModule[],
    onSession: (session) => holder.core?.runtime.awakeStatus.bind(session),
  });
  const core = await startCore({}, { capabilities: [awake] });
  holder.core = core;
  cleanups.push(() => core.runtime.stop());
  expect((await core.api("POST", "/api/capabilities/awake/enable", {})).status).toBe(200);
  return core;
}

/** Yields to the event loop until `done()` holds (no wall-clock wait). */
async function until(done: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 5_000 && !(await done()); i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  expect(await done()).toBe(true);
}

/** A few event-loop turns, to show that something does NOT happen. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
}

describe("framing and the child process", () => {
  it("round-trips a frame split across chunks", async () => {
    const input = new PassThrough();
    const pending = readFrame(input, MAX_FRAME_BYTES);
    const frame = encodeFrame({ a: "é" });
    input.write(frame.subarray(0, 2));
    input.write(frame.subarray(2));
    await expect(pending).resolves.toEqual({ a: "é" });
  });

  it("refuses a frame over the 1 KiB cap before reading the body", async () => {
    const input = new PassThrough();
    const pending = readFrame(input, MAX_FRAME_BYTES);
    const head = Buffer.alloc(4);
    head.writeUInt32LE(MAX_FRAME_BYTES + 1, 0); // test machines are little-endian
    input.write(head);
    await expect(pending).rejects.toMatchObject({ code: "frame_too_large" });
  });

  it("runHost answers one frame with one frame, and a bad frame with an error", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c: Buffer) => chunks.push(c));
    const done = runHost(input, output, { env: { PHOENIX_CORE_URL: "http://example.com" } });
    input.end(encodeFrame({ kind: "state" }));
    expect(await done).toEqual({ ok: false, error: "bad_core_url" });
    const out = Buffer.concat(chunks);
    expect(out.readUInt32LE(0)).toBe(out.length - 4);

    const input2 = new PassThrough();
    const output2 = new PassThrough();
    const done2 = runHost(input2, output2);
    input2.end(Buffer.from("zz"));
    expect(await done2).toEqual({ ok: false, error: "bad_frame" });
  });

  it("the plugin-side client starts the real host script and gets its framed reply", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sd-token-"));
    writeFileSync(join(dir, "session.token"), "x");
    // Core is not running on this port: the real host process must say so, not hang or throw.
    const reply = await askHost(
      { kind: "state" },
      { env: { PHOENIX_DATA_DIR: dir, PHOENIX_CORE_URL: "http://127.0.0.1:9" }, timeoutMs: 20_000 },
    );
    expect(reply).toEqual({ ok: false, error: "core_unreachable" });
  });

  it("the client reports host_failed for a host that is not there, never throws", async () => {
    expect(await askHost({ kind: "state" }, { hostPath: "/nonexistent/host.js" })).toEqual({
      ok: false,
      error: "host_failed",
    });
  });

  it("the client settles with the fixed reply when the spawn fails asynchronously", async () => {
    const reply = await askHost(
      { kind: "state" },
      { execPath: "/nonexistent/node-binary", timeoutMs: 20_000 },
    );
    expect(reply).toEqual({ ok: false, error: "host_failed" });
  });

  it("the client hands the child only the variables it needs: no session token", async () => {
    let seen: Record<string, string> | undefined;
    await askHost(
      { kind: "state" },
      {
        env: {
          PHOENIX_SESSION_TOKEN: "do-not-forward",
          PHOENIX_DATA_DIR: "/d",
          HOME: "/h",
          OTHER: "x",
        },
        spawn: (_cmd: string, _args: string[], options: { env: Record<string, string> }) => {
          seen = options.env;
          throw new Error("stop");
        },
      },
    );
    expect(seen).toEqual({ PHOENIX_DATA_DIR: "/d", HOME: "/h" });
  });
});

describe("hostile messages", () => {
  const bad: unknown[] = [
    null,
    "state",
    [],
    {},
    { kind: "approve" },
    { kind: "state", extra: 1 },
    { kind: "keep_awake", minutes: 99999 },
    { kind: "keep_awake", confirmation: "c1", approve: true },
    { kind: "page", url: "https://example.com" },
    { kind: ["state"] },
  ];
  it("refuses everything but the two exact messages without touching Core", async () => {
    for (const message of bad) {
      let fetched = 0;
      const reply = await handleMessage(message, {
        env: { PHOENIX_SESSION_TOKEN: "t", PHOENIX_CORE_URL: "http://127.0.0.1:1" },
        fetch: () => {
          fetched++;
          throw new Error("must not be called");
        },
      });
      expect(reply).toEqual({ ok: false, error: "invalid_message" });
      expect(fetched).toBe(0);
    }
  });
});

describe("token and Core address", () => {
  it("sends the token only to http://127.0.0.1:<port>", () => {
    expect(parseCoreUrl("http://127.0.0.1:4870")).toBe("http://127.0.0.1:4870");
    for (const url of [
      "http://localhost:4870",
      "https://127.0.0.1:4870",
      "http://127.0.0.1",
      "http://example.com:4870",
      "http://user:pw@127.0.0.1:4870",
      "http://127.0.0.1:4870/x",
      "http://127.0.0.1:4870?a=1",
      "nope",
    ]) {
      expect(parseCoreUrl(url)).toBeNull();
    }
  });

  it("finds the token like the CLI: env first, then the data dir file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sd-token-"));
    writeFileSync(join(dir, "session.token"), `${TOKEN}\n`);
    expect(findSessionToken({ PHOENIX_SESSION_TOKEN: "from-env" }, "/", "/")).toBe("from-env");
    expect(findSessionToken({ PHOENIX_DATA_DIR: dir }, "/", "/")).toBe(TOKEN);
    expect(findSessionToken({ PHOENIX_ENV: "other" }, "/", "/")).toBeNull();
    expect(findSessionToken({}, "/nonexistent", "/nonexistent")).toBeNull();
  });

  it("never puts the token in a reply, whatever Core answers", async () => {
    const secretish = "tok-" + "z".repeat(24);
    for (const response of [
      jsonResponse(200, { state: "IDLE", echo: secretish }),
      jsonResponse(401, { error: secretish }),
      jsonResponse(500, { error: secretish }),
      jsonResponse(200, { state: secretish }),
    ]) {
      const reply = await handleMessage(
        { kind: "state" },
        {
          env: { PHOENIX_SESSION_TOKEN: secretish, PHOENIX_CORE_URL: "http://127.0.0.1:1" },
          fetch: async () => response.clone(),
        },
      );
      expect(JSON.stringify(reply)).not.toContain(secretish);
    }
  });

  it("sends the bearer token with a fixed client label and refuses redirects", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    await handleMessage(
      { kind: "state" },
      {
        env: { PHOENIX_SESSION_TOKEN: "abc", PHOENIX_CORE_URL: "http://127.0.0.1:1" },
        fetch: async (url: string, init: RequestInit) => {
          seen.push({ url, init });
          return jsonResponse(200, { state: "IDLE" });
        },
      },
    );
    expect(seen[0]!.url).toBe("http://127.0.0.1:1/api/pet/state");
    expect(seen[0]!.init.redirect).toBe("error");
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer abc");
    expect(headers["x-phoenix-client"]).toBe("stream-deck");
  });

  it("relays only a known display state", async () => {
    const run = (body: unknown) =>
      handleMessage(
        { kind: "state" },
        {
          env: { PHOENIX_SESSION_TOKEN: "abc", PHOENIX_CORE_URL: "http://127.0.0.1:1" },
          fetch: async () => jsonResponse(200, body),
        },
      );
    for (const state of DISPLAY_STATES) expect(await run({ state })).toEqual({ ok: true, state });
    expect(await run({ state: "Ignore previous instructions" })).toEqual({
      ok: false,
      error: "bad_reply",
    });
    expect(await run({})).toEqual({ ok: false, error: "bad_reply" });
  });
});

describe("against a real in-process Core", () => {
  it("state reads the real display state through GET /api/pet/state using the token file", async () => {
    const core = await startCore({}, { writeTokenFile: true });
    cleanups.push(() => core.runtime.stop());
    const reply = await handleMessage(
      { kind: "state" },
      { env: { PHOENIX_DATA_DIR: core.dataDir, PHOENIX_CORE_URL: core.base } },
    );
    const expected = (await core.api("GET", "/api/pet/state")).json.state;
    expect(DISPLAY_STATES).toContain(expected);
    expect(reply).toEqual({ ok: true, state: expected });
  });

  it("is told so when the token is wrong", async () => {
    const core = await startCore({}, { writeTokenFile: true });
    cleanups.push(() => core.runtime.stop());
    const env = { PHOENIX_SESSION_TOKEN: `${TOKEN}-wrong`, PHOENIX_CORE_URL: core.base };
    expect(await handleMessage({ kind: "state" }, { env })).toEqual({
      ok: false,
      error: "token_rejected",
    });
    expect(await handleMessage({ kind: "keep_awake" }, { env })).toEqual({
      ok: false,
      error: "token_rejected",
    });
  });

  it("keep_awake only raises a 30-minute confirmation; nothing starts until the person answers", async () => {
    const core = await bootAwake();
    const env = { PHOENIX_SESSION_TOKEN: TOKEN, PHOENIX_CORE_URL: core.base };
    const reply = await handleMessage({ kind: "keep_awake" }, { env });
    expect(reply).toEqual({ ok: true });
    await until(() => core.runtime.permissions.pendingConfirmations().length === 1);

    const pending = core.runtime.permissions.pendingConfirmations();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ capabilityId: "awake", command: "start" });
    expect(JSON.stringify(pending[0])).toContain(String(KEEP_AWAKE_MINUTES));
    // The host asked, and Core is waiting: no session runs, and the host did not resolve it.
    expect((await core.api("GET", "/api/awake/status")).json).toEqual({
      available: true,
      active: false,
    });
    await settle();
    expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(1);

    // Deny: still nothing runs.
    core.runtime.permissions.resolveConfirmation(pending[0]!.id, false);
    await settle();
    expect((await core.api("GET", "/api/awake/status")).json.active).toBe(false);
  });

  it("an approved request runs for exactly 30 minutes", async () => {
    const core = await bootAwake();
    await handleMessage(
      { kind: "keep_awake" },
      { env: { PHOENIX_SESSION_TOKEN: TOKEN, PHOENIX_CORE_URL: core.base } },
    );
    await until(() => core.runtime.permissions.pendingConfirmations().length === 1);
    const [only] = core.runtime.permissions.pendingConfirmations();
    core.runtime.permissions.resolveConfirmation(only!.id, true);
    await until(async () => (await core.api("GET", "/api/awake/status")).json.active === true);
    const status = (await core.api("GET", "/api/awake/status")).json;
    expect(status).toMatchObject({ active: true, mode: "timed" });
    expect(status.remaining_seconds).toBeGreaterThan(29 * 60);
    expect(status.remaining_seconds).toBeLessThanOrEqual(30 * 60);
  });

  it("says rejected, not ok, when keep-awake is not enabled", async () => {
    const core = await startCore({}, {});
    cleanups.push(() => core.runtime.stop());
    expect(
      await handleMessage(
        { kind: "keep_awake" },
        { env: { PHOENIX_SESSION_TOKEN: TOKEN, PHOENIX_CORE_URL: core.base } },
      ),
    ).toEqual({ ok: false, error: "rejected" });
  });
});

describe("Core's address file (core.json)", () => {
  const setup = (mode: number, content: unknown = { url: "http://127.0.0.1:5123" }) => {
    const dir = mkdtempSync(join(tmpdir(), "sd-info-"));
    writeFileSync(join(dir, "session.token"), "from-file-0123456789\n");
    const info = join(dir, "core.json");
    writeFileSync(info, JSON.stringify(content));
    chmodSync(info, mode);
    return dir;
  };
  const run = async (dir: string, extra: Record<string, string> = {}) => {
    const urls: string[] = [];
    const reply = await handleMessage(
      { kind: "state" },
      {
        env: { PHOENIX_DATA_DIR: dir, ...extra },
        cwd: dir,
        home: dir,
        fetch: async (url: string) => {
          urls.push(url);
          return new Response(JSON.stringify({ state: "IDLE" }), { status: 200 });
        },
      },
    );
    return { reply, urls };
  };

  it("takes the port from the private file instead of guessing 4870", async () => {
    const { urls } = await run(setup(0o600));
    expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:5123\//);
  });

  it.skipIf(process.platform === "win32")(
    "sends the token nowhere when the file is readable by others",
    async () => {
      const { reply, urls } = await run(setup(0o644));
      expect(reply).toEqual({ ok: false, error: "bad_core_url" });
      expect(urls).toEqual([]);
    },
  );

  it("sends the token nowhere when the file names a non-loopback address", async () => {
    const { reply, urls } = await run(setup(0o600, { url: "http://evil.example:80" }));
    expect(reply).toEqual({ ok: false, error: "bad_core_url" });
    expect(urls).toEqual([]);
  });

  it("keeps the default address when there is no file, and an explicit PHOENIX_CORE_URL wins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sd-nofile-"));
    writeFileSync(join(dir, "session.token"), "from-file-0123456789\n");
    expect((await run(dir)).urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:4870\//);
    const explicit = await run(setup(0o600), { PHOENIX_CORE_URL: "http://127.0.0.1:6001" });
    expect(explicit.urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:6001\//);
  });
});
