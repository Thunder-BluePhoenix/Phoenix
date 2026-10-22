// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { signedRequestText } from "../phone-link";
import { open, seal, verifyCoreMessage, type RelayFrame } from "./crypto";
import { ReplayWindow, SIGNATURE_WINDOW_MS } from "./replay";
import type { SignedDecision } from "./client";

/** Native-device protocol implementation; applications must pin Core's SPKI at pairing. */
export class RemoteRelayDevice {
  private readonly replay = new ReplayWindow(256, 256);

  constructor(
    private readonly route: string,
    private readonly deviceId: string,
    private readonly devicePrivateKey: string,
    private readonly pinnedCorePublicKey: string,
  ) {
    if (!/^[a-f0-9]{32}$/.test(route) || !/^dev_[a-f0-9]{12}$/.test(deviceId))
      throw new Error("Invalid device route");
  }

  /** Opens a frame and returns its payload only if the pinned Core key signed it, freshly and once. */
  readCore(frame: RelayFrame, now = Date.now()): unknown {
    const message = verifyCoreMessage(
      this.route,
      this.deviceId,
      this.pinnedCorePublicKey,
      open(this.route, this.deviceId, "core", this.devicePrivateKey, frame),
    );
    if (Math.abs(now - Number(message.timestamp)) > SIGNATURE_WINDOW_MS)
      throw new Error("Expired Core message");
    this.replay.claim("core", message.nonce, now);
    return message.payload;
  }

  decision(body: SignedDecision["body"], now = Date.now()): RelayFrame {
    const timestamp = String(now);
    const nonce = randomBytes(18).toString("base64url");
    const bytes = Buffer.from(JSON.stringify(body));
    const signature = sign(
      "sha256",
      Buffer.from(
        signedRequestText(this.deviceId, "POST", "/remote/v1/decision", timestamp, nonce, bytes),
      ),
      createPrivateKey(this.devicePrivateKey),
    ).toString("base64");
    const message: SignedDecision = { device_id: this.deviceId, timestamp, nonce, signature, body };
    return seal(this.route, this.deviceId, "core", this.pinnedCorePublicKey, message);
  }
}
