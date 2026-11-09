// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Philips Hue bridge support: owner-entered address, owner-confirmed certificate fingerprint,
// link-button pairing, and a transport that can only write light state (on/off, colour, brightness).
//
// Flow (the exact calls were checked against Philips' developer "Get Started" page for the v1
// `POST /api` pairing and against community notes for the CLIP v2 header; no bridge was contacted):
//   1. inspect: read the bridge certificate's SHA-256 fingerprint. The owner confirms it.
//   2. pair: the owner presses the round link button, then `POST /api {"devicetype": ...}` over a
//      connection pinned to the confirmed fingerprint. The bridge answers error 101 until the
//      button is pressed, then `[{"success":{"username": <application key>}}]`. CLIP v2 has no
//      pairing call of its own: the v1 `username` is the v2 `hue-application-key`.
//   3. The application key goes to the OS secret store and is never returned, echoed or logged.
//   4. Lights are written with `PUT /clip/v2/resource/light/<id>` and the `hue-application-key` header.
import type { DeviceTransport } from "@phoenix/capability-status-lights";
import type { AuditLog } from "@phoenix/permissions";
import type { SecretStore, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  HUE_PORT,
  HUE_TIMEOUT_MS,
  parseFingerprint,
  type HueLink,
  type HueResponse,
} from "./hue-link";
import { isLocalUnicastIPv4 } from "./lan-address";
import { createPacer } from "./pacer";

export const HUE_BRIDGES_KEY = ["status-lights", "hue-bridges"].join(".");
/** Commands to one bridge are at least this far apart (the bridge allows about 10/s for lights). */
export const HUE_MIN_INTERVAL_MS = 250;
const ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
const LIGHT_PATH = /^\/clip\/v2\/resource\/light\/[a-f\d-]{36}$/i;
/** A v1 `username` is 40 characters; be lenient but bounded and header-safe. */
const APPLICATION_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_TYPE = "phoenix#core";
const MAX_BRIDGES = 4;
const MAX_LIGHTS_LISTED = 64;

export const hueSecretRef = (bridge: string) => `status-lights.hue.${bridge}`;

export interface HueBridge {
  /** The owner's own name for the bridge; light entries refer to it. */
  id: string;
  /** An IPv4 literal on a private, link-local or loopback range; never a hostname. */
  address: string;
  /** 443 on a real bridge; another port only for a fake bridge on loopback. */
  port: number;
  /** SHA-256 of the certificate the owner confirmed at pairing, 64 lower-case hex digits. */
  fingerprint: string;
}

export interface HueLightInfo {
  id: string;
  name: string;
}

function bridgePortOk(address: string, port: unknown): port is number {
  return (
    typeof port === "number" &&
    Number.isInteger(port) &&
    (port === HUE_PORT || (address.startsWith("127.") && port > 0 && port < 65_536))
  );
}

function parseBridge(entry: unknown): HueBridge | null {
  if (entry === null || typeof entry !== "object") return null;
  const { id, address, port, fingerprint } = entry as Record<string, unknown>;
  const print = parseFingerprint(fingerprint);
  if (typeof id !== "string" || !ID.test(id) || typeof address !== "string" || !print) return null;
  return isLocalUnicastIPv4(address) && bridgePortOk(address, port)
    ? { id, address, port, fingerprint: print }
    : null;
}

export function parseBridges(value: unknown): HueBridge[] {
  if (!Array.isArray(value)) return [];
  const bridges: HueBridge[] = [];
  for (const entry of value) {
    const bridge = parseBridge(entry);
    if (bridge && !bridges.some((b) => b.id === bridge.id)) bridges.push(bridge);
  }
  return bridges;
}

/** Only these light-state fields may ever be sent to a bridge, each in its documented shape. */
function isLightState(body: Readonly<Record<string, unknown>>): boolean {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const unit = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;
  return Object.entries(body).every(([field, value]) => {
    if (!isObject(value)) return false;
    if (field === "on") return Object.keys(value).join() === "on" && typeof value.on === "boolean";
    if (field === "dimming")
      return (
        Object.keys(value).join() === "brightness" &&
        typeof value.brightness === "number" &&
        value.brightness >= 0 &&
        value.brightness <= 100
      );
    if (field === "color") {
      const xy = value.xy;
      return (
        Object.keys(value).join() === "xy" &&
        isObject(xy) &&
        Object.keys(xy).sort().join() === "x,y" &&
        unit(xy.x) &&
        unit(xy.y)
      );
    }
    return false;
  });
}

export interface HueTransportOptions {
  link: HueLink;
  bridge: HueBridge;
  /** Reads the application key at each write; it is never held anywhere longer. */
  applicationKey: () => Promise<string | undefined>;
  /** Shared by every light of one bridge, so the bridge sees one bounded stream. */
  pace: (signal: AbortSignal) => Promise<void>;
}

/** Writes light state through a pinned connection; refuses any other path or field. */
export function hueTransport(options: HueTransportOptions): DeviceTransport {
  const { link, bridge } = options;
  return {
    async request(path, body, signal) {
      if (!LIGHT_PATH.test(path)) throw new Error("Not a Hue light resource");
      if (!isLightState(body)) throw new Error("Not a Hue light state");
      const key = await options.applicationKey();
      if (!key) throw new Error("The Hue application key is not stored");
      await options.pace(signal);
      signal.throwIfAborted();
      const response = await link.request(
        bridge,
        { method: "PUT", path, headers: { "hue-application-key": key }, body },
        AbortSignal.any([signal, AbortSignal.timeout(HUE_TIMEOUT_MS)]),
      );
      // Error text from the bridge can echo input, so it is never put in the message.
      if (response.status !== 200) throw new Error(`Hue bridge answered ${response.status}`);
      const errors = parseJson(response.body)?.errors;
      if (Array.isArray(errors) && errors.length > 0)
        throw new Error("Hue bridge refused the change");
    },
    report() {
      return Promise.reject(new Error("A Hue light is not a raw-report device"));
    },
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function invalid(message: string): PhoenixError {
  return new PhoenixError(ErrorCode.INVALID_REQUEST, message);
}

function ownerAddress(address: unknown, port: unknown): { address: string; port: number } {
  if (typeof address !== "string" || !isLocalUnicastIPv4(address))
    throw invalid("A Hue bridge needs an IPv4 address on your own network (never a hostname)");
  const chosen = port === undefined ? HUE_PORT : port;
  if (!bridgePortOk(address, chosen)) throw invalid("Invalid Hue bridge port");
  return { address, port: chosen };
}

export interface HueBridgesDeps {
  settings: SettingsStore;
  secrets: SecretStore | undefined;
  audit: Pick<AuditLog, "record">;
  link: HueLink;
}

/** The bridges the owner paired. Pairing and the key's storage live here. */
export class HueBridges {
  private readonly paces = new Map<string, (signal: AbortSignal) => Promise<void>>();

  constructor(
    private readonly d: HueBridgesDeps,
    private readonly minIntervalMs = HUE_MIN_INTERVAL_MS,
  ) {}

  bridges(): HueBridge[] {
    return parseBridges(this.d.settings.get<unknown>(HUE_BRIDGES_KEY, null));
  }

  private secrets(): SecretStore {
    if (!this.d.secrets)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "No OS credential store is available to keep the Hue application key",
      );
    return this.d.secrets;
  }

  /** Step 1: shows the owner the certificate fingerprint to confirm. Nothing is sent to the bridge. */
  async inspect(
    input: unknown,
  ): Promise<{ address: string; port: number; fingerprint: string; common_name: string | null }> {
    const o = (input ?? {}) as Record<string, unknown>;
    const target = ownerAddress(o.address, o.port);
    const cert = await this.d.link.probe(target, AbortSignal.timeout(HUE_TIMEOUT_MS)).catch(() => {
      throw invalid("The Hue bridge did not answer on that address");
    });
    return { ...target, fingerprint: cert.fingerprint, common_name: cert.commonName };
  }

  /**
   * Step 2: the owner pressed the link button and confirmed `fingerprint`. Stores the bridge and
   * its application key. The key is not returned.
   */
  async pair(input: unknown): Promise<HueBridge> {
    const o = (input ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !ID.test(o.id)) throw invalid('A bridge needs an "id"');
    const fingerprint = parseFingerprint(o.fingerprint);
    if (!fingerprint) throw invalid("Confirm the bridge certificate fingerprint (64 hex digits)");
    const target = ownerAddress(o.address, o.port);
    const existing = this.bridges();
    if (!existing.some((b) => b.id === o.id) && existing.length >= MAX_BRIDGES)
      throw invalid(`At most ${MAX_BRIDGES} bridges`);
    const secrets = this.secrets();
    const bridge: HueBridge = { id: o.id, ...target, fingerprint };
    let response: HueResponse;
    try {
      response = await this.d.link.request(
        bridge,
        { method: "POST", path: "/api", headers: {}, body: { devicetype: DEVICE_TYPE } },
        AbortSignal.timeout(HUE_TIMEOUT_MS),
      );
    } catch {
      throw invalid("Could not reach the Hue bridge with the certificate you confirmed");
    }
    const first = (() => {
      try {
        const list: unknown = JSON.parse(response.body);
        return Array.isArray(list) ? (list[0] as Record<string, any> | undefined) : undefined;
      } catch {
        return undefined;
      }
    })();
    // v1 answers application errors with HTTP 200 and an `error` object; 101 is "link button not pressed".
    if (first?.error?.type === 101)
      throw invalid("Press the round link button on the bridge, then try again");
    const key: unknown = first?.success?.username;
    if (typeof key !== "string" || !APPLICATION_KEY.test(key))
      throw invalid("The Hue bridge did not give an application key");
    await secrets.set(hueSecretRef(bridge.id), key);
    this.d.settings.set(HUE_BRIDGES_KEY, [...existing.filter((b) => b.id !== bridge.id), bridge]);
    this.d.audit.record({
      actor: "user",
      action: "status_lights.hue_paired",
      capabilityId: "status-lights",
      decision: "allowed",
      details: { count: this.bridges().length },
    });
    return bridge;
  }

  /** The lights on a paired bridge, for the owner to pick from. Names are the bridge's own text. */
  async lights(bridgeId: string): Promise<HueLightInfo[]> {
    const bridge = this.bridges().find((b) => b.id === bridgeId);
    if (!bridge) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown Hue bridge");
    const key = await this.secrets().get(hueSecretRef(bridge.id));
    if (!key) throw invalid("The Hue application key is not stored; pair again");
    const response = await this.d.link
      .request(
        bridge,
        { method: "GET", path: "/clip/v2/resource/light", headers: { "hue-application-key": key } },
        AbortSignal.timeout(HUE_TIMEOUT_MS),
      )
      .catch(() => {
        throw invalid("Could not reach the Hue bridge");
      });
    if (response.status !== 200) throw invalid(`The Hue bridge answered ${response.status}`);
    const data = parseJson(response.body)?.data;
    if (!Array.isArray(data)) return [];
    const lights: HueLightInfo[] = [];
    for (const item of data.slice(0, MAX_LIGHTS_LISTED)) {
      const { id, metadata } = (item ?? {}) as { id?: unknown; metadata?: { name?: unknown } };
      if (typeof id === "string" && LIGHT_PATH.test(`/clip/v2/resource/light/${id}`))
        lights.push({
          id,
          name: typeof metadata?.name === "string" ? metadata.name.slice(0, 64) : "",
        });
    }
    return lights;
  }

  /** Forgets a bridge and deletes its application key. Provisioning removes the lights that used it. */
  async remove(bridgeId: string): Promise<void> {
    const rest = this.bridges().filter((b) => b.id !== bridgeId);
    this.d.settings.set(HUE_BRIDGES_KEY, rest);
    this.paces.delete(bridgeId);
    await this.d.secrets?.delete(hueSecretRef(bridgeId));
  }

  transport(bridge: HueBridge): DeviceTransport {
    let pace = this.paces.get(bridge.id);
    if (!pace) {
      pace = createPacer(this.minIntervalMs);
      this.paces.set(bridge.id, pace);
    }
    return hueTransport({
      link: this.d.link,
      bridge,
      applicationKey: async () => this.d.secrets?.get(hueSecretRef(bridge.id)),
      pace,
    });
  }
}
