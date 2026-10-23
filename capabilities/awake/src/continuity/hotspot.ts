// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Hotspot failover (macOS only, UNVERIFIED on a real Mac): when the Wi-Fi drops during a keep-awake
// session, join the iPhone hotspot the user chose.
//
//   networksetup -listallhardwareports            read: finds the Wi-Fi device (`en0`)
//   networksetup -getairportnetwork <device>      read: the network to remember
//   networksetup -setairportnetwork <device> <ssid> [password]    the join
//
// The password question. `-setairportnetwork` has no stdin/file/keychain option for the password:
// when given, it is an argv element, readable by every local process (`ps`) while the call runs.
// Two modes follow, and the SAFE one is the default:
//   known_network     no password argument. macOS joins a network it already knows (the hotspot was
//                     joined once by hand, so its password is in the system keychain). Nothing
//                     secret is ever on a command line. [on paper: networksetup's usage marks the
//                     password optional; never run here]
//   keychain_password the user opted in (`allow_password_argv`) AND stored the capability secret
//                     `hotspot_password`: it is read from Phoenix's keychain entry and passed as the
//                     last argv element, visible to other local processes for that one call.
// `security` cannot join Wi-Fi networks, so there is no better non-interactive route.
// The password is never logged, put in an event, a status, an error or an audit record: results
// carry fixed reason codes only, and every string that leaves this file is scrubbed of it.
import { isValidSsid, isWifiDevice } from "./config";
import type { Platform, Runner } from "../system";

export type JoinMode = "known_network" | "keychain_password";

export type JoinFailure =
  | "unsupported_platform"
  | "no_wifi_device"
  | "no_hotspot_configured"
  | "bad_password"
  | "join_failed";

export type JoinResult =
  { joined: true; mode: JoinMode; already: boolean } | { joined: false; reason: JoinFailure };

/** The network Wi-Fi was on before failover. Never holds a password. */
export interface PreviousNetwork {
  /** null: the Mac was not on a network (or Phoenix could not read which). */
  ssid: string | null;
  device: string;
  at: number;
}

/**
 * Where the previous network is kept (`previous-network.ts` holds the real one: a small private
 * file in the Core data dir, so "rejoin my previous network" survives a Core restart). The store
 * never returns an expired record and never holds a password.
 */
export interface PreviousNetworkStore {
  get(): PreviousNetwork | null;
  set(value: PreviousNetwork): void;
  clear(): void;
}

/** `networksetup -listallhardwareports`: the first Wi-Fi port's device, if it is a plain `enN`. */
export function parseWifiDevice(output: string): string | null {
  for (const block of output.split(/\n\s*\n/)) {
    const port = /^Hardware Port:\s*(.+)$/m.exec(block)?.[1]?.trim();
    if (port !== "Wi-Fi" && port !== "AirPort") continue;
    const device = /^Device:\s*(\S+)\s*$/m.exec(block)?.[1];
    if (isWifiDevice(device)) return device;
  }
  return null;
}

/** `networksetup -getairportnetwork`: the SSID, null when not associated, undefined when unreadable. */
export function parseCurrentNetwork(output: string): string | null | undefined {
  const named = /^Current Wi-Fi Network:\s*(.+?)\s*$/m.exec(output)?.[1];
  if (named !== undefined) return isValidSsid(named) ? named : undefined;
  if (/not associated/i.test(output)) return null;
  return undefined;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** WPA2 passphrase (8-63 printable characters) or a 64-digit hex key; never starts with `-`. */
export function isUsablePassword(value: unknown): value is string {
  if (typeof value !== "string" || value.startsWith("-") || CONTROL.test(value)) return false;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
  return new TextEncoder().encode(value).length >= 8 && value.length <= 63;
}

const JOIN_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 10_000;
/** Absolute path: the PATH is never searched for a tool that can change the network. */
export const NETWORKSETUP = "/usr/sbin/networksetup";
/** `networksetup` exits 0 even when the join fails; it says so in words. */
const JOIN_FAILED = /failed|could not|error|not found|unable/i;

export interface HotspotOptions {
  run: Runner;
  platform: Platform;
  ssid: string | null;
  allowPasswordArgv: boolean;
  /** Reads the capability secret `hotspot_password` (OS keychain). */
  secret: () => Promise<string | undefined>;
  store: PreviousNetworkStore;
  now: () => number;
}

export class HotspotController {
  private inFlight = false;

  constructor(private readonly o: HotspotOptions) {}

  get configured(): boolean {
    return this.o.ssid !== null && isValidSsid(this.o.ssid);
  }

  private async device(): Promise<string | null> {
    const listed = await this.o.run(NETWORKSETUP, ["-listallhardwareports"], {
      timeoutMs: READ_TIMEOUT_MS,
    });
    return listed.code === 0 ? parseWifiDevice(listed.stdout) : null;
  }

  private async currentNetwork(device: string): Promise<string | null | undefined> {
    const got = await this.o.run(NETWORKSETUP, ["-getairportnetwork", device], {
      timeoutMs: READ_TIMEOUT_MS,
    });
    return got.code === 0 ? parseCurrentNetwork(got.stdout + got.stderr) : undefined;
  }

  /** Joins the chosen hotspot after remembering the current network. One join at a time. */
  async join(): Promise<JoinResult> {
    const ssid = this.o.ssid;
    if (this.o.platform !== "darwin") return { joined: false, reason: "unsupported_platform" };
    if (ssid === null || !isValidSsid(ssid))
      return { joined: false, reason: "no_hotspot_configured" };
    if (this.inFlight) return { joined: false, reason: "join_failed" };
    this.inFlight = true;
    try {
      const device = await this.device();
      if (device === null) return { joined: false, reason: "no_wifi_device" };

      const current = await this.currentNetwork(device);
      if (current === ssid) {
        return { joined: true, mode: "known_network", already: true };
      }

      let password: string | undefined;
      if (this.o.allowPasswordArgv) {
        password = await this.o.secret();
        if (password !== undefined && !isUsablePassword(password)) {
          return { joined: false, reason: "bad_password" };
        }
      }

      // Journal-before-change: the previous network is recorded before anything is changed. A
      // record of a real network is never replaced by "not associated" / "unreadable" (the Wi-Fi
      // already dropped to the hotspot, or a prior failed attempt): that would lose the way back.
      const kept = this.o.store.get();
      if (current != null || kept === null || kept.ssid === null) {
        this.o.store.set({ ssid: current ?? null, device, at: this.o.now() });
      }

      const args = [
        "-setairportnetwork",
        device,
        ssid,
        ...(password === undefined ? [] : [password]),
      ];
      const joined = await this.o.run(NETWORKSETUP, args, { timeoutMs: JOIN_TIMEOUT_MS });
      if (joined.code !== 0 || JOIN_FAILED.test(joined.stdout + joined.stderr)) {
        return { joined: false, reason: "join_failed" };
      }
      return {
        joined: true,
        mode: password === undefined ? "known_network" : "keychain_password",
        already: false,
      };
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Rejoins the remembered network (a known network: no password argument, ever). Not asked when
   * the Mac is already on it: the record is dropped and nothing is changed.
   */
  async rejoinPrevious(): Promise<JoinResult> {
    if (this.o.platform !== "darwin") return { joined: false, reason: "unsupported_platform" };
    const previous = this.o.store.get();
    if (previous === null || previous.ssid === null || !isValidSsid(previous.ssid)) {
      return { joined: false, reason: "no_hotspot_configured" };
    }
    if (!isWifiDevice(previous.device)) return { joined: false, reason: "no_wifi_device" };
    if ((await this.currentNetwork(previous.device)) === previous.ssid) {
      this.o.store.clear();
      return { joined: true, mode: "known_network", already: true };
    }
    const rejoin = ["-setairportnetwork", previous.device, previous.ssid];
    const done = await this.o.run(NETWORKSETUP, rejoin, { timeoutMs: JOIN_TIMEOUT_MS });
    if (done.code !== 0 || JOIN_FAILED.test(done.stdout + done.stderr)) {
      return { joined: false, reason: "join_failed" };
    }
    this.o.store.clear();
    return { joined: true, mode: "known_network", already: false };
  }
}
