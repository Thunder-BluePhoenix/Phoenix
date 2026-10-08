// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The editor as an external capability (the protocol of sdk/capability/src/external.ts, which this
// directory cannot import because it has no dependencies and no build step):
//
//   1. serve a loopback HTTP endpoint with GET /health and POST /phoenix/lifecycle, protected by a
//      callback secret that only Core (which we told at registration) knows;
//   2. POST /api/capabilities/register with the session token → Core answers with a capability token;
//   3. POST /api/capabilities/editor/events with that capability token.
//
// Events are only accepted while the user has the capability enabled in Phoenix (Settings →
// Capabilities), so nothing is sent before that: `emit` returns { sent: false } instead.
// Core issues new tokens every time it starts; `reconcile` notices that and registers again.
"use strict";

const { randomBytes, timingSafeEqual } = require("node:crypto");
const http = require("node:http");

const TOKEN_HEADER = "x-phoenix-capability-token";
const MAX_BODY = 64 * 1024;
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * @typedef {object} ClientOptions
 * @property {string} coreUrl Loopback base URL of Phoenix Core.
 * @property {() => string} sessionToken Read fresh on every registration (Core changes it on restart).
 * @property {Record<string, unknown>} manifest
 * @property {() => void | Promise<void>} [onEnable] The user enabled the capability in Phoenix.
 * @property {() => void | Promise<void>} [onDisable]
 * @property {(message: string) => void} [log]
 * @property {typeof fetch} [fetchImpl]
 */

/**
 * @typedef {object} EmitResult
 * @property {boolean} sent
 * @property {string} [reason] Why it was not sent (never contains a token).
 */

/**
 * @param {ClientOptions} options
 */
function createPhoenixClient(options) {
  const doFetch = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});
  const manifestId = String(options.manifest.id);
  const callbackSecret = randomBytes(32).toString("base64url");
  let capabilityToken = "";
  let registered = false;
  let enabled = false;
  /** @type {import("node:http").Server | undefined} */
  let server;
  let endpoint = "";
  let lastProblem = "Not connected to Phoenix Core yet";
  /** Serialises registrations so reconcile() and a 401 retry cannot register twice at once. */
  let registering = Promise.resolve();
  /** Events go out one at a time, in the order they happened (task started before task failed). */
  let outbox = Promise.resolve();

  /**
   * @param {string} method
   * @param {string} urlPath
   * @param {Record<string, string>} headers
   * @param {unknown} [body]
   */
  async function call(method, urlPath, headers, body) {
    const res = await doFetch(`${options.coreUrl}${urlPath}`, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    /** @type {{ message?: string, token?: string, status?: string, event_id?: string, code?: string }} */
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }

  async function register() {
    // Core decides afresh whether we are enabled: if the user had enabled us, it calls our
    // lifecycle endpoint (setting this back to true) before it answers.
    enabled = false;
    const res = await call(
      "POST",
      "/api/capabilities/register",
      { authorization: `Bearer ${options.sessionToken()}` },
      { manifest: options.manifest, endpoint, callback_secret: callbackSecret },
    );
    if (!res.ok || !res.json.token) {
      throw new Error(
        `Registration with Phoenix Core failed (${res.status}): ${res.json.message ?? "unknown error"}`,
      );
    }
    capabilityToken = res.json.token;
    registered = true;
    lastProblem = "";
  }

  /** @returns {Promise<void>} */
  function registerOnce() {
    registering = registering.catch(() => {}).then(register);
    return registering;
  }

  /** @param {import("node:http").IncomingMessage} req */
  async function readBody(req) {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error("Body too large");
      chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  }

  /** @param {string} presented */
  function secretMatches(presented) {
    const a = Buffer.from(presented);
    const b = Buffer.from(callbackSecret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handle(req, res) {
    /** @param {number} status @param {unknown} value */
    const reply = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const presented = req.headers[TOKEN_HEADER];
    if (typeof presented !== "string" || !secretMatches(presented)) {
      return reply(401, { message: "Invalid capability token" });
    }
    try {
      const body = /** @type {{ action?: unknown }} */ (await readBody(req));
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "GET" && pathname === "/health") {
        return reply(
          200,
          enabled
            ? { status: "healthy", message: "Reporting editor events" }
            : { status: "healthy" },
        );
      }
      if (req.method === "POST" && pathname === "/phoenix/lifecycle") {
        if (body.action === "enable") {
          enabled = true;
          await options.onEnable?.();
        } else if (body.action === "disable") {
          enabled = false;
          await options.onDisable?.();
        }
        return reply(200, { ok: true });
      }
      return reply(404, { message: "Not found" });
    } catch (err) {
      return reply(500, { message: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * @param {Record<string, unknown>} event
   * @param {boolean} [retried]
   * @returns {Promise<EmitResult>}
   */
  async function send(event, retried = false) {
    let res;
    // The first attempt after Core restarted often fails on a pooled connection to the old
    // process; the second opens a fresh one. Events carry an id, so Core de-duplicates retries.
    for (let attempt = 1; ; attempt++) {
      try {
        res = await call(
          "POST",
          `/api/capabilities/${manifestId}/events`,
          { [TOKEN_HEADER]: capabilityToken },
          event,
        );
        break;
      } catch {
        if (attempt < 2) continue;
        registered = false;
        lastProblem = "Phoenix Core is unreachable";
        return { sent: false, reason: lastProblem };
      }
    }
    if (res.status === 401 && !retried) {
      // Core restarted and issued new tokens.
      try {
        await registerOnce();
      } catch (err) {
        registered = false;
        lastProblem = err instanceof Error ? err.message : String(err);
        return { sent: false, reason: lastProblem };
      }
      return send(event, true);
    }
    if (res.ok) return { sent: true };
    if (res.json.code === "CAPABILITY_DISABLED") {
      enabled = false; // the user turned it off in Phoenix; stay quiet until they turn it on
      return { sent: false, reason: "The editor capability is disabled in Phoenix" };
    }
    return { sent: false, reason: res.json.message ?? `HTTP ${res.status}` };
  }

  return {
    /** Starts the callback server. Safe to call once. */
    async listen() {
      server = http.createServer((req, res) => void handle(req, res));
      await new Promise((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(0, "127.0.0.1", () => resolve(undefined));
      });
      const address = /** @type {import("node:net").AddressInfo} */ (server.address());
      endpoint = `http://127.0.0.1:${address.port}`;
      return endpoint;
    },

    /**
     * Makes sure Core knows this editor: registers if Core has never heard of it, restarted since,
     * or lost the connection. Returns whether Core is now registered with us. Never throws.
     * @returns {Promise<boolean>}
     */
    async reconcile() {
      try {
        if (registered) {
          const known = await call("GET", `/api/capabilities/${manifestId}`, {
            authorization: `Bearer ${options.sessionToken()}`,
          });
          const stillConnected =
            known.ok && known.json.status !== "disconnected" && known.json.status !== undefined;
          if (stillConnected) return true;
          if (!known.ok && known.status !== 404 && known.status !== 401) {
            lastProblem = known.json.message ?? `HTTP ${known.status}`;
            return false;
          }
          registered = false;
        }
        await registerOnce();
        log("Registered with Phoenix Core");
        return true;
      } catch (err) {
        registered = false;
        const message = err instanceof Error ? err.message : String(err);
        lastProblem = /fetch failed|aborted|timeout/i.test(message)
          ? "Phoenix Core is not running"
          : message;
        return false;
      }
    },

    /**
     * Sends an event if Core is connected and the user has enabled the capability.
     * @param {Record<string, unknown>} event
     * @returns {Promise<EmitResult>}
     */
    emit(event) {
      const result = outbox.then(async () => {
        if (!registered) return { sent: false, reason: lastProblem };
        if (!enabled) {
          return { sent: false, reason: "The editor capability is not enabled in Phoenix" };
        }
        return send(event);
      });
      outbox = result.then(
        () => {},
        () => {},
      );
      return result;
    },

    get enabled() {
      return enabled;
    },
    get registered() {
      return registered;
    },
    get problem() {
      return lastProblem;
    },
    get endpoint() {
      return endpoint;
    },

    async close() {
      const s = server;
      server = undefined;
      if (!s) return;
      await new Promise((resolve) => {
        s.close(() => resolve(undefined));
        s.closeAllConnections();
      });
    },
  };
}

module.exports = { createPhoenixClient, TOKEN_HEADER };
