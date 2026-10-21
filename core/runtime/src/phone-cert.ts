// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A minimal X.509 v3 self-signed certificate builder for the phone link's LAN listener
// (Phase 71). Node can parse and verify certificates but cannot create them, and Phoenix adds no
// dependency, so the DER is written here: one fixed profile (ECDSA P-256, SHA-256, one IPv4
// subjectAltName, serverAuth, not a CA) and nothing else. The result is checked in
// core/runtime/test/phone-cert.test.ts with `X509Certificate` (parse, signature, SAN, validity,
// key match), with a real TLS handshake, and with `openssl x509` when that binary is present.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  type KeyObject,
} from "node:crypto";

const TAG = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  oid: 0x06,
  utf8String: 0x0c,
  utcTime: 0x17,
  generalizedTime: 0x18,
  sequence: 0x30,
  set: 0x31,
  /** [0] EXPLICIT (version) and [3] EXPLICIT (extensions). */
  explicit0: 0xa0,
  explicit3: 0xa3,
  /** subjectAltName iPAddress, [7] IMPLICIT. */
  ipAddress: 0x87,
} as const;

// Object identifiers, written out in DER content form by `oid()`.
const OID = {
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  commonName: "2.5.4.3",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  subjectAltName: "2.5.29.17",
  serverAuth: "1.3.6.1.5.5.7.3.1",
} as const;

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...parts: Buffer[]): Buffer {
  const content = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(content.length), content]);
}

function oid(dotted: string): Buffer {
  const arcs = dotted.split(".").map(Number);
  const [first, second, ...rest] = arcs as [number, number, ...number[]];
  const body: number[] = [first * 40 + second];
  for (const arc of rest) {
    const chunk: number[] = [arc & 0x7f];
    for (let v = Math.floor(arc / 128); v > 0; v = Math.floor(v / 128))
      chunk.unshift((v & 0x7f) | 0x80);
    body.push(...chunk);
  }
  return tlv(TAG.oid, Buffer.from(body));
}

/** A non-negative INTEGER: leading zeros dropped, a 0x00 prefix when the top bit is set. */
function positiveInteger(value: Buffer): Buffer {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  const trimmed = value.subarray(start);
  const padded = trimmed[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed;
  return tlv(TAG.integer, padded);
}

const two = (n: number) => String(n).padStart(2, "0");

/** UTCTime up to 2049 (RFC 5280 §4.1.2.5), GeneralizedTime from 2050. */
function time(date: Date): Buffer {
  const year = date.getUTCFullYear();
  const rest =
    two(date.getUTCMonth() + 1) +
    two(date.getUTCDate()) +
    two(date.getUTCHours()) +
    two(date.getUTCMinutes()) +
    two(date.getUTCSeconds()) +
    "Z";
  if (year >= 2050) return tlv(TAG.generalizedTime, Buffer.from(String(year) + rest, "ascii"));
  if (year < 1950) throw new RangeError("Certificate dates before 1950 are not supported");
  return tlv(TAG.utcTime, Buffer.from(two(year % 100) + rest, "ascii"));
}

function ipv4Bytes(address: string): Buffer {
  const parts = address.split(".");
  const octets = parts.map((p) => (/^(0|[1-9][0-9]{0,2})$/.test(p) ? Number(p) : Number.NaN));
  if (octets.length !== 4 || octets.some((o) => !(o >= 0 && o <= 255))) {
    throw new RangeError("The certificate address must be a dotted IPv4 address");
  }
  return Buffer.from(octets);
}

function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return tlv(
    TAG.sequence,
    oid(id),
    ...(critical ? [tlv(TAG.boolean, Buffer.from([0xff]))] : []),
    tlv(TAG.octetString, value),
  );
}

export interface SelfSignedOptions {
  privateKey: KeyObject;
  /** Defaults to the public half of `privateKey`. */
  publicKey?: KeyObject;
  /** The one LAN address the certificate names (subjectAltName iPAddress). */
  address: string;
  commonName?: string;
  notBefore: Date;
  notAfter: Date;
  /** Tests pin the serial; otherwise 16 random bytes with the top bit clear. */
  serial?: Buffer;
}

/** Returns a PEM certificate. The key must be an ECDSA P-256 key; anything else is refused. */
export function buildSelfSignedCertificate(options: SelfSignedOptions): string {
  const publicKey = options.publicKey ?? createPublicKey(options.privateKey);
  const details = publicKey.asymmetricKeyDetails;
  if (publicKey.asymmetricKeyType !== "ec" || details?.namedCurve !== "prime256v1") {
    throw new TypeError("The phone link certificate needs an ECDSA P-256 key");
  }
  if (!(options.notAfter.getTime() > options.notBefore.getTime())) {
    throw new RangeError("notAfter must be after notBefore");
  }
  const serial =
    options.serial ?? Buffer.concat([Buffer.from([randomBytes(1)[0]! & 0x7f]), randomBytes(15)]);
  const algorithm = tlv(TAG.sequence, oid(OID.ecdsaWithSha256));
  const name = tlv(
    TAG.sequence,
    tlv(
      TAG.set,
      tlv(
        TAG.sequence,
        oid(OID.commonName),
        tlv(TAG.utf8String, Buffer.from(options.commonName ?? "Phoenix Phone Link", "utf8")),
      ),
    ),
  );
  const extensions = tlv(
    TAG.explicit3,
    tlv(
      TAG.sequence,
      // cA is DEFAULT FALSE, so an empty SEQUENCE: this certificate can never sign another.
      extension(OID.basicConstraints, true, tlv(TAG.sequence)),
      // digitalSignature only (bit 0): 7 unused bits, 0b1000_0000.
      extension(OID.keyUsage, true, tlv(TAG.bitString, Buffer.from([0x07, 0x80]))),
      extension(OID.extKeyUsage, false, tlv(TAG.sequence, oid(OID.serverAuth))),
      extension(
        OID.subjectAltName,
        false,
        tlv(TAG.sequence, tlv(TAG.ipAddress, ipv4Bytes(options.address))),
      ),
    ),
  );
  const tbs = tlv(
    TAG.sequence,
    tlv(TAG.explicit0, tlv(TAG.integer, Buffer.from([0x02]))), // v3
    positiveInteger(serial),
    algorithm,
    name,
    tlv(TAG.sequence, time(options.notBefore), time(options.notAfter)),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    extensions,
  );
  // Node's default ECDSA signature encoding is DER (SEQUENCE { r, s }), which is what X.509 holds.
  const signature = sign("sha256", tbs, options.privateKey);
  const der = tlv(TAG.sequence, tbs, algorithm, tlv(TAG.bitString, Buffer.from([0x00]), signature));
  const base64 = der
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n");
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

/** The persisted TLS identity of the LAN listener. */
export interface TlsIdentity {
  key: string;
  cert: string;
  /** SHA-256 of the DER certificate: uppercase hex pairs joined by `:` (what a phone pins). */
  fingerprint: string;
}

export const CERT_VALIDITY_DAYS = 90;
/** A certificate with less than this left is reissued (the fingerprint then changes). */
export const CERT_RENEW_BEFORE_DAYS = 30;
const DAY_MS = 86_400_000;
const KEY_FILE = "tls-key.pem";
const CERT_FILE = "tls-cert.pem";

function readKey(path: string): KeyObject | undefined {
  try {
    const key = createPrivateKey(readFileSync(path));
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
      ? key
      : undefined;
  } catch {
    return undefined;
  }
}

function readCertificate(path: string): X509Certificate | undefined {
  try {
    return new X509Certificate(readFileSync(path));
  } catch {
    return undefined;
  }
}

/**
 * Loads the key and certificate under `dir`, creating whatever is missing, unreadable, for another
 * key or address, or close to expiry. The private key file is mode 0600 (like the session token
 * file); it never leaves this machine and is not part of any export.
 */
export function ensureTlsIdentity(dir: string, address: string, now: number): TlsIdentity {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700); // a directory an older build or the user made wider is tightened
  const keyPath = join(dir, KEY_FILE);
  const certPath = join(dir, CERT_FILE);
  let privateKey = readKey(keyPath);
  if (privateKey) {
    chmodSync(keyPath, 0o600);
  } else {
    privateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), {
      mode: 0o600,
    });
    chmodSync(keyPath, 0o600);
  }
  let cert = readCertificate(certPath);
  const reusable =
    cert !== undefined &&
    cert.checkPrivateKey(privateKey) &&
    cert.checkIP(address) !== undefined &&
    Date.parse(cert.validFrom) <= now &&
    Date.parse(cert.validTo) - now > CERT_RENEW_BEFORE_DAYS * DAY_MS;
  if (!cert || !reusable) {
    const pem = buildSelfSignedCertificate({
      privateKey,
      address,
      notBefore: new Date(now - 5 * 60_000),
      notAfter: new Date(now + CERT_VALIDITY_DAYS * DAY_MS),
    });
    writeFileSync(certPath, pem, { mode: 0o600 });
    cert = new X509Certificate(pem);
  }
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: cert.toString(),
    fingerprint: cert.fingerprint256,
  };
}

/** Deletes the key and certificate; the next start creates new ones (phones must pair again). */
export function removeTlsIdentity(dir: string): void {
  rmSync(join(dir, KEY_FILE), { force: true });
  rmSync(join(dir, CERT_FILE), { force: true });
}
