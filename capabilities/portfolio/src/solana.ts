// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Solana native balance, read through the one JSON-RPC call that answers it.
//
// DECISION TAKEN BY THE IMPLEMENTER under a conservative reading (the owner left it open): Solana's
// public interface is JSON-RPC over POST only, and everything else in this capability is a GET
// through `ReadOnlyClient`. This file is the single, deliberate exception, and it is built so the
// exception cannot grow:
//   - one pinned host, `SOLANA_RPC_URL`; no setting, argument or test hook changes it;
//   - the request body is a constant template with one slot, and the slot only ever holds a string
//     that passed `validSolanaAddress` (base58 alphabet, decodes to exactly 32 bytes). No caller JSON
//     is ever serialised, so no other method, parameter or field can be expressed;
//   - the only method name in this file is the one in the template; the path is the constant "/";
//   - no redirects, 15 s total timeout, 64 KiB response cap, lamports parsed as BigInt from the
//     response text, fixed secret-free error messages.
// It is reversible by deleting this file and its few call sites (index.ts, collect.ts, the tests).
//
// Sources read on 2026-11-09:
// - https://solana.com/docs/rpc/http/getbalance (request shape, result `value` is a u64 of lamports)
// - https://solana.com/docs/references/clusters (public mainnet endpoint `https://api.mainnet.solana.com`,
//   rate-limited, "not intended for production applications"; 100 requests per 10 s per IP, 40 per
//   10 s for a single method)
// The response shape was NOT checked against the live service (see README).
import { ServiceError, readCapped } from "@phoenix/service-kit";

/** The one host this client talks to (Solana Labs' public mainnet endpoint, per the clusters page). */
export const SOLANA_RPC_URL = "https://api.mainnet.solana.com/";
export const SOLANA_NETWORK_ID = "sol";
export const SOLANA_NAME = "Solana";
export const SOLANA_ASSET = "SOL";
/** Largest response read (64 KiB): a getBalance answer is well under 200 bytes. */
export const SOLANA_MAX_BYTES = 64 * 1024;
export const SOLANA_TIMEOUT_MS = 15_000;
export const LAMPORTS_PER_SOL = 1_000_000_000n;

const SERVICE = SOLANA_NAME;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ADDRESS_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const U64 = 2n ** 64n;

/** The address pattern for the config schema and for filtering the owner's list. */
export const SOLANA_ADDRESS = ADDRESS_SHAPE;

/** A Solana account address: 32-44 base58 characters that decode to exactly 32 bytes. */
export function validSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string" || !ADDRESS_SHAPE.test(value)) return false;
  let n = 0n;
  for (const ch of value) n = n * 58n + BigInt(BASE58.indexOf(ch));
  // Leading "1"s are leading zero bytes; the rest is the big-endian number.
  const zeros = value.length - value.replace(/^1+/, "").length;
  const digits = n === 0n ? "" : n.toString(16);
  const bytes = zeros + Math.ceil(digits.length / 2);
  return bytes === 32;
}

/** `fetch` as far as this client needs it; tests pass a fake, the default is the global. */
export type SolanaFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SolanaClientOptions {
  /** Aborts an in-flight request (the capability was disabled). */
  signal?: AbortSignal;
  /** Test seam: a fake network. The URL it receives is always `SOLANA_RPC_URL`. */
  fetchImpl?: SolanaFetch;
}

function fail(kind: ServiceError["kind"], message: string): ServiceError {
  return new ServiceError(SERVICE, kind, message);
}

/** The request body: a constant template; `address` has already passed `validSolanaAddress`. */
function requestBody(address: string): string {
  return `{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["${address}"]}`;
}

/**
 * Lamports from a response text: structure checked on the parsed JSON, digits taken from the text
 * (a JSON number is a double and would lose digits above 2^53, which a large holder can reach).
 */
function lamportsFrom(text: string): bigint {
  const bad = () => fail("invalid", `${SERVICE} sent a response in an unexpected format`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw bad();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw bad();
  const o = parsed as Record<string, unknown>;
  if (o.jsonrpc !== "2.0" || o.id !== 1 || "error" in o) throw bad();
  const result = o.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw bad();
  const value = (result as Record<string, unknown>).value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw bad();
  // Exactly one `"value":` in the whole text, so the digits read below are the ones that were checked.
  const hits = [...text.matchAll(/"value"\s*:\s*(-?[0-9.eE+-]+)/g)];
  const only = hits[0];
  if (hits.length !== 1 || !only?.[1] || !/^(0|[1-9]\d{0,19})$/.test(only[1])) throw bad();
  const lamports = BigInt(only[1]);
  if (lamports >= U64 || Number(only[1]) !== value) throw bad();
  return lamports;
}

/**
 * Reads the lamport balance of one address. It has one method, `balance`, and that method can send
 * exactly one request shape (see the file comment); there is no way to ask for anything else.
 */
export class SolanaBalanceClient {
  /** Requests made, for bookkeeping. */
  calls = 0;

  constructor(private readonly options: SolanaClientOptions = {}) {}

  async balance(address: string): Promise<bigint> {
    if (!validSolanaAddress(address)) throw fail("invalid", "The Solana address is not valid");
    const send: SolanaFetch = this.options.fetchImpl ?? ((url, init) => fetch(url, init));
    const timeout = AbortSignal.timeout(SOLANA_TIMEOUT_MS);
    this.calls++;
    let res: Response;
    try {
      res = await send(SOLANA_RPC_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "phoenix-capability",
        },
        body: requestBody(address),
        redirect: "error",
        signal: this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout,
      });
    } catch {
      throw fail("network", `${SERVICE} is unreachable`);
    }
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => {});
      if (res.status === 429) throw fail("rate_limit", `${SERVICE} rate limit reached`);
      if (res.status === 403) throw fail("forbidden", `${SERVICE} refused the request (403)`);
      throw fail("http", `${SERVICE} answered HTTP ${res.status}`);
    }
    try {
      return lamportsFrom(await readCapped(SERVICE, res, SOLANA_MAX_BYTES, SOLANA_TIMEOUT_MS));
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw fail("invalid", `${SERVICE} sent a response in an unexpected format`);
    }
  }
}
