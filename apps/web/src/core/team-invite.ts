// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 92: the team invite. A teammate is added from a pasted invite instead of a hand-copied id and
// public key. The invite is public information only: the team id, the P-256 public key and an optional
// display name. Nothing in it is secret and the private key is never an input here.
//
//   phoenix-team:v1:<base64url(JSON {"id","public_key","label"?})>.<8 hex checksum>
//
// The checksum is the first 4 bytes of SHA-256 over everything before the dot. It only catches copy and
// typing mistakes. It is NOT a signature and proves nothing about who made the invite: anyone can make
// one with any key. The protection against a swapped invite is the key fingerprint, which the person
// compares with the teammate through another channel before adding.
//
// Id, label and key are checked as Core checks them when the teammate is added (Core stays the
// authority and re-checks everything); the invite is parsed strictly, with no extra fields.

export const INVITE_PREFIX = "phoenix-team:";
export const INVITE_VERSION_PREFIX = `${INVITE_PREFIX}v1:`;
/** Longest invite accepted: the real maximum is about 400 characters. */
export const INVITE_MAX_CHARS = 1024;
export const INVITE_LABEL_MAX = 40;

const TEAM_ID = /^tm_[a-f0-9]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CHECKSUM = /^[0-9a-f]{8}$/;
/** An SPKI-encoded P-256 public key is always 91 bytes (26 bytes of header, then 04 || X || Y). */
const P256_SPKI_BYTES = 91;
/** Control, line-separator, bidi and zero-width characters, as Core refuses them in a label. */
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;
const UNSAFE_TEXT_ALL = new RegExp(UNSAFE_TEXT.source, "gu");

export interface TeamInvite {
  id: string;
  publicKey: string;
  label: string | null;
}

/** Why an invite was refused; the component turns each into a translated sentence. */
export type InviteRefusal =
  | "empty"
  | "too_long"
  | "format"
  | "version"
  | "checksum"
  | "content"
  | "id"
  | "key"
  | "label"
  | "unsupported";

export type ParsedInvite = { ok: true; invite: TeamInvite } | { ok: false; refusal: InviteRefusal };

/** Thrown by {@link createInvite} when the identity it is given is not a valid team identity. */
export class InviteInputError extends Error {}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("Web Crypto is not available");
  return api;
}

const utf8 = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new TextEncoder().encode(text));

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().digest("SHA-256", bytes));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const toBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Strict: only the canonical, unpadded encoding of the bytes is accepted, so one invite has one spelling. */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(text)) return null;
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bytes = base64ToBytes(padded);
  return bytes !== null && toBase64Url(bytes) === text ? bytes : null;
}

/** The label as an invite carries it: unsafe characters dropped, whitespace collapsed, at most 40 characters. */
export function cleanInviteLabel(raw: string): string {
  const cleaned = raw.replace(UNSAFE_TEXT_ALL, "").replace(/\s+/g, " ").trim();
  const chars = [...cleaned];
  let out = "";
  for (const char of chars) {
    if (out.length + char.length > INVITE_LABEL_MAX) break;
    out += char;
  }
  return out.trim();
}

export const isInviteLabel = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= INVITE_LABEL_MAX &&
  !UNSAFE_TEXT.test(value);

export const isTeamId = (value: unknown): value is string =>
  typeof value === "string" && TEAM_ID.test(value);

/** True for the exact public key Core pins: canonical base64 of an SPKI P-256 key whose point is on the curve. */
export async function isTeamPublicKey(value: unknown): Promise<boolean> {
  if (typeof value !== "string" || !BASE64.test(value) || value.length > 256) return false;
  const bytes = base64ToBytes(value);
  if (bytes === null || bytes.length !== P256_SPKI_BYTES || bytesToBase64(bytes) !== value)
    return false;
  try {
    await subtle().importKey("spki", bytes, { name: "ECDSA", namedCurve: "P-256" }, true, [
      "verify",
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * A short fingerprint of a public key for comparing out loud or in a chat: the first 16 bytes of the
 * SHA-256 of the key's DER bytes, as 8 groups of 4 lowercase hex digits. Null when the key is not base64.
 */
export async function keyFingerprint(publicKey: string): Promise<string | null> {
  if (!BASE64.test(publicKey) || publicKey.length > 256) return null;
  const bytes = base64ToBytes(publicKey);
  if (bytes === null) return null;
  const digest = toHex((await sha256(bytes)).subarray(0, 16));
  return digest.match(/.{4}/g)!.join(" ");
}

const checksumOf = async (signed: string) => toHex((await sha256(utf8(signed))).subarray(0, 4));

/** The one JSON spelling of an invite: fixed key order, no spaces. Parsing refuses any other spelling. */
const canonical = (invite: TeamInvite) =>
  JSON.stringify(
    invite.label === null
      ? { id: invite.id, public_key: invite.publicKey }
      : { id: invite.id, public_key: invite.publicKey, label: invite.label },
  );

/** Builds the invite string for this install's public identity. The label is cleaned and may be empty. */
export async function createInvite(identity: {
  id: string;
  publicKey: string;
  label?: string;
}): Promise<string> {
  const label = cleanInviteLabel(identity.label ?? "");
  if (!isTeamId(identity.id)) throw new InviteInputError("Not a team id");
  if (!(await isTeamPublicKey(identity.publicKey))) throw new InviteInputError("Not a team key");
  const json = canonical({
    id: identity.id,
    publicKey: identity.publicKey,
    label: label === "" ? null : label,
  });
  const signed = `${INVITE_VERSION_PREFIX}${toBase64Url(utf8(json))}`;
  return `${signed}.${await checksumOf(signed)}`;
}

/** Parses a pasted invite strictly. Surrounding whitespace is ignored; nothing else is repaired. */
export async function parseInvite(text: string): Promise<ParsedInvite> {
  const raw = text.trim();
  if (raw === "") return { ok: false, refusal: "empty" };
  if (raw.length > INVITE_MAX_CHARS) return { ok: false, refusal: "too_long" };
  if (!raw.startsWith(INVITE_PREFIX)) return { ok: false, refusal: "format" };
  const version = /^v([0-9]{1,3}):/.exec(raw.slice(INVITE_PREFIX.length));
  if (version === null) return { ok: false, refusal: "format" };
  if (version[1] !== "1") return { ok: false, refusal: "version" };
  const rest = raw.slice(INVITE_VERSION_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  const payload = rest.slice(0, dot);
  const checksum = rest.slice(dot + 1);
  if (dot < 1 || !BASE64URL.test(payload) || !CHECKSUM.test(checksum))
    return { ok: false, refusal: "format" };

  let expected: string;
  try {
    expected = await checksumOf(`${INVITE_VERSION_PREFIX}${payload}`);
  } catch {
    return { ok: false, refusal: "unsupported" };
  }
  if (expected !== checksum) return { ok: false, refusal: "checksum" };

  const bytes = fromBase64Url(payload);
  if (bytes === null) return { ok: false, refusal: "content" };
  let json: string;
  let value: unknown;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(json);
  } catch {
    return { ok: false, refusal: "content" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { ok: false, refusal: "content" };
  const fields = value as Record<string, unknown>;
  const names = Object.keys(fields);
  if (!names.includes("id") || !names.includes("public_key"))
    return { ok: false, refusal: "content" };
  if (names.some((name) => name !== "id" && name !== "public_key" && name !== "label"))
    return { ok: false, refusal: "content" };
  if (!isTeamId(fields.id)) return { ok: false, refusal: "id" };
  if (typeof fields.public_key !== "string" || !(await isTeamPublicKey(fields.public_key)))
    return { ok: false, refusal: "key" };
  if ("label" in fields && !isInviteLabel(fields.label)) return { ok: false, refusal: "label" };
  const invite: TeamInvite = {
    id: fields.id,
    publicKey: fields.public_key,
    label: typeof fields.label === "string" ? fields.label : null,
  };
  // One spelling only: this refuses duplicate keys, other key orders, spaces and escapes.
  if (canonical(invite) !== json) return { ok: false, refusal: "content" };
  return { ok: true, invite };
}
