// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one place that speaks TLS to a Philips Hue bridge. A bridge serves a certificate signed by
// Signify's own CA and issued to its bridge id, not its address, so normal verification against an
// IP address can never succeed. Phoenix does NOT switch verification off globally, and does not
// use the global fetch for this. Instead:
//   * `probe` opens one TLS connection, reads the certificate's SHA-256 fingerprint and closes it
//     without sending a byte. The owner confirms that fingerprint (and the bridge id in its subject).
//   * `request` opens a fresh TLS connection per call, compares the peer certificate's fingerprint
//     with the one the owner confirmed BEFORE any HTTP byte (and so before the application key) is
//     written, and only then hands the verified socket to the HTTP client. A different certificate
//     is a refused connection.
// Everything is behind the `HueLink` interface so tests drive the Hue code with a fake link.
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export const HUE_PORT = 443;
export const HUE_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface HueTarget {
  /** An IPv4 literal the owner entered (private, link-local or loopback). */
  address: string;
  port: number;
}

export interface HueCertificate {
  /** SHA-256 of the DER certificate, 64 lower-case hex digits. */
  fingerprint: string;
  /** The certificate subject's common name (a real bridge: its bridge id), if any. */
  commonName: string | null;
}

export interface HueRequest {
  method: "GET" | "POST" | "PUT";
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
}

export interface HueResponse {
  status: number;
  body: string;
}

export interface HueLink {
  /** Reads the bridge's certificate without sending any application data. */
  probe(target: HueTarget, signal: AbortSignal): Promise<HueCertificate>;
  /** Sends one request, only over a TLS connection whose certificate has exactly this fingerprint. */
  request(
    target: HueTarget & { fingerprint: string },
    request: HueRequest,
    signal: AbortSignal,
  ): Promise<HueResponse>;
}

/** A fingerprint as 64 lower-case hex digits, from hex with or without colons, else null. */
export function parseFingerprint(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const compact = /^[0-9a-f]{2}(:[0-9a-f]{2}){31}$/i.test(text) ? text.replaceAll(":", "") : text;
  return /^[0-9a-f]{64}$/i.test(compact) ? compact.toLowerCase() : null;
}

function certificateOf(socket: TLSSocket): HueCertificate {
  const cert = socket.getPeerCertificate();
  if (!cert || !cert.raw) throw new Error("The Hue bridge presented no certificate");
  const cn = (cert.subject as { CN?: string | string[] } | undefined)?.CN;
  return {
    fingerprint: createHash("sha256").update(cert.raw).digest("hex"),
    commonName: typeof cn === "string" ? cn : null,
  };
}

/**
 * A TLS socket to the bridge with certificate verification disabled for THIS socket only; the
 * caller must check the fingerprint before using it. Rejects on timeout or abort.
 */
function openTls(target: HueTarget, signal: AbortSignal): Promise<TLSSocket> {
  const { promise, resolve, reject } = Promise.withResolvers<TLSSocket>();
  signal.throwIfAborted();
  const socket = tlsConnect({
    host: target.address,
    port: target.port,
    // Safe only because every caller pins the fingerprint (or sends nothing) before use.
    rejectUnauthorized: false,
    minVersion: "TLSv1.2",
  });
  const fail = (error: Error) => {
    cleanup();
    socket.destroy();
    reject(error);
  };
  const onAbort = () => fail(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
  const cleanup = () => {
    signal.removeEventListener("abort", onAbort);
    socket.setTimeout(0);
    socket.removeListener("error", fail);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  socket.setTimeout(HUE_TIMEOUT_MS, () => fail(new Error("The Hue bridge did not answer")));
  socket.once("error", fail);
  socket.once("secureConnect", () => {
    cleanup();
    resolve(socket);
  });
  return promise;
}

export const nodeHueLink: HueLink = {
  async probe(target, signal) {
    const socket = await openTls(target, signal);
    try {
      return certificateOf(socket);
    } finally {
      socket.destroy(); // nothing was ever written
    }
  },

  async request(target, request, signal) {
    const socket = await openTls(target, signal);
    try {
      if (certificateOf(socket).fingerprint !== target.fingerprint)
        throw new Error("The Hue bridge certificate is not the one you confirmed");
    } catch (error) {
      socket.destroy();
      throw error;
    }
    const payload = request.body === undefined ? undefined : JSON.stringify(request.body);
    const { promise, resolve, reject } = Promise.withResolvers<HueResponse>();
    const done = (error: Error | null, response?: HueResponse) => {
      signal.removeEventListener("abort", onAbort);
      socket.destroy();
      if (error) reject(error);
      else resolve(response!);
    };
    const onAbort = () =>
      done(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    const req = httpRequest({
      // The already verified socket is the connection; no agent, so nothing is reused or redirected.
      createConnection: () => socket,
      method: request.method,
      path: request.path,
      headers: {
        ...request.headers,
        host: target.address,
        connection: "close",
        accept: "application/json",
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
      },
    });
    req.setTimeout(HUE_TIMEOUT_MS, () => done(new Error("The Hue bridge did not answer")));
    req.once("error", (error) => done(error));
    req.once("response", (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) return done(new Error("The Hue bridge answer is too large"));
        chunks.push(chunk);
      });
      res.once("end", () =>
        done(null, { status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
      res.once("error", (error) => done(error));
    });
    req.end(payload);
    return promise;
  },
};
