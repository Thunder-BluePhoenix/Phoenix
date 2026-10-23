// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Which physical lights Core may reach, and how. Provisioning (an address) is separate from
// consent: a light here is never contacted until its id is also listed in the status-lights
// capability's own `devices` setting. Two kinds have a transport: the Elgato Key Light (a plain
// HTTP PUT to a LAN address) and LIFX (one unicast UDP datagram per command, acknowledged). Hue
// (bridge pairing and key) and Luxafor (USB HID) need transports that nothing here can test, so
// they cannot be provisioned yet.
import type { Device, DeviceTransport } from "@phoenix/capability-status-lights";
import { parseLifxMac, LIFX_PORT } from "@phoenix/capability-status-lights";
import type { AuditLog } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { isLocalIPv4, isLocalUnicastIPv4 } from "./lan-address";
import { lifxTransport, type LifxTransportOptions } from "./lifx-transport";

export const STATUS_LIGHT_DEVICES_KEY = "status-lights.provisioned";
const MAX_LIGHTS = 16;
const ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
const KEY_LIGHT_PORT = 9123;
const FIELDS = ["id", "kind", "address", "port", "mac"];
const WRITE_TIMEOUT_MS = 5_000;

/**
 * A provisioned light as stored and shown. The address is the owner's own LAN address. Entries
 * stored before LIFX existed are Key Lights with exactly these fields and stay valid unchanged.
 */
export type ProvisionedLight =
  | {
      id: string;
      kind: "key-light";
      /** An IPv4 literal on a private, link-local or loopback range; never a hostname. */
      address: string;
      port: number;
    }
  | {
      id: string;
      kind: "lifx";
      /** A unicast IPv4 literal on a private, link-local or loopback range; never a hostname or broadcast. */
      address: string;
      /** 56700 on a real light. */
      port: number;
      /** The light's serial as 12 lower-case hex digits. */
      mac: string;
    };

function validPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65_536;
}

/** One entry, normalised (`mac` lower-case hex), or null. `kind` is required. */
function parseLight(entry: unknown): ProvisionedLight | null {
  if (entry === null || typeof entry !== "object") return null;
  const { id, kind, address, port, mac } = entry as Record<string, unknown>;
  if (typeof id !== "string" || !ID.test(id) || !validPort(port) || typeof address !== "string")
    return null;
  if (kind === "key-light")
    return mac === undefined && isLocalIPv4(address) ? { id, kind, address, port } : null;
  if (kind !== "lifx") return null;
  const serial = parseLifxMac(mac);
  // A real LIFX light always listens on 56700; another port is only for a fake light on loopback.
  const portOk = port === LIFX_PORT || address.startsWith("127.");
  return serial !== null && portOk && isLocalUnicastIPv4(address)
    ? { id, kind, address, port, mac: serial }
    : null;
}

/** Parses the stored value; an entry that no longer validates is dropped rather than contacted. */
export function parseLights(value: unknown): ProvisionedLight[] {
  if (!Array.isArray(value)) return [];
  const lights: ProvisionedLight[] = [];
  for (const entry of value) {
    const light = parseLight(entry);
    if (light && !lights.some((l) => l.id === light.id)) lights.push(light);
  }
  return lights;
}

/** Validates an owner-supplied list; unlike {@link parseLights} it refuses instead of dropping. */
export function validateLights(input: unknown): ProvisionedLight[] {
  const list =
    input !== null && typeof input === "object" && "lights" in input ? input.lights : undefined;
  if (!Array.isArray(list) || list.length > MAX_LIGHTS)
    throw new PhoenixError(
      ErrorCode.INVALID_REQUEST,
      `"lights" must be a list of at most ${MAX_LIGHTS}`,
    );
  const lights: ProvisionedLight[] = [];
  for (const entry of list) {
    const o = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    if (Object.keys(o).some((k) => !FIELDS.includes(k)))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "A light has unexpected fields");
    const defaultPort = o.kind === "lifx" ? LIFX_PORT : KEY_LIGHT_PORT;
    const light = parseLight({ ...o, port: o.port ?? defaultPort });
    if (!light)
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        'Each light needs an "id", a kind ("key-light", or "lifx" with its 12 hex digit serial as "mac") and a LAN "address" (an IPv4 literal on your own network)',
      );
    if (lights.some((l) => l.id === light.id))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Duplicate light id "${light.id}"`);
    lights.push(light);
  }
  return lights;
}

/** Key Light LAN API: `PUT /elgato/lights` with a JSON body. No redirects, a short timeout. */
export function keyLightTransport(
  light: ProvisionedLight,
  fetcher: typeof fetch = fetch,
): DeviceTransport {
  return {
    async request(path, body, signal) {
      const response = await fetcher(`http://${light.address}:${light.port}${path}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(WRITE_TIMEOUT_MS)]),
      });
      if (!response.ok) throw new Error(`Key Light answered ${response.status}`);
    },
    report() {
      return Promise.reject(new Error("A Key Light is not a raw-report device"));
    },
  };
}

/** Core's list of provisioned lights: stored in settings, changed only by the owner, audited. */
export class StatusLightProvisioning {
  constructor(
    private readonly settings: SettingsStore,
    private readonly audit: Pick<AuditLog, "record">,
    private readonly fetcher?: typeof fetch,
    private readonly lifx?: LifxTransportOptions,
  ) {}

  lights(): ProvisionedLight[] {
    return parseLights(this.settings.get<unknown>(STATUS_LIGHT_DEVICES_KEY, null));
  }

  /** Replaces the whole list. Takes effect the next time the capability is enabled. */
  setLights(input: unknown): ProvisionedLight[] {
    const lights = validateLights(input);
    this.settings.set(STATUS_LIGHT_DEVICES_KEY, lights);
    this.audit.record({
      actor: "user",
      action: "status_lights.provisioned",
      capabilityId: "status-lights",
      decision: "allowed",
      details: {
        count: lights.length,
        kinds: lights.map((light) => light.kind),
      },
    });
    return lights;
  }

  /** The lights as the capability wants them: ids with a transport. Consent is not decided here. */
  devices(): Device[] {
    return this.lights().map((light) =>
      light.kind === "lifx"
        ? {
            id: light.id,
            kind: light.kind,
            mac: light.mac,
            transport: lifxTransport(
              { address: light.address, port: light.port, mac: light.mac },
              this.lifx,
            ),
          }
        : {
            id: light.id,
            kind: light.kind,
            transport: keyLightTransport(light, this.fetcher),
          },
    );
  }
}
