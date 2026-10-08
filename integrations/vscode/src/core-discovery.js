// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Finds Phoenix Core and its session token the same way the terminal CLI and the SDK do
// (sdk/capability/src/session.ts), and refuses to talk to anything but a loopback address: the
// session token authorises everything in Phoenix, so it must never be sent over a network.
"use strict";

const path = require("node:path");

const DEFAULT_CORE_URL = "http://127.0.0.1:4870";
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/**
 * Core's base URL: the `phoenix.coreUrl` setting, else $PHOENIX_CORE_URL, else the default.
 * Throws if it is not plain http to a loopback host.
 * @param {{ setting?: string, env?: Record<string, string | undefined> }} [input]
 * @returns {string}
 */
function resolveCoreUrl({ setting, env = {} } = {}) {
  const raw = (setting && setting.trim()) || env.PHOENIX_CORE_URL || DEFAULT_CORE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Phoenix Core URL "${raw}" is not a valid URL`);
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.includes(url.hostname)) {
    throw new Error(
      `Phoenix Core URL must be http://127.0.0.1, http://localhost or http://[::1] (got ${url.protocol}//${url.hostname}); the session token is never sent to another machine`,
    );
  }
  return `${url.protocol}//${url.host}`;
}

/**
 * Where a session token may be, best first: $PHOENIX_DATA_DIR, each workspace folder's
 * `.phoenix/<env>/`, then `~/.phoenix/<env>/` (Core's default data directory).
 * $PHOENIX_SESSION_TOKEN is handled separately because it is the token itself.
 * @param {{ env?: Record<string, string | undefined>, workspaceFolders?: string[], home: string }} input
 * @returns {string[]}
 */
function tokenFileCandidates({ env = {}, workspaceFolders = [], home }) {
  const phoenixEnv = env.PHOENIX_ENV || "dev";
  return [
    ...(env.PHOENIX_DATA_DIR ? [path.join(env.PHOENIX_DATA_DIR, "session.token")] : []),
    ...workspaceFolders.map((dir) => path.join(dir, ".phoenix", phoenixEnv, "session.token")),
    path.join(home, ".phoenix", phoenixEnv, "session.token"),
  ];
}

/**
 * The current session token. Core issues a new one every time it starts, so callers read this
 * again whenever a request is rejected instead of caching it.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   workspaceFolders?: string[],
 *   home: string,
 *   readFile: (file: string) => string | undefined,
 * }} input `readFile` returns the file's text, or undefined if it does not exist.
 * @returns {string}
 */
function resolveSessionToken({ env = {}, workspaceFolders = [], home, readFile }) {
  if (env.PHOENIX_SESSION_TOKEN) return env.PHOENIX_SESSION_TOKEN;
  const candidates = tokenFileCandidates({ env, workspaceFolders, home });
  for (const file of candidates) {
    const token = readFile(file)?.trim();
    if (token) return token;
  }
  throw new Error(
    `Phoenix Core session token not found (looked in ${candidates.join(", ")}). Is Phoenix Core running?`,
  );
}

module.exports = { DEFAULT_CORE_URL, resolveCoreUrl, resolveSessionToken, tokenFileCandidates };
