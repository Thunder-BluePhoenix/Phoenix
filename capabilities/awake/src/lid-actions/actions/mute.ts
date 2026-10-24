// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Mute the sound outputs while the lid is closed and put them back on open.
//
// The previous mute state is recorded PER output device id, and only for the devices Phoenix
// actually mutes (an output that was already muted is not Phoenix's to unmute). On undo:
//   1. every recorded device that still exists gets its recorded state back (a device that went
//      away, for example unplugged headphones, is skipped, not an error);
//   2. the CURRENT default output is looked at too: if the user switched outputs while the lid was
//      closed, the new default is not in the record. When it is muted now and the default output
//      was unmuted before the lid closed, it is unmuted, so the user is never left with a silent
//      default output they never muted.
// The default output's NAME is recorded too (when the adapter can read it). On undo, if the current
// default has another name, the default was switched while the lid was closed: Phoenix does NOT
// unmute the new default (it is not its change). It is reported as `output_changed` and the entry
// stays pending, so the user sees a plain-text warning and the undo is retried (it succeeds once
// the same output is the default again). A name that could not be read is marked
// `output_identity_unknown`, and the undo then works by id alone, as before.
// Not while a meeting, recording or dictation is in progress, nor when that is unknown.
// A default-only adapter mutes "whatever is the default now", so `apply` reads the default's name
// again at the last moment and, when it is not the name the plan recorded (the user switched
// outputs between the plan and the apply), mutes nothing and throws `NotAppliedError`: the entry is
// closed (nothing was changed), never left behind as a mute the entry cannot explain.
// Per-device mute (`by_id`) is only reachable through an adapter that can address a device without
// changing the default; no stock macOS tool does (see README-lid.md), so `real.ts` has none.
// The recorded data is all that undo uses; nothing is kept in memory.
import { NotAppliedError } from "../../power/journal";
import type { Fields } from "../../power/format";
import {
  OUTPUT_CHANGED,
  OUTPUT_IDENTITY_UNKNOWN,
  type AudioDevice,
  type LidAction,
  type LidSeams,
} from "../types";
import { assertIdle, busyReason } from "./guard";

export const MUTE_KIND = "lid.mute";
const MAX_DEVICES = 64;
const NAME_RE = /^[\x20-\x7e]{1,128}$/;
const DEVICE_ID = /^[\x20-\x7e]{1,128}$/;

interface MuteRecord {
  id: string;
  prior: boolean;
}

function parseRecords(raw: unknown): MuteRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: MuteRecord[] = [];
  for (const item of raw.slice(0, MAX_DEVICES)) {
    const id: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "id") : undefined;
    const prior: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "prior") : undefined;
    if (typeof id === "string" && DEVICE_ID.test(id) && typeof prior === "boolean")
      out.push({ id, prior });
  }
  return out;
}

async function outputs(
  seams: LidSeams,
): Promise<{ devices: AudioDevice[]; defaultId: string | null } | null> {
  try {
    const [devices, defaultId] = await Promise.all([
      seams.audio.listOutputs(),
      seams.audio.defaultOutputId(),
    ]);
    return { devices, defaultId };
  } catch {
    return null;
  }
}

export function createMute(seams: LidSeams): LidAction {
  return {
    id: "mute",
    kind: MUTE_KIND,
    async plan(ctx) {
      if (seams.platform !== "darwin") return ctx.skip("unsupported_platform");
      const busy = busyReason(seams);
      if (busy !== null) return ctx.skip(busy);
      const now = await outputs(seams);
      if (!now || now.devices.length === 0) return ctx.skip("audio_unavailable");
      const devices: MuteRecord[] = [];
      for (const d of now.devices.slice(0, MAX_DEVICES)) {
        // Unknown state: never touched. Already muted: not ours to unmute.
        if (d.muted === false && DEVICE_ID.test(d.id)) devices.push({ id: d.id, prior: false });
      }
      if (devices.length === 0) return ctx.skip("nothing_to_do");
      const defaultId =
        now.defaultId !== null && DEVICE_ID.test(now.defaultId) ? now.defaultId : null;
      const defaultDevice = now.devices.find((d) => d.id === defaultId);
      const defaultPrior = defaultDevice?.muted ?? null;
      const name = defaultDevice?.name;
      const defaultName = typeof name === "string" && NAME_RE.test(name) ? name : null;
      return {
        apply: { devices: devices.map((d) => d.id) },
        undo: {
          devices: devices.map((d) => ({ ...d })),
          default_id: defaultId,
          default_prior: defaultPrior,
          default_name: defaultName,
        },
        count: devices.length,
        ...(defaultName === null ? { notes: [OUTPUT_IDENTITY_UNKNOWN] } : {}),
      };
    },
    async apply(planned) {
      // A meeting may have started since the plan.
      assertIdle(seams);
      // An adapter that can only address "the default" would mute whatever is the default NOW. If
      // the user switched outputs since the plan, that is not the output that was recorded: mute
      // nothing (the entry is closed, so no output is left muted for a reason the entry cannot
      // explain). Only a recorded name can be checked; without one the plan said so
      // (`output_identity_unknown`).
      const plannedName =
        typeof planned.undo.default_name === "string" && NAME_RE.test(planned.undo.default_name)
          ? planned.undo.default_name
          : null;
      if (seams.audio.addressing === "default_only" && plannedName !== null) {
        const now = await outputs(seams);
        const currentName = now?.devices.find((d) => d.id === now.defaultId)?.name;
        if (currentName !== plannedName)
          throw new NotAppliedError("the default sound output changed since the plan");
      }
      const ids = Array.isArray(planned.apply.devices) ? planned.apply.devices : [];
      let failed = 0;
      for (const id of ids) {
        if (typeof id !== "string") continue;
        try {
          await seams.audio.setMuted(id, true);
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) throw new Error("some outputs could not be muted");
    },
    async undo(undo: Fields) {
      const records = parseRecords(undo.devices);
      const now = await outputs(seams);
      if (!now) throw new Error("the sound outputs could not be read");
      const present = new Map(now.devices.map((d) => [d.id, d]));
      // Which output is the default now? An adapter that can only address "the default" would
      // unmute the WRONG device if the user switched outputs while the lid was closed.
      const recordedName =
        typeof undo.default_name === "string" && NAME_RE.test(undo.default_name)
          ? undo.default_name
          : null;
      const currentName = now.devices.find((d) => d.id === now.defaultId)?.name;
      if (
        seams.audio.addressing === "default_only" &&
        recordedName !== null &&
        typeof currentName === "string" &&
        currentName !== recordedName
      ) {
        // Not unmuted, not forgotten: the entry stays pending and the user is told in plain text.
        throw new Error(OUTPUT_CHANGED);
      }
      let count = 0;
      let failed = 0;
      for (const { id, prior } of records) {
        if (!present.has(id)) continue;
        try {
          await seams.audio.setMuted(id, prior);
          count += 1;
        } catch {
          failed += 1;
        }
      }
      // The user switched outputs while the lid was closed.
      const recorded = new Set(records.map((r) => r.id));
      const current = now.defaultId;
      if (current !== null && !recorded.has(current) && undo.default_prior === false) {
        const device = present.get(current);
        if (device?.muted === true) {
          try {
            await seams.audio.setMuted(current, false);
            count += 1;
          } catch {
            failed += 1;
          }
        }
      }
      if (failed > 0) throw new Error("some outputs could not be restored");
      return {
        count,
        ...(recordedName === null && seams.audio.addressing === "default_only"
          ? { notes: [OUTPUT_IDENTITY_UNKNOWN] }
          : {}),
      };
    },
    async support() {
      if (seams.platform !== "darwin") return { supported: false, reason: "unsupported_platform" };
      // Read-only: is the default output's name readable? If not, an undo can only go by id.
      const now = await outputs(seams);
      const name = now?.devices.find((d) => d.id === now.defaultId)?.name;
      return {
        supported: true,
        limits: [
          ...(seams.audio.addressing === "default_only" ? ["default_output_only"] : []),
          ...(now !== null && typeof name !== "string" ? [OUTPUT_IDENTITY_UNKNOWN] : []),
        ],
      };
    },
  };
}
