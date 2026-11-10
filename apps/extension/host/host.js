// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The native-messaging host for the "Send page to Phoenix" extension (Phase 89). The browser starts
// it for one message: it reads one length-prefixed JSON frame from stdin, forwards the page to Core
// on http://127.0.0.1, writes one reply frame and exits.
//
// This program, not the extension, holds the session token. It reads `<data dir>/session.token`
// the way the `phoenix` CLI does (apps/phoenix-cli/src/token.ts), sends it only to the loopback
// address, and never writes it to a log, a reply or an error. It exposes exactly one message kind,
// `page`; anything else is refused without reading further.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { endianness, homedir } from "node:os";
import { join, resolve } from "node:path";
import { MESSAGE_KIND, parsePageMessage } from "../src/page.js";

/** The most the browser may send in one frame. Chrome allows 4 GiB; a page note is far smaller. */
export const MAX_FRAME_BYTES = 64 * 1024;
export const SESSION_TOKEN_FILE = "session.token";
export const CORE_INFO_FILE = "core.json";
export const DEFAULT_CORE_URL = "http://127.0.0.1:4870";
const CLIENT_LABEL = "browser-extension";
const TIMEOUT_MS = 10_000;
const ENVIRONMENTS = ["dev", "staging", "prod"];
const LITTLE = endianness() === "LE";

/** One frame: a 4-byte length in the machine's byte order (the browsers' rule), then UTF-8 JSON. */
export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const head = Buffer.alloc(4);
  if (LITTLE) head.writeUInt32LE(body.length, 0);
  else head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

/**
 * Reads exactly one frame from a readable stream. Rejects (with a `code`) for a length over the cap
 * before reading the body, for a stream that ends early and for JSON that does not parse.
 */
export function readFrame(input, maxBytes = MAX_FRAME_BYTES) {
  return new Promise((resolveFrame, reject) => {
    const chunks = [];
    let have = 0;
    let need = -1;
    const fail = (code) => {
      cleanup();
      reject(Object.assign(new Error(code), { code }));
    };
    const finish = (buffer) => {
      cleanup();
      try {
        resolveFrame(JSON.parse(buffer.toString("utf8")));
      } catch {
        reject(Object.assign(new Error("bad_json"), { code: "bad_json" }));
      }
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      have += chunk.length;
      const all = Buffer.concat(chunks);
      if (need < 0 && have >= 4) {
        need = LITTLE ? all.readUInt32LE(0) : all.readUInt32BE(0);
        if (need > maxBytes) return fail("frame_too_large");
      }
      if (need >= 0 && have >= 4 + need) finish(all.subarray(4, 4 + need));
    };
    const onEnd = () => fail(need < 0 ? "no_message" : "truncated");
    const onError = () => fail("stream_error");
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.pause?.();
    };
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("error", onError);
  });
}

/** `http://127.0.0.1:<port>` only: the token is never sent to another host, `localhost` included. */
export function parseCoreUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "")
    return null;
  if (url.pathname !== "/" || url.port === "") return null;
  return url.origin;
}

/**
 * The session token, found like the CLI finds it: PHOENIX_SESSION_TOKEN, else
 * `<data dir>/session.token` for PHOENIX_DATA_DIR, `./.phoenix/<env>` or `~/.phoenix/<env>`.
 * Returns the trimmed token or `null`; the value is never part of an error.
 */
export function findSessionToken(env, cwd, home) {
  const fromEnv = env.PHOENIX_SESSION_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const phoenixEnv = env.PHOENIX_ENV ?? "dev";
  if (!ENVIRONMENTS.includes(phoenixEnv)) return null;
  const files = [
    env.PHOENIX_DATA_DIR,
    join(cwd, ".phoenix", phoenixEnv),
    join(home, ".phoenix", phoenixEnv),
  ]
    .filter((dir) => typeof dir === "string" && dir !== "")
    .map((dir) => join(resolve(cwd, dir), SESSION_TOKEN_FILE));
  const file = files.find((candidate) => existsSync(candidate));
  if (file === undefined) return null;
  try {
    const value = readFileSync(file, "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * Core's own statement of where it listens: `<data dir>/core.json`, `{ "url": "http://127.0.0.1:<port>" }`,
 * written next to the session token. Returns `{ url }` (url may be null when the file holds no usable
 * address), `{ unsafe: true }` when the file is not a regular file private to the current user
 * (the token must not follow an address someone else could have written), or `null` when there is
 * no such file (an older Core, or one that stopped): the caller then keeps the default address.
 */
export function findCoreInfo(env, cwd, home) {
  const phoenixEnv = env.PHOENIX_ENV ?? "dev";
  if (!ENVIRONMENTS.includes(phoenixEnv)) return null;
  const files = [
    env.PHOENIX_DATA_DIR,
    join(cwd, ".phoenix", phoenixEnv),
    join(home, ".phoenix", phoenixEnv),
  ]
    .filter((dir) => typeof dir === "string" && dir !== "")
    .map((dir) => join(resolve(cwd, dir), CORE_INFO_FILE));
  const file = files.find((candidate) => existsSync(candidate));
  if (file === undefined) return null;
  try {
    const info = lstatSync(file);
    if (!info.isFile()) return { unsafe: true };
    if (process.platform !== "win32") {
      if (info.mode & 0o077) return { unsafe: true };
      if (typeof process.getuid === "function" && info.uid !== process.getuid())
        return { unsafe: true };
    }
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { url: typeof parsed?.url === "string" ? parseCoreUrl(parsed.url) : null };
  } catch {
    return { unsafe: true };
  }
}

/**
 * Handles one decoded message. Always resolves to `{ ok: true, id }` or `{ ok: false, error }`; the
 * reply never holds the token, the page text or Core's own wording.
 */
export async function handleMessage(message, deps = {}) {
  const env = deps.env ?? process.env;
  const page = parsePageMessage(message);
  if (page === null) return { ok: false, error: "invalid_message" };

  const cwd = deps.cwd ?? process.cwd();
  const home = deps.home ?? homedir();
  let address = env.PHOENIX_CORE_URL ?? null;
  if (address === null) {
    // Without an explicit address, Core's own info file says where the token's owner listens.
    const info = findCoreInfo(env, cwd, home);
    if (info?.unsafe === true || (info !== null && info.url === null))
      return { ok: false, error: "bad_core_url" };
    address = info === null ? DEFAULT_CORE_URL : info.url;
  }
  const base = parseCoreUrl(address);
  if (base === null) return { ok: false, error: "bad_core_url" };
  const token = findSessionToken(env, cwd, home);
  if (token === null) return { ok: false, error: "token_missing" };

  const { kind: _kind, ...note } = page;
  let response;
  try {
    response = await (deps.fetch ?? fetch)(`${base}/api/companion/page`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-phoenix-client": CLIENT_LABEL,
      },
      body: JSON.stringify(note),
      // A redirect would carry the bearer token to wherever it points.
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "core_unreachable" };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "token_rejected" };
  }
  if (!response.ok) return { ok: false, error: "rejected" };
  let id;
  try {
    id = (await response.json())?.page?.id;
  } catch {
    return { ok: false, error: "bad_reply" };
  }
  return typeof id === "string" && /^pn_[0-9a-f]{24}$/.test(id)
    ? { ok: true, id }
    : { ok: false, error: "bad_reply" };
}

/** The whole host: one frame in, one frame out. Resolves to the reply it wrote. */
export async function runHost(input, output, deps = {}) {
  let reply;
  try {
    const message = await readFrame(input, deps.maxFrameBytes ?? MAX_FRAME_BYTES);
    reply = await handleMessage(message, deps);
  } catch (error) {
    reply = {
      ok: false,
      error: error?.code === "frame_too_large" ? "frame_too_large" : "bad_frame",
    };
  }
  await new Promise((done) => output.write(encodeFrame(reply), () => done()));
  return reply;
}

export { MESSAGE_KIND };
