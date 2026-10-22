// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";

export interface RelayFrame {
  sender: string;
  ephemeral_key: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

export function newCoreIdentity(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

function publicKey(base64: string): KeyObject {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 256) throw new Error("Invalid peer key");
  const key = createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Expected P-256 peer key");
  return key;
}

function keyFor(secret: Buffer, route: string, sender: string, recipient: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, createHash("sha256").update(route).digest(), Buffer.from(`phoenix-relay-v1\n${sender}\n${recipient}`), 32));
}

function associated(route: string, recipient: string, frame: Pick<RelayFrame, "sender" | "ephemeral_key">): Buffer {
  return Buffer.from(`phoenix-relay-v1\n${route}\n${frame.sender}\n${recipient}\n${frame.ephemeral_key}`);
}

export function seal(route: string, sender: string, recipient: string, pinnedRecipientKey: string, body: unknown): RelayFrame {
  const ephemeral = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ephemeral_key = ephemeral.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const iv = randomBytes(12);
  const key = keyFor(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKey(pinnedRecipientKey) }), route, sender, recipient);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associated(route, recipient, { sender, ephemeral_key }));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  return { sender, ephemeral_key, iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function open(route: string, recipient: string, expectedSender: string, privateKeyPem: string, frame: RelayFrame): unknown {
  if (frame.sender !== expectedSender) throw new Error("Unexpected sender");
  const iv = Buffer.from(frame.iv, "base64");
  const tag = Buffer.from(frame.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16 || frame.ciphertext.length > 44_000) throw new Error("Invalid encrypted frame");
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Expected P-256 identity");
  const key = keyFor(diffieHellman({ privateKey, publicKey: publicKey(frame.ephemeral_key) }), route, frame.sender, recipient);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(associated(route, recipient, frame));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(frame.ciphertext, "base64")), decipher.final()]).toString("utf8")) as unknown;
}
