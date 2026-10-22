// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Which physical lights Core may reach, and how. Provisioning (an address) is separate from
// consent: a light here is never contacted until its id is also listed in the status-lights
// capability's own `devices` setting. Only the Elgato Key Light has a transport so far: a plain
// HTTP PUT to a LAN address. Hue (bridge pairing and key), Luxafor (USB HID) and LIFX (UDP) need
// transports that nothing here can test, so they cannot be provisioned yet.
import type { Device, DeviceTransport } from "@phoenix/capability-status-lights";
import type { AuditLog } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export const STATUS_LIGHT_DEVICES_KEY = "status-lights.provisioned";
const MAX_LIGHTS = 16;
const ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
const KEY_LIGHT_PORT = 9123;
const WRITE_TIMEOUT_MS = 5_000;

/** A provisioned light as stored and shown. The address is the owner's own LAN address. */
export interface ProvisionedLight {
  id: string;
  kind: "key-light";
  /** An IPv4 literal on a private, link-local or loopback range; never a hostname. */
  address: string;
  port: number;
}

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

/** Parses the stored value; an entry that no longer validates is dropped rather than contacted. */
export function parseLights(value: unknown): ProvisionedLight[] {
  if (!Array.isArray(value)) return [];
  const lights: ProvisionedLight[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const { id, kind, address, port } = entry as Record<string, unknown>;
    if (
      typeof id === "string" &&
      ID.test(id) &&
      kind === "key-light" &&
      typeof address === "string" &&
      isLocalIPv4(address) &&
      typeof port === "number" &&
      Number.isInteger(port) &&
      port > 0 &&
      port < 65_536 &&
      !lights.some((l) => l.id === id)
    )
      lights.push({ id, kind, address, port });
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
    if (Object.keys(o).some((k) => !["id", "kind", "address", "port"].includes(k)))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "A light has unexpected fields");
    const candidate = { ...o, port: o.port ?? KEY_LIGHT_PORT };
    const [light] = parseLights([candidate]);
    if (!light)
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        'Each light needs an "id", kind "key-light" and a LAN "address" (an IPv4 literal on your own network)',
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
      details: { count: lights.length },
    });
    return lights;
  }

  /** The lights as the capability wants them: ids with a transport. Consent is not decided here. */
  devices(): Device[] {
    return this.lights().map((light) => ({
      id: light.id,
      kind: light.kind,
      transport: keyLightTransport(light, this.fetcher),
    }));
  }
}
