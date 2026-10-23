// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The part of the LIFX LAN protocol (https://lan.developer.lifx.com) that status lights need, as
// pure byte builders: a 36 byte header (frame 8 + frame address 16 + protocol header 12, all
// little-endian) followed by the payload of SetColor (102), SetLightPower (117) or nothing for an
// Acknowledgement (45). Nothing here opens a socket; the host's transport sends the frames.
import type { RGB } from "./devices";

/** UDP port every LIFX device listens on. */
export const LIFX_PORT = 56_700;
/** Frame `source`: any value other than 0 or 1 (the docs warn that firmware ignores or broadcasts those). */
export const LIFX_SOURCE = 0x504858;
export const LIFX_HEADER_BYTES = 36;
export const LIFX_SET_COLOR = 102;
export const LIFX_SET_LIGHT_POWER = 117;
export const LIFX_ACKNOWLEDGEMENT = 45;

const SET_COLOR_BYTES = LIFX_HEADER_BYTES + 13;
const SET_LIGHT_POWER_BYTES = LIFX_HEADER_BYTES + 6;
/** Frame word at byte 2: protocol 1024 (bits 0-11), addressable (bit 12), tagged 0 (bit 13), origin 0. */
const FRAME_WORD = 0x1400;
const PROTOCOL_MASK = 0x0fff;
const PROTOCOL = 1024;
const TAGGED_BIT = 0x2000;
const ADDRESSABLE_BIT = 0x1000;
const ACK_REQUIRED_BIT = 0b10;
const KELVIN = 3500;
const POWER_ON = 0xffff;

/**
 * A device serial as 12 lower-case hex digits, from 12 hex digits or six colon-separated pairs.
 * The all-zero serial (the protocol's "every device") and the all-ones one are refused.
 */
export function parseLifxMac(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const compact = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(text) ? text.replaceAll(":", "") : text;
  if (!/^[0-9a-f]{12}$/i.test(compact)) return null;
  const hex = compact.toLowerCase();
  return hex === "000000000000" || hex === "ffffffffffff" ? null : hex;
}

export interface Hsbk {
  /** Each field is the raw unsigned 16 bit value of the protocol (0-65535). */
  hue: number;
  saturation: number;
  brightness: number;
  kelvin: number;
}

/** An RGB colour at a brightness (percent) as HSBK; black has no hue or saturation. */
export function hsbkFor([r, g, b]: RGB, brightnessPercent: number): Hsbk {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let sector = 0;
  if (delta) {
    if (max === r) sector = ((g - b) / delta) % 6;
    else if (max === g) sector = (b - r) / delta + 2;
    else sector = (r - g) / delta + 4;
  }
  const degrees = (((sector * 60) % 360) + 360) % 360;
  return {
    hue: Math.round((degrees / 360) * 65535),
    saturation: max ? Math.round((delta / max) * 65535) : 0,
    brightness: Math.round((Math.min(100, Math.max(0, brightnessPercent)) / 100) * 65535),
    kelvin: KELVIN,
  };
}

function frame(
  mac: string,
  type: number,
  payload: Uint8Array,
  sequence: number,
  ackRequired: boolean,
): Uint8Array {
  const hex = parseLifxMac(mac);
  if (!hex) throw new Error("Invalid LIFX device serial");
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 255)
    throw new Error("Invalid LIFX sequence");
  const bytes = new Uint8Array(LIFX_HEADER_BYTES + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, bytes.length, true);
  view.setUint16(2, FRAME_WORD, true);
  view.setUint32(4, LIFX_SOURCE, true);
  for (let i = 0; i < 6; i++) bytes[8 + i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16); // bytes 14-15 stay 0
  bytes[22] = ackRequired ? ACK_REQUIRED_BIT : 0; // res_required (bit 0) is never asked for
  bytes[23] = sequence;
  view.setUint16(32, type, true);
  bytes.set(payload, LIFX_HEADER_BYTES);
  return bytes;
}

/**
 * SetColor (102), 49 bytes: header + reserved(1) hue(2) saturation(2) brightness(2) kelvin(2)
 * duration(4, ms). Addressed to one device, with an acknowledgement requested.
 */
export function lifxSetColor(mac: string, hsbk: Hsbk, durationMs = 0, sequence = 0): Uint8Array {
  const payload = new Uint8Array(13);
  const view = new DataView(payload.buffer);
  view.setUint16(1, hsbk.hue, true);
  view.setUint16(3, hsbk.saturation, true);
  view.setUint16(5, hsbk.brightness, true);
  view.setUint16(7, hsbk.kelvin, true);
  view.setUint32(9, durationMs, true);
  return frame(mac, LIFX_SET_COLOR, payload, sequence, true);
}

/** SetLightPower (117), 42 bytes: header + level(2: 0 off, 65535 on) duration(4, ms). */
export function lifxSetLightPower(
  mac: string,
  on: boolean,
  durationMs = 0,
  sequence = 0,
): Uint8Array {
  const payload = new Uint8Array(6);
  const view = new DataView(payload.buffer);
  view.setUint16(0, on ? POWER_ON : 0, true);
  view.setUint32(2, durationMs, true);
  return frame(mac, LIFX_SET_LIGHT_POWER, payload, sequence, true);
}

/** A device's Acknowledgement (45): header only. Used by fakes; real devices send it themselves. */
export function lifxAcknowledgement(mac: string, source: number, sequence: number): Uint8Array {
  const bytes = frame(mac, LIFX_ACKNOWLEDGEMENT, new Uint8Array(0), sequence, false);
  new DataView(bytes.buffer).setUint32(4, source, true);
  return bytes;
}

export interface LifxHeader {
  type: number;
  source: number;
  sequence: number;
  /** The 6 byte target as 12 lower-case hex digits. */
  target: string;
  tagged: boolean;
  ackRequired: boolean;
}

/** The header of a well-formed message (size matches, protocol 1024, addressable), else null. */
export function readLifxHeader(bytes: Uint8Array): LifxHeader | null {
  if (bytes.length < LIFX_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = view.getUint16(2, true);
  if (view.getUint16(0, true) !== bytes.length) return null;
  if ((word & PROTOCOL_MASK) !== PROTOCOL || (word & ADDRESSABLE_BIT) === 0) return null;
  const target = Array.from(bytes.subarray(8, 14), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    type: view.getUint16(32, true),
    source: view.getUint32(4, true),
    sequence: bytes[23] ?? 0,
    target,
    tagged: (word & TAGGED_BIT) !== 0,
    ackRequired: ((bytes[22] ?? 0) & ACK_REQUIRED_BIT) !== 0,
  };
}

/**
 * The header of a command Phoenix builds (SetColor or SetLightPower for exactly one device, never
 * tagged, an acknowledgement requested, our source, the right length, nothing in the reserved
 * fields), else null. The transport refuses any other bytes, so only these two can be sent.
 */
export function lifxCommandHeader(bytes: Uint8Array): LifxHeader | null {
  const header = readLifxHeader(bytes);
  if (!header || header.tagged || !header.ackRequired || header.source !== LIFX_SOURCE) return null;
  if (header.target === "000000000000" || header.target === "ffffffffffff") return null;
  const expected =
    header.type === LIFX_SET_COLOR
      ? SET_COLOR_BYTES
      : header.type === LIFX_SET_LIGHT_POWER
        ? SET_LIGHT_POWER_BYTES
        : 0;
  if (bytes.length !== expected) return null;
  const reserved = [
    ...bytes.subarray(14, 22),
    ...bytes.subarray(24, 32),
    ...bytes.subarray(34, 36),
  ];
  return reserved.every((b) => b === 0) && (bytes[22] ?? 0) === ACK_REQUIRED_BIT ? header : null;
}

/** True for the Acknowledgement of exactly this request: same source, sequence and device. */
export function isLifxAcknowledgement(
  bytes: Uint8Array,
  expected: { source: number; sequence: number; target: string },
): boolean {
  const header = readLifxHeader(bytes);
  return (
    header !== null &&
    bytes.length === LIFX_HEADER_BYTES &&
    header.type === LIFX_ACKNOWLEDGEMENT &&
    header.source === expected.source &&
    header.sequence === expected.sequence &&
    header.target === expected.target
  );
}
