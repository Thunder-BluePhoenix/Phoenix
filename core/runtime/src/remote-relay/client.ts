// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createPublicKey, randomBytes, verify } from "node:crypto";
import type { DeviceStore } from "@phoenix/persistence";
import type { PhoneDeviceApi } from "@phoenix/api";
import { signedRequestText } from "../phone-link";
import { open, seal, type RelayFrame } from "./crypto";

const TARGET = "/remote/v1/decision";
const WINDOW = 60_000;

/** Each peer has an independently pinned identity. The route id is random routing metadata, not auth. */
export interface RemoteRelayOptions {
  url: string;
  route: string;
  corePrivateKey: string;
  devices: DeviceStore;
  phone: PhoneDeviceApi;
  fetcher?: typeof fetch;
  clock?: () => number;
}

export interface SignedDecision {
  device_id: string;
  timestamp: string;
  nonce: string;
  signature: string;
  body: { id: string; source: "confirmation" | "agent"; decision: "approve" | "deny"; request_hash: string; user_verification: boolean };
}

/** Core-owned replay state; the relay is deliberately stateless and untrusted. */
export class RemoteRelayClient {
  private readonly nonces = new Map<string, number>();
  private readonly fetcher: typeof fetch;
  private readonly clock: () => number;

  constructor(private readonly options: RemoteRelayOptions) {
    if (!/^[a-f0-9]{32}$/.test(options.route)) throw new Error("Invalid relay route");
    const url = new URL(options.url);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Relay requires HTTPS");
    if (url.username || url.password || url.search || url.hash) throw new Error("Relay URL cannot carry credentials");
    this.fetcher = options.fetcher ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  private address(peer: string): string {
    return `${this.options.url.replace(/\/$/, "")}/v1/routes/${this.options.route}/peers/${peer}`;
  }

  async sendToDevice(deviceId: string, payload: unknown): Promise<void> {
    const device = this.options.devices.get(deviceId);
    if (!device || device.revokedAt !== null) throw new Error("Device not paired or revoked");
    const frame = seal(this.options.route, "core", deviceId, device.publicKey, payload);
    const response = await this.fetcher(this.address(deviceId), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frame),
    });
    if (!response.ok) throw new Error(`Relay delivery failed (${response.status})`);
  }

  /** Feed decrypted, signed decisions only into the existing audited phone approval gateway. */
  accept(frame: RelayFrame): { id: string; source: "confirmation" | "agent"; decision: "approve" | "deny" } {
    const sender = frame.sender;
    if (!/^dev_[a-f0-9]{12}$/.test(sender)) throw new Error("Invalid device identity");
    const device = this.options.devices.get(sender);
    if (!device || device.revokedAt !== null) throw new Error("Device not paired or revoked");
    const message = open(this.options.route, "core", sender, this.options.corePrivateKey, frame) as SignedDecision;
    if (!message || message.device_id !== sender || !message.body || typeof message.body !== "object" ||
        typeof message.timestamp !== "string" || !/^\d{10,16}$/.test(message.timestamp) ||
        typeof message.nonce !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(message.nonce) ||
        typeof message.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.signature) || message.signature.length > 200) throw new Error("Malformed device decision");
    const now = this.clock();
    if (Math.abs(now - Number(message.timestamp)) > WINDOW) throw new Error("Expired device decision");
    const body = Buffer.from(JSON.stringify(message.body));
    const valid = verify("sha256", Buffer.from(signedRequestText(sender, "POST", TARGET, message.timestamp, message.nonce, body)),
      createPublicKey({ key: Buffer.from(device.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(message.signature, "base64"));
    if (!valid) throw new Error("Invalid device signature");
    for (const [key, expiry] of this.nonces) if (expiry <= now) this.nonces.delete(key);
    const nonceKey = `${sender}:${message.nonce}`;
    if (this.nonces.has(nonceKey)) throw new Error("Replayed device decision");
    if (this.nonces.size >= 4096 || [...this.nonces.keys()].filter((key) => key.startsWith(`${sender}:`)).length >= 200) throw new Error("Device nonce capacity exceeded");
    this.nonces.set(nonceKey, now + 120_000);
    return this.options.phone.decide({ id: sender, name: device.name }, message.body);
  }

  /** Starts a server-sent event connection; close the abort controller on shutdown/revocation. */
  async receive(signal: AbortSignal, onError: (error: unknown) => void): Promise<void> {
    const response = await this.fetcher(this.address("core"), { headers: { accept: "text/event-stream" }, signal });
    if (!response.ok || !response.body) throw new Error(`Relay stream failed (${response.status})`);
    const decoder = new TextDecoder();
    let pending = "";
    for await (const bytes of response.body) {
      pending += decoder.decode(bytes, { stream: true });
      if (pending.length > 64 * 1024) throw new Error("Relay event too large");
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const event = pending.slice(0, end).replace(/\r/g, "");
        pending = pending.slice(end + 2);
        const line = event.split("\n").find((row) => row.startsWith("data: "));
        if (!line) continue;
        try { this.accept(JSON.parse(line.slice(6)) as RelayFrame); }
        catch (error) { onError(error); }
      }
    }
  }

  static newRoute(): string { return randomBytes(16).toString("hex"); }
}
