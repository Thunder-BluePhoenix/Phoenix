// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { hsbkFor, lifxSetColor, lifxSetLightPower, parseLifxMac } from "./lifx";

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
  /** LIFX device serial (12 hex digits). Required for LIFX; never taken from an event. */
  mac?: string;
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

/** The brightness (percent) a lit light shows: dim ambient, full while recording. Shared by Key Light and LIFX. */
export const brightnessPercent = (state: LightState): number => (state === "RECORDING" ? 100 : 35);

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
    // Colour first, then power, so a light that was off never shows its old colour. IDLE is only power off.
    const mac = parseLifxMac(device.mac);
    if (!mac) throw new Error("Invalid LIFX device serial");
    if (state === "IDLE") {
      await device.transport.report(lifxSetLightPower(mac, false), signal);
    } else {
      await device.transport.report(
        lifxSetColor(mac, hsbkFor(color, brightnessPercent(state))),
        signal,
      );
      await device.transport.report(lifxSetLightPower(mac, true), signal);
    }
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
            brightness: brightnessPercent(state),
            temperature: 200,
          },
        ],
      },
      signal,
    );
  }
}
