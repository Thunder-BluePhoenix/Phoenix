// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Which addresses a status light may have. Shared by provisioning and the LIFX transport so both
// refuse the same things.

/** True for 10/8, 172.16/12, 192.168/16, 169.254/16 and 127/8: the owner's own network. */
export function isLocalIPv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p))) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  if (parts.some((p) => Number(p) > 255)) return false;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * A LAN address for one UDP unicast target: {@link isLocalIPv4}, and not a network or broadcast
 * address by its last octet (`.0`, `.255`). A host that really lives on such an address of a wide
 * subnet is refused too: a LIFX command must never be a broadcast, and the subnet mask is unknown.
 */
export function isLocalUnicastIPv4(address: string): boolean {
  if (!isLocalIPv4(address)) return false;
  const last = address.slice(address.lastIndexOf(".") + 1);
  return last !== "0" && last !== "255";
}
