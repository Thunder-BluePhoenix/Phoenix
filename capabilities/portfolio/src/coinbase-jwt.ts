// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Coinbase's API-key authentication: every request carries `Authorization: Bearer <JWT>`, a JWT
// signed ES256 (ECDSA, P-256, SHA-256) with the CDP key's private key, valid for 120 seconds and
// made for ONE request. Header: alg, kid (the key name), nonce, typ. Claims: sub (the key name),
// iss "cdp", nbf, exp, uri ("GET api.coinbase.com/path"). Written from Coinbase's public
// documentation (docs.cdp.coinbase.com, "API Key Authentication") using only node:crypto; never
// checked against the live service (README, "Not verified").
//
// The private key is PEM text from the OS secret store. It is parsed here, checked to be an EC
// P-256 private key and refused otherwise; it never leaves this file, is not cached and is not
// part of any error message.
import { createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { ServiceError } from "@phoenix/service-kit";

export const COINBASE_SERVICE = "Coinbase";
/** The only host a Coinbase JWT is ever made for (the `uri` claim). */
export const COINBASE_HOST = "api.coinbase.com";
/** Seconds a token stays valid, as documented: two minutes. */
export const JWT_LIFETIME_S = 120;

/** `organizations/{org}/apiKeys/{key}`, the name CDP shows for a key. Bounded, no spaces or dots. */
const KEY_NAME = /^organizations\/[A-Za-z0-9_-]{1,64}\/apiKeys\/[A-Za-z0-9_-]{1,64}$/;
const MAX_PEM_CHARS = 4096;

/** The key name, or a ServiceError that says what is wrong without echoing the value. */
export function checkKeyName(name: string): string {
  if (!KEY_NAME.test(name)) {
    throw new ServiceError(
      COINBASE_SERVICE,
      "invalid",
      "The Coinbase API key name must look like organizations/{org}/apiKeys/{key}",
    );
  }
  return name;
}

/**
 * The private key as a KeyObject. Accepts only an unencrypted EC key on P-256 (the "ECDSA"
 * signature algorithm in the CDP portal). Ed25519 keys, RSA keys, encrypted keys, public keys and
 * anything else are refused. The portal also hands the key out as one line with literal `\n`
 * escapes; those are turned back into newlines.
 */
export function loadPrivateKey(pem: string): KeyObject {
  const refused = new ServiceError(
    COINBASE_SERVICE,
    "invalid",
    "The Coinbase secret must be an unencrypted ECDSA (P-256) private key in PEM form",
  );
  if (pem.length > MAX_PEM_CHARS) throw refused;
  const text = (pem.includes("\n") ? pem : pem.replaceAll("\\n", "\n")).trim();
  if (!text.startsWith("-----BEGIN ")) throw refused;
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: text, format: "pem" });
  } catch {
    throw refused;
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ec") throw refused;
  if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw refused;
  return key;
}

/**
 * A fresh JWT for one GET of `path` (no query string) at `COINBASE_HOST`. The `uri` claim is built
 * here from the fixed method, host and the caller's fixed path, never from input. There is no
 * method parameter: a token for anything but a GET cannot be made.
 */
export function buildJwt(keyName: string, privateKey: KeyObject, path: string, nowMs: number) {
  const nbf = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: keyName, nonce: randomBytes(16).toString("hex"), typ: "JWT" };
  const claims = {
    sub: keyName,
    iss: "cdp",
    nbf,
    exp: nbf + JWT_LIFETIME_S,
    uri: `GET ${COINBASE_HOST}${path}`,
  };
  const signingInput = [header, claims]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".");
  // JWT wants the raw 64-byte r||s signature, not the DER that node produces by default.
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}
