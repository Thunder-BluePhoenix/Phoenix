// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Which physical lights Core may reach, and how. Provisioning (an address) is separate from
// consent: a light here is never contacted until its id is also listed in the status-lights
// capability's own `devices` setting. Four kinds have a transport: the Elgato Key Light (a plain
// HTTP PUT to a LAN address), LIFX (one unicast UDP datagram per command, acknowledged), Philips
// Hue (a paired bridge, see hue.ts; the light names a bridge and a light resource id) and Luxafor
// (the Luxafor app's documented local webhook, see luxafor.ts; USB HID is not supported). None of
// these was ever run against real hardware.
import type { Device, DeviceTransport } from "@phoenix/capability-status-lights";
import { parseLifxMac, LIFX_PORT } from "@phoenix/capability-status-lights";
import type { AuditLog } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { SecretStore } from "@phoenix/persistence";
import { HueBridges, type HueBridge } from "./hue";
import { nodeHueLink, type HueLink } from "./hue-link";
import { isLocalIPv4, isLocalUnicastIPv4 } from "./lan-address";
import {
  discoverLifx,
  LIFX_DISCOVERY_COOLDOWN_MS,
  validBroadcastTarget,
  type DiscoverySocket,
  type LifxCandidate,
} from "./lifx-discovery";
import { lifxTransport, type LifxTransportOptions } from "./lifx-transport";
import { LUXAFOR_PORT, luxaforSecretRef, luxaforTransport, validLuxaforToken } from "./luxafor";

export const STATUS_LIGHT_DEVICES_KEY = "status-lights.provisioned";
const MAX_LIGHTS = 16;
const ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
const KEY_LIGHT_PORT = 9123;
const FIELDS = ["id", "kind", "address", "port", "mac", "bridge", "resource"];
const HUE_RESOURCE = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
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
    }
  | {
      id: string;
      kind: "hue";
      /** The id of a paired bridge (see {@link HueBridges}); its address and pinned certificate live there. */
      bridge: string;
      /** The bridge's light resource id (a UUID). */
      resource: string;
    }
  | {
      id: string;
      kind: "luxafor";
      /** The machine running the Luxafor app: a private, link-local or loopback IPv4 literal. */
      address: string;
      /** The app's webhook port, 5383 by default. */
      port: number;
    };

function validPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65_536;
}

/** One entry, normalised (`mac` lower-case hex), or null. `kind` is required. */
function parseLight(entry: unknown): ProvisionedLight | null {
  if (entry === null || typeof entry !== "object") return null;
  const { id, kind, address, port, mac, bridge, resource } = entry as Record<string, unknown>;
  if (typeof id !== "string" || !ID.test(id)) return null;
  if (kind === "hue")
    return typeof bridge === "string" &&
      ID.test(bridge) &&
      typeof resource === "string" &&
      HUE_RESOURCE.test(resource) &&
      address === undefined &&
      port === undefined &&
      mac === undefined
      ? { id, kind, bridge, resource: resource.toLowerCase() }
      : null;
  if (!validPort(port) || typeof address !== "string") return null;
  if (kind === "luxafor")
    return mac === undefined && bridge === undefined && isLocalIPv4(address)
      ? { id, kind, address, port }
      : null;
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
    const defaultPort =
      o.kind === "lifx" ? LIFX_PORT : o.kind === "luxafor" ? LUXAFOR_PORT : KEY_LIGHT_PORT;
    const light = parseLight(o.kind === "hue" ? o : { ...o, port: o.port ?? defaultPort });
    if (!light)
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        'Each light needs an "id", a kind ("key-light", "luxafor", "lifx" with its 12 hex digit serial as "mac", or "hue" with a paired "bridge" and the light\'s "resource" id) and, except for Hue, a LAN "address" (an IPv4 literal on your own network)',
      );
    if (lights.some((l) => l.id === light.id))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Duplicate light id "${light.id}"`);
    lights.push(light);
  }
  return lights;
}

/** Key Light LAN API: `PUT /elgato/lights` with a JSON body. No redirects, a short timeout. */
export function keyLightTransport(
  light: { address: string; port: number },
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

export interface StatusLightExtras {
  /** OS credential store: Hue application keys and Luxafor tokens. Without it neither can be paired. */
  secrets?: SecretStore;
  /** TLS to a Hue bridge. Tests inject a fake; production pins the owner-confirmed fingerprint. */
  hueLink?: HueLink;
  /** A UDP socket for LIFX discovery. Tests inject a fake. */
  discoverySocket?: () => DiscoverySocket;
  discoveryWaitMs?: number;
  now?: () => number;
  hueMinIntervalMs?: number;
  luxaforMinIntervalMs?: number;
}

/** A LIFX light that answered discovery, and whether it is already in the list. */
export interface LifxDiscovered extends LifxCandidate {
  provisioned: boolean;
}

/** Core's list of provisioned lights: stored in settings, changed only by the owner, audited. */
export class StatusLightProvisioning {
  readonly hue: HueBridges;
  private lastDiscovery = Number.NEGATIVE_INFINITY;
  private discovering = false;

  constructor(
    private readonly settings: SettingsStore,
    private readonly audit: Pick<AuditLog, "record">,
    private readonly fetcher?: typeof fetch,
    private readonly lifx?: LifxTransportOptions,
    private readonly extras: StatusLightExtras = {},
  ) {
    this.hue = new HueBridges(
      {
        settings,
        secrets: extras.secrets,
        audit,
        link: extras.hueLink ?? nodeHueLink,
      },
      extras.hueMinIntervalMs,
    );
  }

  lights(): ProvisionedLight[] {
    return parseLights(this.settings.get<unknown>(STATUS_LIGHT_DEVICES_KEY, null));
  }

  /**
   * Replaces the whole list. Takes effect the next time the capability is enabled. A Hue light
   * must name a paired bridge. The stored Luxafor tokens of lights that left the list are deleted.
   */
  async setLights(input: unknown): Promise<ProvisionedLight[]> {
    const lights = validateLights(input);
    const bridges = this.hue.bridges();
    for (const light of lights)
      if (light.kind === "hue" && !bridges.some((b) => b.id === light.bridge))
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          `Hue light "${light.id}" names a bridge that is not paired`,
        );
    const before = this.lights();
    this.settings.set(STATUS_LIGHT_DEVICES_KEY, lights);
    for (const old of before)
      if (old.kind === "luxafor" && !lights.some((l) => l.id === old.id && l.kind === "luxafor"))
        await this.extras.secrets?.delete(luxaforSecretRef(old.id));
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

  /**
   * Stores the Luxafor app's webhook token for a provisioned Luxafor light. Write-only: nothing
   * returns, lists, audits or logs it.
   */
  async setLuxaforToken(id: string, token: unknown): Promise<void> {
    if (!this.lights().some((l) => l.id === id && l.kind === "luxafor"))
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown Luxafor light");
    if (!validLuxaforToken(token))
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        'A "token" of 1 to 128 printable characters without spaces is required',
      );
    if (!this.extras.secrets)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "No OS credential store is available to keep the Luxafor token",
      );
    await this.extras.secrets.set(luxaforSecretRef(id), token);
    this.audit.record({
      actor: "user",
      action: "status_lights.luxafor_token_set",
      capabilityId: "status-lights",
      decision: "allowed",
      details: { count: 1 },
    });
  }

  /**
   * One LIFX discovery broadcast on request. It lists candidates only: nothing is provisioned and
   * no state is sent. The owner adds the lights they confirm through {@link setLights}.
   */
  async discoverLifx(input: unknown): Promise<LifxDiscovered[]> {
    const o = (input ?? {}) as Record<string, unknown>;
    if (Object.keys(o).some((k) => k !== "broadcast"))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Unexpected fields");
    if (o.broadcast !== undefined && !validBroadcastTarget(o.broadcast))
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        '"broadcast" must be 255.255.255.255 or an address on your own network',
      );
    const create = this.extras.discoverySocket;
    if (!create)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "LIFX discovery is not available");
    const now = (this.extras.now ?? Date.now)();
    if (this.discovering || now - this.lastDiscovery < LIFX_DISCOVERY_COOLDOWN_MS)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Wait a few seconds between discoveries");
    this.lastDiscovery = now;
    this.discovering = true;
    try {
      const found = await discoverLifx({
        createSocket: create,
        ...(typeof o.broadcast === "string" ? { broadcast: o.broadcast } : {}),
        ...(this.extras.discoveryWaitMs ? { waitMs: this.extras.discoveryWaitMs } : {}),
      });
      const known = new Set(this.lights().flatMap((l) => (l.kind === "lifx" ? [l.mac] : [])));
      this.audit.record({
        actor: "user",
        action: "status_lights.lifx_discovery",
        capabilityId: "status-lights",
        decision: "allowed",
        details: { count: found.length },
      });
      return found.map((c) => ({ ...c, provisioned: known.has(c.mac) }));
    } finally {
      this.discovering = false;
    }
  }

  /** The lights as the capability wants them: ids with a transport. Consent is not decided here. */
  devices(): Device[] {
    const bridges = new Map<string, HueBridge>(this.hue.bridges().map((b) => [b.id, b]));
    const devices: Device[] = [];
    for (const light of this.lights()) {
      if (light.kind === "lifx")
        devices.push({
          id: light.id,
          kind: light.kind,
          mac: light.mac,
          transport: lifxTransport(
            { address: light.address, port: light.port, mac: light.mac },
            this.lifx,
          ),
        });
      else if (light.kind === "hue") {
        // A light whose bridge was removed is not contacted.
        const bridge = bridges.get(light.bridge);
        if (bridge)
          devices.push({
            id: light.id,
            kind: light.kind,
            resource: light.resource,
            transport: this.hue.transport(bridge),
          });
      } else if (light.kind === "luxafor")
        devices.push({
          id: light.id,
          kind: light.kind,
          transport: luxaforTransport(light, {
            token: async () => this.extras.secrets?.get(luxaforSecretRef(light.id)),
            ...(this.fetcher ? { fetcher: this.fetcher } : {}),
            ...(this.extras.luxaforMinIntervalMs !== undefined
              ? { minIntervalMs: this.extras.luxaforMinIntervalMs }
              : {}),
          }),
        });
      else
        devices.push({
          id: light.id,
          kind: light.kind,
          transport: keyLightTransport(light, this.fetcher),
        });
    }
    return devices;
  }
}
