// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Luxafor over its documented "Incoming Local Webhook" (Luxafor Knowledge Base, "Incoming Local
// Webhook Developer Guide"): the Luxafor desktop app, with the webhook switched on in its
// Settings, listens on TCP port 5383 (default) and takes `POST /color {"color": "RRGGBB"}` with an
// `Authorization: Bearer <token>` header. USB HID would need a native dependency, which this build
// does not add, so it is not offered.
//
// What the documentation says, and what follows from it:
//   * Plain HTTP, no TLS, "designed for local network use only": the address is a private,
//     link-local or loopback IPv4 literal the owner entered.
//   * The app answers `200` immediately "regardless of whether the request body is valid or the
//     token is correct", and ignores bad requests silently. A 200 is therefore NOT proof that the
//     light changed; this transport can only report that the app accepted the connection.
//   * The token is the one configured in the Luxafor app (default "luxafor"). It is kept in the OS
//     credential store as a write-only secret and sent only in the Authorization header.
import type { DeviceTransport } from "@phoenix/capability-status-lights";
import { createPacer } from "./pacer";

export const LUXAFOR_PORT = 5383;
export const LUXAFOR_MIN_INTERVAL_MS = 250;
const WRITE_TIMEOUT_MS = 5_000;
/** The controller's colour report for a Luxafor: command 1, all LEDs (0xff), r, g, b, 0, 0, 0. */
const REPORT_BYTES = 8;
const TOKEN = /^[\x21-\x7e]{1,128}$/;

export const luxaforSecretRef = (id: string) => `status-lights.luxafor.${id}`;

/** A token is printable ASCII without spaces, so it can sit in a header and nothing else. */
export function validLuxaforToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export interface LuxaforTarget {
  address: string;
  port: number;
}

export interface LuxaforTransportOptions {
  /** Reads the token at each write; never held longer. */
  token: () => Promise<string | undefined>;
  fetcher?: typeof fetch;
  minIntervalMs?: number;
}

export function luxaforTransport(
  target: LuxaforTarget,
  options: LuxaforTransportOptions,
): DeviceTransport {
  const fetcher = options.fetcher ?? fetch;
  const pace = createPacer(options.minIntervalMs ?? LUXAFOR_MIN_INTERVAL_MS);
  return {
    request() {
      return Promise.reject(new Error("A Luxafor is not a request device"));
    },
    async report(bytes, signal) {
      if (bytes.length !== REPORT_BYTES || bytes[0] !== 1 || bytes[1] !== 0xff)
        throw new Error("Not a Luxafor colour report");
      if (bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0)
        throw new Error("Not a Luxafor colour report");
      const color = [bytes[2]!, bytes[3]!, bytes[4]!]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      const token = await options.token();
      if (!token) throw new Error("The Luxafor webhook token is not stored");
      await pace(signal);
      signal.throwIfAborted();
      const response = await fetcher(`http://${target.address}:${target.port}/color`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ color }),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(WRITE_TIMEOUT_MS)]),
      });
      if (!response.ok) throw new Error(`Luxafor app answered ${response.status}`);
    },
  };
}
