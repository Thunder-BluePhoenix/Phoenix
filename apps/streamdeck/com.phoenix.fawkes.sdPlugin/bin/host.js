// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The narrow local host for the Stream Deck plugin (Phase 88). The plugin starts it for one
// message: it reads one length-prefixed JSON frame from stdin, talks to Core on http://127.0.0.1,
// writes one reply frame and exits. Same pattern as the "Send page to Phoenix" host
// (apps/extension/host/host.js).
//
// This program, not the plugin, holds the session token. It reads `<data dir>/session.token` the way
// the `phoenix` CLI does, sends it only to the loopback address, and never writes it to a reply, a
// log or an error. It exposes exactly two message kinds and nothing else:
//   { kind: "state" }       -> GET /api/pet/state, reduced to the coarse display state name.
//   { kind: "keep_awake" }  -> asks Core to run `awake.start` for a fixed 30 minutes. Core's
//                              permission gateway then asks the person on screen; the host never
//                              reads or resolves a confirmation, so no key can approve anything.
// A message carrying any other field (a duration, a path, a confirmation id) is refused.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { encodeFrame, readFrame } from "./frame.js";

/** The most the plugin may send in one frame; its two messages are a few dozen bytes. */
export const MAX_FRAME_BYTES = 1024;
export const SESSION_TOKEN_FILE = "session.token";
export const CORE_INFO_FILE = "core.json";
export const DEFAULT_CORE_URL = "http://127.0.0.1:4870";
/** The only duration a key can ask for. It is not part of the message, so a plugin cannot change it. */
export const KEEP_AWAKE_MINUTES = 30;
/** Fawkes' existing display states (protocol/src/fawkes-state.ts): the only values ever relayed. */
export const DISPLAY_STATES = [
  "ERROR",
  "WAITING",
  "RECORDING",
  "WARNING",
  "DEPLOYING",
  "THINKING",
  "LISTENING",
  "WORKING",
  "SUCCESS",
  "IDLE",
  "SLEEPING",
  "OFFLINE",
];
const CLIENT_LABEL = "stream-deck";
const TIMEOUT_MS = 10_000;
const ENVIRONMENTS = ["dev", "staging", "prod"];

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

/** The message kinds, each with the exact keys it may carry (only `kind`). */
function parseMessage(message) {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
  const keys = Object.keys(message);
  if (keys.length !== 1 || keys[0] !== "kind") return null;
  return message.kind === "state" || message.kind === "keep_awake" ? message.kind : null;
}

/**
 * Handles one decoded message. Always resolves to `{ ok: true, ... }` or `{ ok: false, error }`;
 * the reply never holds the token, Core's wording or any text Core produced.
 */
export async function handleMessage(message, deps = {}) {
  const env = deps.env ?? process.env;
  const kind = parseMessage(message);
  if (kind === null) return { ok: false, error: "invalid_message" };

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

  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "x-phoenix-client": CLIENT_LABEL,
  };
  const request =
    kind === "state"
      ? { url: `${base}/api/pet/state`, init: { method: "GET", headers } }
      : {
          url: `${base}/api/capabilities/awake/commands/start`,
          init: {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ input: { minutes: KEEP_AWAKE_MINUTES } }),
          },
        };
  let response;
  try {
    response = await (deps.fetch ?? fetch)(request.url, {
      ...request.init,
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
  if (kind === "keep_awake") {
    // 202: Core accepted the command and is now asking the person on screen. Nothing has started.
    return response.status === 202 ? { ok: true } : { ok: false, error: "rejected" };
  }
  if (!response.ok) return { ok: false, error: "rejected" };
  let state;
  try {
    state = (await response.json())?.state;
  } catch {
    return { ok: false, error: "bad_reply" };
  }
  return typeof state === "string" && DISPLAY_STATES.includes(state)
    ? { ok: true, state }
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
