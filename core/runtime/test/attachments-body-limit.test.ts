// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one larger request body of Core (Phase 62): POST /api/attachments may carry an image, so it
// may read ATTACHMENT_BODY_MAX_BYTES. Every other route keeps MAX_BODY_BYTES, the limit is enforced
// on Content-Length AND on the running byte count of a chunked body, and it is granted only after
// authentication. Raw requests: fetch would hide the headers these cases are about.
import { request } from "node:http";
import { ATTACHMENT_BODY_MAX_BYTES, MAX_BODY_BYTES } from "@phoenix/api";
import { afterEach, describe, expect, it } from "vitest";
import { TOKEN, startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});
const boot = async () => (core = await startCore());

interface Sent {
  path: string;
  method?: string;
  authenticated?: boolean;
  /** Declared Content-Length; absent = chunked transfer encoding. */
  declared?: number;
  /** How many body bytes this client actually writes. */
  write: number;
  /** Wait for the answer before writing anything. */
  waitFirst?: boolean;
}

/** Sends a request and resolves with the status code (0 = the connection died without an answer). */
function send(port: number, o: Sent): Promise<number> {
  const answered = Promise.withResolvers<number>();
  const req = request(
    {
      host: "127.0.0.1",
      port,
      path: o.path,
      method: o.method ?? "POST",
      headers: {
        ...(o.authenticated === false ? {} : { authorization: `Bearer ${TOKEN}` }),
        "content-type": "application/json",
        ...(o.declared !== undefined ? { "content-length": String(o.declared) } : {}),
      },
    },
    (res) => {
      res.resume();
      answered.resolve(res.statusCode ?? 0);
    },
  );
  req.on("error", () => answered.resolve(0));
  req.flushHeaders();
  const chunk = "x".repeat(64 * 1024);
  for (let written = 0; written < o.write; written += chunk.length)
    req.write(chunk.slice(0, Math.min(chunk.length, o.write - written)));
  if (o.declared === undefined || o.write >= o.declared) req.end();
  return answered.promise.finally(() => req.destroy());
}

describe("request body limits", () => {
  it("names the constants: 256 KiB for everything, 7 MiB for POST /api/attachments only", () => {
    expect(MAX_BODY_BYTES).toBe(256 * 1024);
    expect(ATTACHMENT_BODY_MAX_BYTES).toBe(7 * 1024 * 1024);
    // A 5 MiB image in base64, plus room for the JSON envelope.
    expect(Math.ceil((5 * 1024 * 1024 * 4) / 3)).toBeLessThan(ATTACHMENT_BODY_MAX_BYTES - 300_000);
  });

  it("another route still answers 413 at 257 KiB (known length and chunked)", async () => {
    const { port } = await boot();
    const size = 257 * 1024;
    for (const path of ["/api/events", "/api/attachments/ask", "/api/ai/settings"]) {
      expect(await send(port, { path, declared: size, write: 1024 })).toBe(413);
      expect(await send(port, { path, write: size })).toBe(413);
    }
  });

  it("the attachment route takes more than 256 KiB, up to its own cap", async () => {
    const { api } = await boot();
    // A valid 1 MiB PNG, far above the default limit.
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(1024 * 1024),
    ]);
    const res = await api("POST", "/api/attachments", {
      name: "big.png",
      kind: "image",
      mime: "image/png",
      origin: "drop",
      content: png.toString("base64"),
    });
    expect(res.status).toBe(201);
    expect(res.json.bytes).toBe(png.length);
  });

  it("answers 413 just above the cap, with Content-Length and without, and 400 (not 413) at the cap", async () => {
    const { port, base } = await boot();
    const over = ATTACHMENT_BODY_MAX_BYTES + 1;
    // Known length: refused from the header, before the body is read.
    expect(await send(port, { path: "/api/attachments", declared: over, write: 1024 })).toBe(413);
    // Chunked: refused by the running byte count.
    expect(await send(port, { path: "/api/attachments", write: over })).toBe(413);
    // Exactly at the cap the body is read and judged on its content.
    const atCap = `{${" ".repeat(ATTACHMENT_BODY_MAX_BYTES - 2)}}`;
    expect(atCap.length).toBe(ATTACHMENT_BODY_MAX_BYTES);
    const res = await fetch(`${base}/api/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: atCap,
    });
    expect(res.status).toBe(400);
    await res.text();
  });

  it("the larger cap belongs to POST /api/attachments only: not other methods or paths under it", async () => {
    const { port } = await boot();
    const size = 300 * 1024;
    expect(await send(port, { path: "/api/attachments/ask", declared: size, write: 1024 })).toBe(
      413,
    );
    expect(await send(port, { path: "/api/attachments/ask", write: size })).toBe(413);
    // The same size on the attachment route itself is read and judged on its content (400, not 413).
    expect(await send(port, { path: "/api/attachments", write: size })).toBe(400);
  });

  it("an unauthenticated oversized request is refused 401 before any body is read", async () => {
    const { port } = await boot();
    // Declared 100 MB, nothing but headers written: the answer comes without the body.
    expect(
      await send(port, {
        path: "/api/attachments",
        authenticated: false,
        declared: 100 * 1024 * 1024,
        write: 0,
      }),
    ).toBe(401);
    // Chunked, a first chunk only, never ended.
    expect(
      await send(port, { path: "/api/attachments", authenticated: false, write: 64 * 1024 }),
    ).toBe(401);
    // A wrong token is no better.
    expect(
      await send(port, {
        path: "/api/attachments",
        declared: ATTACHMENT_BODY_MAX_BYTES,
        write: 0,
        authenticated: false,
      }),
    ).toBe(401);
  });
});
