// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { open, seal, type RelayFrame } from "../remote-relay/crypto";
import type { TeamFrameBody } from "./presence";

/** Domain-separation label: team frames can never be mistaken for Phase 87 approval frames. */
const ROUTE = "team-status-v1";
const MAX_CIPHERTEXT = 4_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

interface Signed {
  body: TeamFrameBody;
  signature: string;
}

function signedText(sender: string, recipient: string, body: TeamFrameBody): Buffer {
  return Buffer.from(`phoenix-team-status-v1\n${sender}\n${recipient}\n${JSON.stringify(body)}`);
}

/** Throws unless `base64` is a P-256 SPKI public key. */
export function assertTeamPublicKey(base64: string): void {
  if (!BASE64.test(base64) || base64.length > 256) throw new RangeError("Invalid public key");
  const key = createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
    throw new RangeError("Expected a P-256 public key");
}

/**
 * Encrypts and signs one update for one teammate. The relay (Phase 87) only ever sees the sealed
 * frame: ECDH + AES-256-GCM to the recipient's pinned key. The inner ECDSA signature binds the
 * body to sender and recipient, because sealing alone does not prove who sent a frame (anyone
 * can encrypt to a public key).
 */
export function sealTeamFrame(
  sender: string,
  recipient: string,
  recipientPublicKey: string,
  senderPrivateKeyPem: string,
  body: TeamFrameBody,
): RelayFrame {
  const signature = sign(
    "sha256",
    signedText(sender, recipient, body),
    createPrivateKey(senderPrivateKeyPem),
  ).toString("base64");
  const message: Signed = { body, signature };
  return seal(ROUTE, sender, recipient, recipientPublicKey, message);
}

/**
 * Decrypts a frame from `expectedSender` and checks its signature against that sender's pinned
 * key. Returns the still-untrusted body (the caller validates it) or null for any failure; the
 * reason is deliberately not distinguished.
 */
export function openTeamFrame(
  recipient: string,
  expectedSender: string,
  senderPublicKey: string,
  recipientPrivateKeyPem: string,
  frame: RelayFrame,
): unknown {
  try {
    if (typeof frame.ciphertext !== "string" || frame.ciphertext.length > MAX_CIPHERTEXT)
      return null;
    const message = open(
      ROUTE,
      recipient,
      expectedSender,
      recipientPrivateKeyPem,
      frame,
    ) as Partial<Signed> | null;
    if (
      message === null ||
      typeof message !== "object" ||
      typeof message.signature !== "string" ||
      !BASE64.test(message.signature) ||
      message.signature.length > 200 ||
      message.body === undefined
    )
      return null;
    const ok = verify(
      "sha256",
      signedText(expectedSender, recipient, message.body),
      createPublicKey({ key: Buffer.from(senderPublicKey, "base64"), format: "der", type: "spki" }),
      Buffer.from(message.signature, "base64"),
    );
    return ok ? message.body : null;
  } catch {
    return null;
  }
}
