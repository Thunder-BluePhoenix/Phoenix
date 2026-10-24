// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Token balances (ERC-20, TRC-20, Stellar assets, Algorand assets, Cosmos denominations), read-only.
//
// Which tokens are asked about comes ONLY from the owner's watch list (config `tokens`): the
// contract/asset identifier, a display symbol and the decimals are the owner's. Nothing a service
// answers can add a token, rename one or change how an amount is scaled: a response row counts only
// when its identifier is on the list, and where the service also reports decimals they must equal the
// owner's, otherwise the whole read fails. Amounts are integers in the token's smallest unit, parsed
// from strings into BigInt; no JSON float ever carries a balance (one case, Algorand, is a JSON number
// and is refused unless it is a safe integer). The service sees only the wallet address, exactly as for
// the native coin: the watch list is applied here, not sent.
//
// Response shapes come from each service's public documentation and were NOT checked against the live
// services (see README).
import { createHash } from "node:crypto";
import { expectArray, expectObject, isObject, seg } from "@phoenix/service-kit";

/** At most this many tokens per network are read; the rest of a longer list is ignored. */
export const MAX_TOKENS_PER_NETWORK = 10;
export const MAX_TOKEN_DECIMALS = 36;
/** Longest list entries looked at before the rest is just counted as ignored. */
const MAX_LIST_ENTRIES = 50;
const SYMBOL = /^[A-Za-z0-9]{1,12}$/;
const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
/** A uint256 has at most 78 decimal digits; nothing longer is a balance. */
const UNITS = /^(0|[1-9]\d{0,77})$/;
const UINT256 = 2n ** 256n;

/** One owner-chosen token on one network. `contract` is already validated and normalised. */
export interface TokenWatch {
  contract: string;
  /** Display symbol chosen by the owner; never taken from a response. */
  symbol: string;
  decimals: number;
}

export interface TokenSupport {
  /** Shape of the identifier (also used in the config schema). */
  contract: RegExp;
  /** The identifier in the form `parse` compares against, or undefined when it is not valid. */
  normalise(contract: string): string | undefined;
  /** Networks whose token amounts always have the same decimals. */
  fixedDecimals?: number;
  /** Path and query for an address that already matched the network's address pattern. */
  path(address: string): string;
  /**
   * Smallest-unit balances of the `wanted` identifiers (value: the owner's decimals) found in the
   * body. An identifier that is absent is a zero balance. Throws when the body is unusable.
   */
  parse(body: unknown, wanted: ReadonlyMap<string, number>): Map<string, bigint>;
}

function unusable(): never {
  throw new TypeError("unexpected response");
}

/** A non-negative integer string of at most 78 digits below 2^256 as a bigint; else undefined. */
export function unitsOf(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !UNITS.test(value)) return undefined;
  const n = BigInt(value);
  return n < UINT256 ? n : undefined;
}

/** The exact decimal text of `units` / 10^decimals, trailing zeros removed ("1.5", "0.000001", "7"). */
export function decimalText(units: bigint, decimals: number): string {
  const digits = units.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** `units` / 10^decimals rounded half-up to 8 decimals, with the rounding done in integers. */
export function roundedAmount(units: bigint, decimals: number): number {
  const eighths =
    decimals > 8
      ? (units + 10n ** BigInt(decimals - 8) / 2n) / 10n ** BigInt(decimals - 8)
      : units * 10n ** BigInt(8 - decimals);
  return Number(eighths) / 1e8;
}

/** A TRON address with a correct Base58Check checksum and the mainnet prefix 0x41. */
function validTronAddress(value: string): string | undefined {
  if (!new RegExp(`^T${BASE58}{33}$`).test(value)) return undefined;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of value) n = n * 58n + BigInt(alphabet.indexOf(ch));
  const hex = n.toString(16).padStart(50, "0");
  if (hex.length !== 50) return undefined;
  const bytes = Buffer.from(hex, "hex");
  if (bytes[0] !== 0x41) return undefined;
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest();
  const expected = sha(sha(bytes.subarray(0, 21))).subarray(0, 4);
  return expected.equals(bytes.subarray(21)) ? value : undefined;
}

/** ERC-20 through the same Blockscout hosts as the native balance. */
const EVM_CONTRACT = /^0x[0-9a-fA-F]{40}$/;
export const evmTokens: TokenSupport = {
  contract: EVM_CONTRACT,
  // Case is not significant to the chain; the mixed-case (EIP-55) checksum needs keccak, which
  // node:crypto does not have, so only the format is checked.
  normalise: (c) => (EVM_CONTRACT.test(c) ? c.toLowerCase() : undefined),
  path: (a) => `/api/v2/addresses/${seg(a)}/token-balances`,
  parse(body, wanted) {
    const found = new Map<string, bigint>();
    for (const row of expectArray(body)) {
      if (!isObject(row) || !isObject(row.token)) continue;
      const { token } = row;
      const id = token.address_hash ?? token.address;
      if (typeof id !== "string") continue;
      const contract = id.toLowerCase();
      const decimals = wanted.get(contract);
      if (decimals === undefined) continue;
      // A watched contract that is not a fungible ERC-20 row (a collectible, say) is not counted.
      if (token.type !== "ERC-20") continue;
      const reported =
        typeof token.decimals === "string" && /^\d{1,2}$/.test(token.decimals)
          ? Number(token.decimals)
          : token.decimals;
      if (reported !== decimals) unusable();
      const units = unitsOf(row.value) ?? unusable();
      if (found.has(contract)) unusable();
      found.set(contract, units);
    }
    return found;
  },
};

/** TRC-20 balances ride in the same `/v1/accounts/{a}` answer as TRX: `data[0].trc20`. */
export const trc20: TokenSupport = {
  contract: new RegExp(`^T${BASE58}{33}$`),
  normalise: validTronAddress,
  path: (a) => `/v1/accounts/${seg(a)}`,
  parse(body, wanted) {
    const found = new Map<string, bigint>();
    const { data } = expectObject(body);
    if (!Array.isArray(data)) return unusable();
    const first: unknown = data[0];
    // An account that was never activated is absent from `data`; one with no tokens has no list.
    if (first === undefined) return found;
    const { trc20: list } = expectObject(first);
    if (list === undefined) return found;
    for (const entry of expectArray(list)) {
      for (const [contract, value] of Object.entries(expectObject(entry))) {
        if (!wanted.has(contract)) continue;
        const units = unitsOf(value) ?? unusable();
        if (found.has(contract)) unusable();
        found.set(contract, units);
      }
    }
    return found;
  },
};

/** Stellar credit assets, `CODE:ISSUER`, from the account's `balances` (always 7 decimals). */
export const stellarTokens: TokenSupport = {
  contract: /^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/,
  normalise: (c) => (stellarTokens.contract.test(c) ? c : undefined),
  fixedDecimals: 7,
  path: (a) => `/accounts/${seg(a)}`,
  parse(body, wanted) {
    const found = new Map<string, bigint>();
    for (const row of expectArray(expectObject(body).balances)) {
      if (!isObject(row)) continue;
      if (row.asset_type !== "credit_alphanum4" && row.asset_type !== "credit_alphanum12") continue;
      if (typeof row.asset_code !== "string" || typeof row.asset_issuer !== "string") continue;
      const contract = `${row.asset_code}:${row.asset_issuer}`;
      if (!wanted.has(contract)) continue;
      const m = /^(\d{1,19})\.(\d{7})$/.exec(typeof row.balance === "string" ? row.balance : "");
      if (!m) return unusable();
      if (found.has(contract)) unusable();
      found.set(contract, BigInt(`${m[1]}${m[2]}`));
    }
    return found;
  },
};

/** Algorand Standard Assets by numeric id, from the account's `assets` list. */
export const algorandAssets: TokenSupport = {
  contract: /^[1-9]\d{0,15}$/,
  normalise: (c) => (algorandAssets.contract.test(c) ? c : undefined),
  path: (a) => `/v2/accounts/${seg(a)}`,
  parse(body, wanted) {
    const found = new Map<string, bigint>();
    const { assets } = expectObject(body);
    // The node leaves the list out when the account holds no assets.
    if (assets === undefined || assets === null) return found;
    for (const row of expectArray(assets)) {
      if (!isObject(row)) continue;
      const id = row["asset-id"];
      if (typeof id !== "number" || !Number.isSafeInteger(id)) continue;
      const contract = String(id);
      if (!wanted.has(contract)) continue;
      // A JSON number: beyond 2^53 it has already lost digits, so it is refused, not rounded.
      const amount = row.amount;
      if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) unusable();
      if (found.has(contract)) unusable();
      found.set(contract, BigInt(amount));
    }
    return found;
  },
};

/** Cosmos bank denominations (`ibc/HASH`, `factory/…`) from the account's bank balances. */
export const cosmosDenoms: TokenSupport = {
  contract: /^[a-zA-Z][a-zA-Z0-9/:._-]{2,127}$/,
  normalise: (c) => (cosmosDenoms.contract.test(c) ? c : undefined),
  path: (a) => `/cosmos/bank/v1beta1/balances/${seg(a)}?pagination.limit=1000`,
  parse(body, wanted) {
    const found = new Map<string, bigint>();
    const o = expectObject(body);
    // More pages than one: a missing denomination could be on the next, so a partial answer fails.
    const next = isObject(o.pagination) ? o.pagination.next_key : undefined;
    if (next !== undefined && next !== null && next !== "") unusable();
    for (const row of expectArray(o.balances)) {
      if (!isObject(row) || typeof row.denom !== "string" || !wanted.has(row.denom)) continue;
      const units = unitsOf(row.amount) ?? unusable();
      if (found.has(row.denom)) unusable();
      found.set(row.denom, units);
    }
    return found;
  },
};

function watchEntry(support: TokenSupport, item: unknown): TokenWatch | undefined {
  if (!isObject(item)) return undefined;
  const { contract: raw, symbol, decimals: given } = item;
  if (typeof raw !== "string" || raw.length > 160 || typeof symbol !== "string") return undefined;
  const contract = support.normalise(raw);
  if (contract === undefined || !SYMBOL.test(symbol)) return undefined;
  const decimals = given ?? support.fixedDecimals;
  if (typeof decimals !== "number" || !Number.isInteger(decimals)) return undefined;
  if (decimals < 0 || decimals > MAX_TOKEN_DECIMALS) return undefined;
  if (support.fixedDecimals !== undefined && decimals !== support.fixedDecimals) return undefined;
  return { contract, symbol, decimals };
}

/**
 * The owner's list for one network, validated entry by entry. An invalid entry, a repeated
 * contract or an entry past the cap is dropped and counted in `ignored`, never guessed at.
 */
export function readWatchList(
  support: TokenSupport,
  list: unknown,
): { watch: TokenWatch[]; ignored: number } {
  const watch: TokenWatch[] = [];
  if (!Array.isArray(list)) return { watch, ignored: 0 };
  const seen = new Set<string>();
  let ignored = Math.max(list.length - MAX_LIST_ENTRIES, 0);
  for (const item of list.slice(0, MAX_LIST_ENTRIES) as unknown[]) {
    const entry = watchEntry(support, item);
    if (!entry || seen.has(entry.contract) || watch.length >= MAX_TOKENS_PER_NETWORK) {
      ignored++;
      continue;
    }
    seen.add(entry.contract);
    watch.push(entry);
  }
  return { watch, ignored };
}
