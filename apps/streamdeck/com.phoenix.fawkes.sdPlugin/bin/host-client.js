// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// How the plugin talks to its local host: start `host-main.js` with Stream Deck's own Node, write
// one frame, read one frame. The plugin never sees the session token; the child gets only the few
// variables the host needs to find Core and its token file.
import { spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodeFrame, readFrame } from "./frame.js";

export const HOST_PATH = fileURLToPath(new URL("./host-main.js", import.meta.url));
const MAX_REPLY_BYTES = 1024;
const TIMEOUT_MS = 15_000;
const FORWARDED = [
  "PHOENIX_ENV",
  "PHOENIX_DATA_DIR",
  "PHOENIX_CORE_URL",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
];

const FAILED = { ok: false, error: "host_failed" };

/** Sends one message to the host. Never rejects: any failure is `{ ok: false, error }`. */
export async function askHost(message, deps = {}) {
  const env = {};
  for (const name of FORWARDED) {
    const value = (deps.env ?? process.env)[name];
    if (typeof value === "string") env[name] = value;
  }
  let child;
  try {
    child = (deps.spawn ?? nodeSpawn)(
      deps.execPath ?? process.execPath,
      [deps.hostPath ?? HOST_PATH],
      {
        stdio: ["pipe", "pipe", "ignore"],
        env,
        windowsHide: true,
      },
    );
  } catch {
    return FAILED;
  }
  const timer = setTimeout(() => child.kill(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    const reading = readFrame(child.stdout, MAX_REPLY_BYTES);
    child.stdin.on("error", () => {});
    child.stdin.end(encodeFrame(message));
    const reply = await reading;
    return typeof reply === "object" && reply !== null && typeof reply.ok === "boolean"
      ? reply
      : FAILED;
  } catch {
    return FAILED;
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}
