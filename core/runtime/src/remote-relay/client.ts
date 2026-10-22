// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createPublicKey, randomBytes, verify } from "node:crypto";
import type { AuditLog } from "@phoenix/permissions";
import type { DeviceStore, PairedDevice } from "@phoenix/persistence";
import type { PhoneDeviceApi } from "@phoenix/api";
import { signedRequestText } from "../phone-link";
import { open, seal, signCoreMessage, type RelayFrame } from "./crypto";
import { ReplayWindow, SIGNATURE_WINDOW_MS } from "./replay";

const TARGET = "/remote/v1/decision";

/** Each peer has an independently pinned identity. The route id is random routing metadata, not auth. */
export interface RemoteRelayOptions {
  url: string;
  route: string;
  corePrivateKey: string;
  devices: DeviceStore;
  phone: PhoneDeviceApi;
  /** Where refusals are recorded; accepted decisions are audited by the phone approval gateway itself. */
  audit?: Pick<AuditLog, "record">;
  /** Replay table sizes; the defaults match the phone link (4096 in total, 200 per device). */
  nonces?: { total: number; perDevice: number };
  fetcher?: typeof fetch;
  clock?: () => number;
}

export interface SignedDecision {
  device_id: string;
  timestamp: string;
  nonce: string;
  signature: string;
  body: {
    id: string;
    source: "confirmation" | "agent";
    decision: "approve" | "deny";
    request_hash: string;
    user_verification: boolean;
  };
}

/** Core-owned replay state; the relay is deliberately stateless and untrusted. */
export class RemoteRelayClient {
  private readonly replay: ReplayWindow;
  private auditWindowStart = 0;
  private auditRows = 0;
  private readonly fetcher: typeof fetch;
  private readonly clock: () => number;

  constructor(private readonly options: RemoteRelayOptions) {
    if (!/^[a-f0-9]{32}$/.test(options.route)) throw new Error("Invalid relay route");
    const url = new URL(options.url);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      throw new Error("Relay requires HTTPS");
    if (url.username || url.password || url.search || url.hash)
      throw new Error("Relay URL cannot carry credentials");
    this.fetcher = options.fetcher ?? fetch;
    this.clock = options.clock ?? Date.now;
    this.replay = new ReplayWindow(options.nonces?.total, options.nonces?.perDevice);
  }

  private address(peer: string): string {
    return `${this.options.url.replace(/\/$/, "")}/v1/routes/${this.options.route}/peers/${peer}`;
  }

  async sendToDevice(deviceId: string, payload: unknown): Promise<void> {
    const device = this.options.devices.get(deviceId);
    if (!device || device.revokedAt !== null) throw new Error("Device not paired or revoked");
    const signed = signCoreMessage(
      this.options.route,
      deviceId,
      this.options.corePrivateKey,
      payload,
      this.clock(),
    );
    const frame = seal(this.options.route, "core", deviceId, device.publicKey, signed);
    const response = await this.fetcher(this.address(deviceId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(frame),
    });
    if (!response.ok) throw new Error(`Relay delivery failed (${response.status})`);
  }

  /** Refusals are audited (device id and reason only), at most 20 rows a minute so a flood cannot fill the log. */
  private refuse(deviceId: string | null, reason: string): never {
    const now = this.clock();
    if (now - this.auditWindowStart >= 60_000) {
      this.auditWindowStart = now;
      this.auditRows = 0;
    }
    if (this.options.audit && this.auditRows < 20) {
      this.auditRows++;
      this.options.audit.record({
        actor: deviceId ? `device:${deviceId}` : "relay",
        action: "relay.decision.refused",
        decision: "denied",
        details: { ...(deviceId ? { device_id: deviceId } : {}), reason },
      });
    }
    throw new Error(reason);
  }

  /** Everything that must hold before a relayed decision may reach the approval gateway. */
  private verified(frame: RelayFrame): { device: PairedDevice; body: SignedDecision["body"] } {
    const sender = frame.sender;
    if (typeof sender !== "string" || !/^dev_[a-f0-9]{12}$/.test(sender))
      return this.refuse(null, "Invalid device identity");
    const device = this.options.devices.get(sender);
    if (!device || device.revokedAt !== null)
      return this.refuse(sender, "Device not paired or revoked");
    let message: SignedDecision;
    try {
      message = open(
        this.options.route,
        "core",
        sender,
        this.options.corePrivateKey,
        frame,
      ) as SignedDecision;
    } catch {
      return this.refuse(sender, "Frame could not be decrypted");
    }
    if (
      !message ||
      message.device_id !== sender ||
      !message.body ||
      typeof message.body !== "object" ||
      typeof message.timestamp !== "string" ||
      !/^\d{10,16}$/.test(message.timestamp) ||
      typeof message.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(message.nonce) ||
      typeof message.signature !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(message.signature) ||
      message.signature.length > 200
    )
      return this.refuse(sender, "Malformed device decision");
    const now = this.clock();
    if (Math.abs(now - Number(message.timestamp)) > SIGNATURE_WINDOW_MS)
      return this.refuse(sender, "Expired device decision");
    const body = Buffer.from(JSON.stringify(message.body));
    let valid = false;
    try {
      valid = verify(
        "sha256",
        Buffer.from(
          signedRequestText(sender, "POST", TARGET, message.timestamp, message.nonce, body),
        ),
        createPublicKey({
          key: Buffer.from(device.publicKey, "base64"),
          format: "der",
          type: "spki",
        }),
        Buffer.from(message.signature, "base64"),
      );
    } catch {
      valid = false;
    }
    if (!valid) return this.refuse(sender, "Invalid device signature");
    // Claimed only after the signature holds, so a forger cannot burn a real device's nonces.
    try {
      this.replay.claim(sender, message.nonce, now);
    } catch (error) {
      return this.refuse(sender, error instanceof Error ? error.message : "Replayed message");
    }
    return { device, body: message.body };
  }

  /** Feed decrypted, signed decisions only into the existing audited phone approval gateway. */
  accept(frame: RelayFrame): {
    id: string;
    source: "confirmation" | "agent";
    decision: "approve" | "deny";
  } {
    const { device, body } = this.verified(frame);
    return this.options.phone.decide({ id: device.id, name: device.name }, body);
  }

  /** Sends the device the approvals it may answer, each with the request hash it must sign. */
  async pushApprovals(deviceId: string): Promise<void> {
    const device = this.options.devices.get(deviceId);
    if (!device || device.revokedAt !== null) throw new Error("Device not paired or revoked");
    const { approvals } = this.options.phone.approvals({ id: device.id, name: device.name });
    await this.sendToDevice(deviceId, { type: "approvals", approvals });
  }

  /** Starts a server-sent event connection; close the abort controller on shutdown/revocation. */
  async receive(signal: AbortSignal, onError: (error: unknown) => void): Promise<void> {
    const response = await this.fetcher(this.address("core"), {
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`Relay stream failed (${response.status})`);
    const decoder = new TextDecoder();
    let pending = "";
    const reader = response.body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > 64 * 1024) throw new Error("Relay event too large");
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const event = pending.slice(0, end).replace(/\r/g, "");
        pending = pending.slice(end + 2);
        const line = event.split("\n").find((row) => row.startsWith("data: "));
        if (!line) continue;
        try {
          this.accept(JSON.parse(line.slice(6)) as RelayFrame);
        } catch (error) {
          onError(error);
        }
      }
    }
  }

  static newRoute(): string {
    return randomBytes(16).toString("hex");
  }
}
