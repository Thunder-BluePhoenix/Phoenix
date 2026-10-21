// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// App Nap off for the agent apps the user listed (opt-in): `defaults write <bundle id>
// NSAppSleepDisabled -bool YES`. The PRIOR value is read first and recorded in the journal entry
// ("absent", "yes" or "no"); undo restores exactly that: delete the key if it was absent. An app
// whose prior value cannot be read, or is something else than a boolean, is left alone. Bundle ids
// are validated against a strict pattern, here and again when the journal entry is read back; the
// Not while a meeting, recording or dictation is in progress, nor when that is unknown. The
// commands run through the Runner as argv arrays, never a shell. macOS applies the setting when
// the app next launches (see README-lid.md).
import { isBundleId } from "../config";
import type { LidAction, LidSeams } from "../types";
import { assertIdle, busyReason } from "./guard";

export const APP_NAP_KIND = "lid.app_nap";
const DEFAULTS = "/usr/bin/defaults";
const KEY = "NSAppSleepDisabled";
const TIMEOUT = { timeoutMs: 8_000 };

export type PriorValue = "absent" | "yes" | "no";

interface NapRecord {
  bundle: string;
  prior: PriorValue;
}

async function readPrior(seams: LidSeams, bundle: string): Promise<PriorValue | null> {
  const result = await seams.run(DEFAULTS, ["read", bundle, KEY], TIMEOUT);
  if (result.code === 0) {
    const text = result.stdout.trim();
    if (text === "1") return "yes";
    if (text === "0") return "no";
    return null;
  }
  // `defaults read` says exactly this when the key (or the whole domain) is not set.
  if (result.code === 1 && /does not exist/i.test(result.stderr)) return "absent";
  return null;
}

function parseRecords(raw: unknown): NapRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: NapRecord[] = [];
  for (const item of raw.slice(0, 64)) {
    const bundle: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "bundle") : undefined;
    const prior: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "prior") : undefined;
    if (isBundleId(bundle) && (prior === "absent" || prior === "yes" || prior === "no")) {
      out.push({ bundle, prior });
    }
  }
  return out;
}

export function createAppNap(seams: LidSeams, apps: () => readonly string[]): LidAction {
  return {
    id: "app_nap",
    kind: APP_NAP_KIND,
    async plan(ctx) {
      if (seams.platform !== "darwin") return ctx.skip("unsupported_platform");
      const busy = busyReason(seams);
      if (busy !== null) return ctx.skip(busy);
      const records: NapRecord[] = [];
      for (const bundle of apps()) {
        if (!isBundleId(bundle)) continue;
        const prior = await readPrior(seams, bundle);
        // Unknown prior: it could not be restored exactly, so it is not touched.
        if (prior === null) continue;
        // Already off for this app: not Phoenix's change, so not Phoenix's to undo.
        if (prior === "yes") continue;
        records.push({ bundle, prior });
      }
      if (records.length === 0) return ctx.skip("no_targets");
      return {
        apply: { apps: records.map((r) => r.bundle) },
        undo: { apps: records.map((r) => ({ ...r })) },
        count: records.length,
      };
    },
    async apply(planned) {
      assertIdle(seams);
      const bundles = Array.isArray(planned.apply.apps)
        ? planned.apply.apps.filter(isBundleId)
        : [];
      let failed = 0;
      for (const bundle of bundles) {
        const result = await seams.run(DEFAULTS, ["write", bundle, KEY, "-bool", "YES"], TIMEOUT);
        if (result.code !== 0) failed += 1;
      }
      if (failed > 0) throw new Error("App Nap could not be turned off for some apps");
    },
    async undo(undo) {
      const records = parseRecords(undo.apps);
      let count = 0;
      let failed = 0;
      for (const { bundle, prior } of records) {
        const args =
          prior === "absent"
            ? ["delete", bundle, KEY]
            : ["write", bundle, KEY, "-bool", prior === "yes" ? "YES" : "NO"];
        const result = await seams.run(DEFAULTS, args, TIMEOUT);
        // Deleting a key that is already gone is the state we want.
        if (result.code === 0 || (prior === "absent" && /does not exist/i.test(result.stderr)))
          count += 1;
        else failed += 1;
      }
      if (failed > 0) throw new Error("App Nap could not be restored for some apps");
      return { count };
    },
    support: () =>
      Promise.resolve(
        seams.platform === "darwin"
          ? { supported: true }
          : { supported: false, reason: "unsupported_platform" },
      ),
  };
}
