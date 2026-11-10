// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The native-messaging host: framing, the 64 KiB cap, hostile messages, and the real Core route
// (startCore). No browser started the host.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, TOKEN } from "../../../core/runtime/test/helpers";
import {
  MAX_FRAME_BYTES,
  encodeFrame,
  findSessionToken,
  handleMessage,
  parseCoreUrl,
  readFrame,
  runHost,
} from "../host/host.js";

const good = { kind: "page", url: "https://example.com/a", title: "A page" };

function rawFrame(length: number, body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32LE(length, 0); // test machines are little-endian (arm64, x86-64)
  return Buffer.concat([head, body]);
}

async function run(bytes: Buffer, deps: Record<string, unknown> = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (c: Buffer) => chunks.push(c));
  const done = runHost(input, output, deps);
  input.end(bytes);
  const reply = await done;
  const out = Buffer.concat(chunks);
  expect(out.readUInt32LE(0)).toBe(out.length - 4);
  return { reply, wire: JSON.parse(out.subarray(4).toString("utf8")) };
}

describe("framing", () => {
  it("round-trips a frame split across chunks", async () => {
    const input = new PassThrough();
    const pending = readFrame(input);
    const frame = encodeFrame({ a: "é" });
    input.write(frame.subarray(0, 2));
    input.write(frame.subarray(2, 6));
    input.write(frame.subarray(6));
    await expect(pending).resolves.toEqual({ a: "é" });
  });

  it("refuses a length over the cap before reading the body", async () => {
    const input = new PassThrough();
    const pending = readFrame(input);
    const head = Buffer.alloc(4);
    head.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);
    input.write(head); // no body follows: the cap is decided from the length alone
    await expect(pending).rejects.toMatchObject({ code: "frame_too_large" });
  });

  it("accepts a frame of exactly the cap", async () => {
    const body = Buffer.from(JSON.stringify({ pad: "x".repeat(MAX_FRAME_BYTES - 20) }));
    expect(body.length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    const input = new PassThrough();
    const pending = readFrame(input);
    input.write(rawFrame(body.length, body));
    await expect(pending).resolves.toHaveProperty("pad");
  });

  it("rejects an empty stream, a truncated body and invalid JSON", async () => {
    for (const [bytes, code] of [
      [Buffer.alloc(0), "no_message"],
      [rawFrame(50, Buffer.from('{"a":')), "truncated"],
      [rawFrame(3, Buffer.from("nop")), "bad_json"],
    ] as const) {
      const input = new PassThrough();
      const pending = readFrame(input);
      input.end(bytes);
      await expect(pending).rejects.toMatchObject({ code });
    }
  });

  it("answers an oversized or malformed frame with an error reply and never calls Core", async () => {
    let calls = 0;
    const fetchStub = async () => {
      calls++;
      return new Response("{}");
    };
    const big = Buffer.alloc(4);
    big.writeUInt32LE(0xffffffff, 0);
    expect((await run(big, { fetch: fetchStub })).wire).toEqual({
      ok: false,
      error: "frame_too_large",
    });
    expect((await run(rawFrame(3, Buffer.from("nop")), { fetch: fetchStub })).wire).toEqual({
      ok: false,
      error: "bad_frame",
    });
    expect(calls).toBe(0);
  });
});

describe("hostile messages", () => {
  const env = { PHOENIX_SESSION_TOKEN: ["tok", "for", "test", "0123456789"].join("-") };
  it("refuses everything but the one page message, without calling Core", async () => {
    let calls = 0;
    const deps = {
      env,
      fetch: async () => {
        calls++;
        return new Response("{}");
      },
    };
    for (const bad of [
      { kind: "approve", id: "1" },
      { kind: "page", url: "file:///etc/passwd", title: "x" },
      { ...good, route: "/api/shutdown" },
      { ...good, authorization: "Bearer x" },
      { ...good, title: "a\u202eb" },
      [good],
      "page",
      null,
      42,
    ]) {
      expect(await handleMessage(bad, deps), JSON.stringify(bad)).toEqual({
        ok: false,
        error: "invalid_message",
      });
    }
    expect(calls).toBe(0);
  });

  it("only ever talks to http://127.0.0.1:<port>", async () => {
    expect(parseCoreUrl("http://127.0.0.1:4870")).toBe("http://127.0.0.1:4870");
    for (const bad of [
      "https://127.0.0.1:4870",
      "http://localhost:4870",
      "http://example.com:4870",
      "http://127.0.0.1",
      "http://127.0.0.1:4870/x",
      "http://u:p@127.0.0.1:4870",
      "http://127.0.0.1:4870/?a=1",
      "nonsense",
    ]) {
      expect(parseCoreUrl(bad), bad).toBeNull();
    }
    let calls = 0;
    const reply = await handleMessage(good, {
      env: { ...env, PHOENIX_CORE_URL: "http://evil.example:80" },
      fetch: async () => {
        calls++;
        return new Response("{}");
      },
    });
    expect(reply).toEqual({ ok: false, error: "bad_core_url" });
    expect(calls).toBe(0);
  });

  it("never returns the token, in a success or any failure, and sends it only as the bearer", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const secret = env.PHOENIX_SESSION_TOKEN;
    const cases: Response[] = [
      new Response(JSON.stringify({ page: { id: `pn_${"a".repeat(24)}` } })),
      new Response(`{"message":"bad ${secret}"}`, { status: 400 }),
      new Response(`${secret}`, { status: 401 }),
      new Response(`${secret}`, { status: 500 }),
      new Response(`not json ${secret}`),
    ];
    for (const response of cases) {
      const reply = await handleMessage(good, {
        env,
        fetch: async (url: string, init: RequestInit) => {
          seen.push({ url, init });
          return response;
        },
      });
      expect(JSON.stringify(reply)).not.toContain(secret);
    }
    expect(seen[0]!.url).toBe("http://127.0.0.1:4870/api/companion/page");
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${secret}`,
    );
    expect(seen[0]!.init.redirect).toBe("error");
    // The body Core receives holds only the three fields, not the kind or the token.
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({
      url: good.url,
      title: good.title,
    });
  });

  it("reports an unreachable Core and a missing token as codes", async () => {
    expect(
      await handleMessage(good, {
        env,
        fetch: async () => {
          throw new Error(`connect refused ${env.PHOENIX_SESSION_TOKEN}`);
        },
      }),
    ).toEqual({ ok: false, error: "core_unreachable" });
    const empty = mkdtempSync(join(tmpdir(), "phoenix-host-"));
    expect(await handleMessage(good, { env: {}, cwd: empty, home: empty })).toEqual({
      ok: false,
      error: "token_missing",
    });
  });
});

describe("token lookup (same order as the CLI)", () => {
  it("reads PHOENIX_SESSION_TOKEN, then <data dir>/session.token", () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-host-"));
    writeFileSync(join(dir, "session.token"), "from-file-0123456789\n");
    expect(findSessionToken({ PHOENIX_SESSION_TOKEN: " env-tok " }, dir, dir)).toBe("env-tok");
    expect(findSessionToken({ PHOENIX_DATA_DIR: dir }, "/nowhere", "/nowhere")).toBe(
      "from-file-0123456789",
    );
    mkdtempSync(join(dir, "x"));
    expect(findSessionToken({}, dir, "/nowhere")).toBeNull();
    expect(findSessionToken({ PHOENIX_ENV: "weird", PHOENIX_DATA_DIR: dir }, dir, dir)).toBeNull();
  });
});

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("host against a real in-process Core", () => {
  it("stores the page through POST /api/companion/page using the token file", async () => {
    const core = await startCore({}, { writeTokenFile: true });
    cleanups.push(() => core.runtime.stop());
    const { reply } = await run(encodeFrame({ ...good, selection: "chosen" }), {
      env: { PHOENIX_DATA_DIR: core.dataDir, PHOENIX_CORE_URL: core.base },
    });
    expect(reply).toMatchObject({ ok: true });
    const list = (await core.api("GET", "/api/companion/pages")).json.pages;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ url: good.url, title: good.title, selected_text: "chosen" });
  });

  it("is told so when the token is wrong", async () => {
    const core = await startCore({}, { writeTokenFile: true });
    cleanups.push(() => core.runtime.stop());
    const { reply } = await run(encodeFrame(good), {
      env: { PHOENIX_SESSION_TOKEN: `${TOKEN}-wrong`, PHOENIX_CORE_URL: core.base },
    });
    expect(reply).toEqual({ ok: false, error: "token_rejected" });
    expect((await core.api("GET", "/api/companion/pages")).json.pages).toHaveLength(0);
  });
});

describe("Core's address file (core.json)", () => {
  const setup = (mode: number, content: unknown = { url: "http://127.0.0.1:5123" }) => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-host-info-"));
    writeFileSync(join(dir, "session.token"), "from-file-0123456789\n");
    const info = join(dir, "core.json");
    writeFileSync(info, JSON.stringify(content));
    chmodSync(info, mode);
    return dir;
  };
  const run = async (dir: string, extra: Record<string, string> = {}) => {
    const urls: string[] = [];
    const reply = await handleMessage(good, {
      env: { PHOENIX_DATA_DIR: dir, ...extra },
      cwd: dir,
      home: dir,
      fetch: async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ id: "pn_x" }), { status: 200 });
      },
    });
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
    const dir = mkdtempSync(join(tmpdir(), "phoenix-host-nofile-"));
    writeFileSync(join(dir, "session.token"), "from-file-0123456789\n");
    expect((await run(dir)).urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:4870\//);
    const explicit = await run(setup(0o600), { PHOENIX_CORE_URL: "http://127.0.0.1:6001" });
    expect(explicit.urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:6001\//);
  });
});
