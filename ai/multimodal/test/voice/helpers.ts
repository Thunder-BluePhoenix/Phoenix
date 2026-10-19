// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Timers } from "../../src";

/** A 16 kHz frame of `ms` milliseconds at constant amplitude (RMS = amplitude / 32768). */
export function tone(ms: number, amplitude: number): Int16Array {
  return new Int16Array((ms * 16) | 0).fill(amplitude);
}

export const bytesOf = (pcm: Int16Array): Uint8Array =>
  new Uint8Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));

export interface Clock {
  now(): number;
  timers: Timers;
  advance(ms: number): void;
}

/** A manual clock and timer queue: no real timers. */
export function clock(): Clock {
  let now = 1_000_000;
  const pending: { at: number; fn: () => void; live: boolean }[] = [];
  const timers: Timers = {
    after(fn, ms) {
      const t = { at: now + ms, fn, live: true };
      pending.push(t);
      return () => {
        t.live = false;
      };
    },
  };
  return {
    now: () => now,
    timers,
    advance(ms: number) {
      now += ms;
      for (const t of pending) {
        if (t.live && t.at <= now) {
          t.live = false;
          t.fn();
        }
      }
    },
  };
}
