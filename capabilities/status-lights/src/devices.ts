// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Transport implementations are supplied by the trusted host; adapters never discover or contact devices. */
export interface DeviceTransport {
  request(
    path: string,
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<void>;
  report(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}
export type DeviceKind = "hue" | "key-light" | "luxafor" | "lifx";
export interface Device {
  id: string;
  kind: DeviceKind;
  transport: DeviceTransport;
  /** Hue light resource ID. Required for Hue; never taken from an event. */
  resource?: string;
}
export type LightState = "IDLE" | "WORKING" | "WAITING" | "ERROR" | "RECORDING";
export type RGB = readonly [number, number, number];
export const COLORS: Readonly<Record<LightState, RGB>> = {
  IDLE: [0, 0, 0],
  WORKING: [0, 96, 255],
  WAITING: [255, 160, 0],
  ERROR: [255, 32, 24],
  RECORDING: [255, 0, 0],
};

function xy([red, green, blue]: RGB): { x: number; y: number } {
  const linear = (v: number) => {
    const n = v / 255;
    return n > 0.04045 ? ((n + 0.055) / 1.055) ** 2.4 : n / 12.92;
  };
  const r = linear(red),
    g = linear(green),
    b = linear(blue);
  const x = 0.664511 * r + 0.154324 * g + 0.162028 * b;
  const y = 0.283881 * r + 0.668433 * g + 0.047685 * b;
  const z = 0.000088 * r + 0.07231 * g + 0.986039 * b;
  const sum = x + y + z;
  return sum === 0 ? { x: 0, y: 0 } : { x: x / sum, y: y / sum };
}

/** LIFX LAN SetColor (message 102): little-endian 36-byte frame + 13-byte HSBK/duration payload. */
export function lifxSetColor([r, g, b]: RGB): Uint8Array {
  const bytes = new Uint8Array(49);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, bytes.length, true);
  view.setUint16(2, 0x1400, true); // protocol 1024; addressable
  view.setUint32(4, 0x504858, true); // fixed Phoenix source; no user-controlled addresses
  bytes[22] = 1; // response required, so transport can detect failure
  view.setUint16(32, 102, true);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  bytes[36] = max ? 1 : 0; // SetColor reserved byte
  view.setUint16(37, Math.round((((hue * 60 + 360) % 360) / 360) * 65535), true);
  view.setUint16(39, max ? Math.round((delta / max) * 65535) : 0, true);
  view.setUint16(41, Math.round((max / 255) * 65535), true);
  view.setUint16(43, 3500, true);
  view.setUint32(45, 0, true);
  return bytes;
}

/** Device identifiers are host provisioned, not URLs or paths from events or Stream Deck. */
export async function setDevice(
  device: Device,
  state: LightState,
  signal: AbortSignal,
): Promise<void> {
  const color = COLORS[state];
  if (device.kind === "luxafor") {
    await device.transport.report(Uint8Array.of(1, 0xff, ...color, 0, 0, 0), signal);
  } else if (device.kind === "lifx") {
    await device.transport.report(lifxSetColor(color), signal);
  } else if (device.kind === "hue") {
    if (!device.resource || !/^[a-f\d-]{36}$/i.test(device.resource))
      throw new Error("Invalid Hue light resource");
    await device.transport.request(
      `/clip/v2/resource/light/${device.resource}`,
      color[0] || color[1] || color[2]
        ? { on: { on: true }, color: { xy: xy(color) }, dimming: { brightness: 100 } }
        : { on: { on: false } },
      signal,
    );
  } else {
    // Elgato Key Light LAN PUT /elgato/lights. Lights are white-only; never claim coloured states.
    await device.transport.request(
      "/elgato/lights",
      {
        numberOfLights: 1,
        lights: [
          {
            on: state === "IDLE" ? 0 : 1,
            brightness: state === "RECORDING" ? 100 : 35,
            temperature: 200,
          },
        ],
      },
      signal,
    );
  }
}
