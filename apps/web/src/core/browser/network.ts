// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export type PrivateReason =
  | "loopback"
  | "private_range"
  | "link_local"
  | "shared_address"
  | "unspecified"
  | "multicast"
  | "reserved"
  | "local_name";

export type HostClass = { kind: "public" } | { kind: "private"; reason: PrivateReason };

const PUBLIC: HostClass = { kind: "public" };

function priv(reason: PrivateReason): HostClass {
  return { kind: "private", reason };
}

/** Names that never resolve on the public internet. A single label (`router`) is an intranet name. */
const LOCAL_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "lan",
  "home.arpa",
  "intranet",
  "corp",
  "home",
  "private",
  "localdomain",
];

/**
 * Parse a host the way the WHATWG URL parser does for IPv4: 1-4 parts, each decimal, `0x` hex or
 * leading-zero octal. `null` means "not an IPv4 address"; "invalid" means it ends in a number but
 * is not a valid address (the URL parser rejects those, so a caller that sees one must refuse it).
 */
function parseIpv4(host: string): [number, number, number, number] | null | "invalid" {
  const parts = host.split(".");
  if (parts[parts.length - 1] === "") parts.pop();
  const last = parts[parts.length - 1];
  if (last === undefined || !/^(0x[0-9a-f]*|\d+)$/i.test(last)) return null;
  if (parts.length > 4) return "invalid";
  const numbers: number[] = [];
  for (const part of parts) {
    let value: number;
    if (/^0x[0-9a-f]*$/i.test(part)) value = part.length === 2 ? 0 : Number.parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part, 8);
    else if (/^\d+$/.test(part)) value = Number.parseInt(part, 10);
    else return "invalid";
    if (!Number.isSafeInteger(value)) return "invalid";
    numbers.push(value);
  }
  const tail = numbers.pop() as number;
  if (numbers.some((n) => n > 255)) return "invalid";
  if (tail >= 256 ** (5 - parts.length)) return "invalid";
  let address = tail;
  numbers.forEach((n, i) => {
    address += n * 256 ** (3 - i);
  });
  return [(address >>> 24) & 255, (address >>> 16) & 255, (address >>> 8) & 255, address & 255];
}

function classifyIpv4([a, b, c]: readonly [number, number, number, number]): HostClass {
  if (a === 0) return priv("unspecified");
  if (a === 127) return priv("loopback");
  if (a === 10) return priv("private_range");
  if (a === 172 && b >= 16 && b <= 31) return priv("private_range");
  if (a === 192 && b === 168) return priv("private_range");
  if (a === 169 && b === 254) return priv("link_local");
  if (a === 100 && b >= 64 && b <= 127) return priv("shared_address");
  if (a >= 224 && a <= 239) return priv("multicast");
  if (a >= 240) return priv("reserved");
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return priv("reserved");
  if (a === 192 && b === 88 && c === 99) return priv("reserved");
  if (a === 198 && (b === 18 || b === 19)) return priv("reserved");
  if (a === 198 && b === 51 && c === 100) return priv("reserved");
  if (a === 203 && b === 0 && c === 113) return priv("reserved");
  return PUBLIC;
}

/** Eight 16-bit groups, or `null` when the text is not a valid IPv6 address. */
function parseIpv6(text: string): number[] | null {
  let source = text;
  // An embedded dotted IPv4 tail (::ffff:127.0.0.1) becomes two hex groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(source);
  if (dotted) {
    const octets = dotted.slice(1, 5).map(Number);
    if (octets.some((o) => o > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    source =
      source.slice(0, dotted.index) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0] ?? "");
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1] ?? "");
  if (tail === null || head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

function embeddedIpv4(g: readonly number[], hi: number): [number, number, number, number] {
  const x = g[hi] ?? 0;
  const y = g[hi + 1] ?? 0;
  return [x >> 8, x & 255, y >> 8, y & 255];
}

function classifyIpv6(g: readonly number[]): HostClass {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const upperZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (upperZero && g5 === 0 && g6 === 0 && g7 === 0) return priv("unspecified");
  if (upperZero && g5 === 0 && g6 === 0 && g7 === 1) return priv("loopback");
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated IPv4-compatible).
  if (upperZero && (g5 === 0xffff || g5 === 0)) return classifyIpv4(embeddedIpv4(g, 6));
  // NAT64 well-known prefix 64:ff9b::/96 carries an IPv4 address in the last 32 bits.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return classifyIpv4(embeddedIpv4(g, 6));
  }
  // 6to4 2002::/16 carries the IPv4 address in bits 16-47.
  if (g0 === 0x2002) return classifyIpv4(embeddedIpv4(g, 1));
  if ((g0 & 0xffc0) === 0xfe80) return priv("link_local");
  if ((g0 & 0xfe00) === 0xfc00) return priv("private_range");
  if ((g0 & 0xff00) === 0xff00) return priv("multicast");
  // Teredo (2001::/32) and documentation (2001:db8::/32) space is not routable to a real site.
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return priv("reserved");
  return PUBLIC;
}

/**
 * Whether a host names a machine on the user's own computer or network. Pass `URL.hostname`.
 * DNS is out of scope: a public name that resolves to a private address (DNS rebinding) is only
 * catchable where the connection is made, so the Rust host has to repeat this check on the
 * resolved address.
 */
export function classifyHost(hostname: string): HostClass {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    const groups = parseIpv6(host.slice(1, -1));
    return groups === null ? priv("reserved") : classifyIpv6(groups);
  }
  while (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "") return priv("reserved");
  const v4 = parseIpv4(host);
  if (v4 === "invalid") return priv("reserved");
  if (v4 !== null) return classifyIpv4(v4);
  if (!host.includes(".")) return priv("local_name");
  for (const suffix of LOCAL_SUFFIXES) {
    if (host === suffix || host.endsWith("." + suffix)) return priv("local_name");
  }
  return PUBLIC;
}

/** Ports a browser must not talk to (WHATWG Fetch "bad ports"): they reach non-HTTP daemons. */
const BAD_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

export function isBadPort(port: number): boolean {
  return BAD_PORTS.has(port);
}
