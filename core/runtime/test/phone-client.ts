// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A Node client acting as the phone (Phase 71 tests): it owns a P-256 key pair, pins the
// certificate fingerprint the desktop showed, and signs requests the way docs/phone-link.md says.
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { request } from "node:https";
import type { TLSSocket } from "node:tls";
import { signedRequestText } from "../src/phone-link";

export interface PhoneReply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: Record<string, unknown>;
  /** SHA-256 fingerprint of the certificate the server actually presented. */
  peerFingerprint: string;
}

export interface SignOverrides {
  deviceId?: string;
  timestamp?: number;
  nonce?: string;
  /** Sign this body but send `sentBody` instead (a tampering man in the middle). */
  sentBody?: string;
  extraHeaders?: Record<string, string>;
}

export class FakePhone {
  readonly privateKey: KeyObject;
  readonly publicKey: string;
  deviceId = "";

  constructor(
    readonly host: string,
    readonly port: number,
    /** The pin: what the desktop displayed. Null accepts any certificate (used to read it). */
    readonly pinnedFingerprint: string | null,
    private readonly now: () => number,
  ) {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  }

  /** One request. Rejects if the server's certificate is not the pinned one. */
  raw(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<PhoneReply> {
    const { promise, resolve, reject } = Promise.withResolvers<PhoneReply>();
    const req = request(
      {
        host: this.host,
        port: this.port,
        method,
        path,
        agent: false,
        // Pinning replaces CA validation: the certificate is self-signed on purpose.
        rejectUnauthorized: false,
        headers: {
          host: `${this.host}:${this.port}`,
          ...(body !== undefined
            ? {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(body)),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
            peerFingerprint: peer,
          });
        });
      },
    );
    let peer = "";
    req.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        const cert = (socket as TLSSocket).getPeerCertificate();
        peer = cert.fingerprint256;
        if (this.pinnedFingerprint !== null && peer !== this.pinnedFingerprint)
          req.destroy(new Error(`certificate does not match the pin: ${peer}`));
      });
    });
    req.on("error", reject);
    req.end(body);
    return promise;
  }

  pair(code: string, name: string, publicKey = this.publicKey): Promise<PhoneReply> {
    return this.raw(
      "POST",
      "/phone/v1/pair",
      {},
      JSON.stringify({ code, name, public_key: publicKey }),
    );
  }

  pairStatus(pairId: string): Promise<PhoneReply> {
    return this.raw("GET", `/phone/v1/pair/${pairId}`, {});
  }

  /** The headers of a correctly signed request, with optional deliberate faults. */
  headersFor(method: string, target: string, body: string, over: SignOverrides = {}) {
    const deviceId = over.deviceId ?? this.deviceId;
    const timestamp = String(over.timestamp ?? this.now());
    const nonce = over.nonce ?? randomBytes(16).toString("base64url");
    const text = signedRequestText(deviceId, method, target, timestamp, nonce, Buffer.from(body));
    return {
      "x-phoenix-device": deviceId,
      "x-phoenix-timestamp": timestamp,
      "x-phoenix-nonce": nonce,
      "x-phoenix-signature": sign("sha256", Buffer.from(text), this.privateKey).toString("base64"),
      ...over.extraHeaders,
    };
  }

  signed(
    method: string,
    target: string,
    body?: unknown,
    over: SignOverrides = {},
  ): Promise<PhoneReply> {
    const text = body === undefined ? "" : JSON.stringify(body);
    return this.raw(
      method,
      target,
      this.headersFor(method, target, text, over),
      body === undefined ? undefined : (over.sentBody ?? text),
    );
  }

  approvals() {
    return this.signed("GET", "/phone/v1/approvals");
  }

  decide(body: Record<string, unknown>, over: SignOverrides = {}) {
    return this.signed("POST", "/phone/v1/approvals/decision", body, over);
  }
}
