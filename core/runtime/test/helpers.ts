// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from "@phoenix/api";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { defaults, type PhoenixConfig } from "@phoenix/config";
import { silentLogger, type Logger } from "@phoenix/logging";
import type { SecretStore } from "@phoenix/persistence";
import WebSocket from "ws";
import { PhoenixRuntime, type RuntimeOptions } from "../src";

export const TOKEN = "test-token-0123456789";

export interface ApiResponse {
  status: number;
  headers: Headers;
  json: any;
}

export type ApiCall = (
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<ApiResponse>;

/** A running Core plus a client that already carries the session token. */
export interface TestCore {
  runtime: PhoenixRuntime;
  port: number;
  base: string;
  api: ApiCall;
  dataDir: string;
}

export async function startCore(
  overrides: Partial<PhoenixConfig> = {},
  opts: {
    writeTokenFile?: boolean;
    capabilities?: CapabilityModule[];
    secrets?: SecretStore;
    logger?: Logger;
    runtime?: Partial<RuntimeOptions>;
  } = {},
): Promise<TestCore> {
  const dataDir = mkdtempSync(join(tmpdir(), "phoenix-core-"));
  const runtime = new PhoenixRuntime({
    config: { ...defaults("dev"), port: 0, dataDir, ...overrides },
    logger: opts.logger ?? silentLogger,
    databasePath: ":memory:",
    token: TOKEN,
    writeTokenFile: opts.writeTokenFile ?? false,
    capabilities: opts.capabilities ?? [],
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
    ...opts.runtime,
  });
  const { port } = await runtime.start();
  const base = `http://127.0.0.1:${port}`;

  const api: ApiCall = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      json: text ? (JSON.parse(text) as any) : undefined,
    };
  };

  return { runtime, port, base, api, dataDir };
}

/** A JSON value as it arrives over the socket. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The event inside an `event.created` message. */
export interface HubEvent {
  event_type: string;
  source: string;
  payload: { [key: string]: JsonValue };
}

/** The `payload` of a `notification.created` message (and similar wrappers). */
export interface HubPayload {
  notification?: JsonValue;
  [key: string]: JsonValue | undefined;
}

/** The channel payload of a hub message. Fields not named here stay plain JSON. */
export interface HubData {
  state?: string;
  recording?: boolean;
  event: HubEvent;
  tasks: JsonValue[];
  payload: HubPayload;
  [key: string]: JsonValue | HubEvent | HubPayload | undefined;
}

/**
 * One message from `/api/ws`: `state.changed` carries `state` and flags, `event.created` carries
 * `event`, `task.updated` carries `tasks`, `notification.created` carries `payload.notification`.
 */
export interface HubMessage {
  type?: string;
  channel?: string;
  seq?: number | null;
  data: HubData;
}

/** A subscribed `/api/ws` client: every received message is kept and can be waited for. */
export interface HubClient {
  ws: WebSocket;
  messages: HubMessage[];
  next(pred: (m: HubMessage) => boolean, timeoutMs?: number): Promise<HubMessage>;
  opened: Promise<void>;
  send(message: unknown): void;
}

/** WebSocket client that records every message and lets tests wait for one. */
export function connect(port: number, token = TOKEN): HubClient {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, [WS_PROTOCOL, WS_TOKEN_PREFIX + token]);
  const messages: HubMessage[] = [];
  const waiters: { pred: (m: HubMessage) => boolean; resolve: (m: HubMessage) => void }[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString()) as HubMessage;
    messages.push(m);
    for (const w of [...waiters]) {
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  const next = (pred: (m: HubMessage) => boolean, timeoutMs = 2000): Promise<HubMessage> => {
    const found = messages.find(pred);
    if (found) {
      messages.splice(messages.indexOf(found), 1);
      return Promise.resolve(found);
    }
    const result = Promise.withResolvers<HubMessage>();
    const t = setTimeout(
      () => result.reject(new Error("timed out waiting for message")),
      timeoutMs,
    );
    waiters.push({
      pred,
      resolve: (m) => {
        clearTimeout(t);
        messages.splice(messages.indexOf(m), 1);
        result.resolve(m);
      },
    });
    return result.promise;
  };
  const opened = Promise.withResolvers<void>();
  ws.once("open", () => opened.resolve());
  ws.once("error", opened.reject);
  ws.once("unexpected-response", (_req, res) => opened.reject(new Error(`HTTP ${res.statusCode}`)));
  return {
    ws,
    messages,
    next,
    opened: opened.promise,
    send: (m: unknown) => ws.send(JSON.stringify(m)),
  };
}

export const event = (event_type: string, extra: Record<string, unknown> = {}) => ({
  event_id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
  event_type,
  version: "1.1",
  source: "terminal",
  timestamp: new Date().toISOString(),
  severity: "info",
  payload: {},
  ...extra,
});
