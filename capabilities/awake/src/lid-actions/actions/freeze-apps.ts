// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Freeze the listed chat apps (default Slack, WhatsApp, Discord) with SIGSTOP while the lid is
// closed. Never while the user is in a meeting, recording or dictating, and never when that is
// unknown (fails closed). See freeze-core.ts for the identity rules.
import { NotAppliedError } from "../../power/journal";
import { FREEZE_APPS, appKeyOf } from "../apps";
import type { LidAction, LidSeams } from "../types";
import {
  chooseTargets,
  framePlanned,
  freezeNow,
  thawNow,
  withoutAssertionHolders,
  type FreezeScope,
  type FrozenProc,
} from "./freeze-core";

export const FREEZE_KIND = "lid.freeze";

function keysOf(scope: FreezeScope, targets: readonly FrozenProc[]): string[] {
  return [...new Set(targets.flatMap((t) => appKeyOf(t.command, scope.apps) ?? []))];
}

export function createFreezeApps(
  seams: LidSeams,
  keys: () => readonly string[],
  extra: FreezeScope["extra"],
): LidAction {
  const scope = (): FreezeScope => ({
    apps: FREEZE_APPS.filter((a) => keys().includes(a.key)),
    extra,
  });
  return {
    id: "freeze_apps",
    kind: FREEZE_KIND,
    async plan(ctx) {
      if (seams.platform !== "darwin") return ctx.skip("unsupported_platform");
      const activity = seams.protectedState();
      if (activity === "active") return ctx.skip("protected_state");
      if (activity === "unknown") return ctx.skip("state_unknown");
      const table = await ctx.procs();
      if (!table) return ctx.skip("process_list_unavailable");
      const chosen = chooseTargets(seams, scope(), table);
      if (chosen.targets.length === 0) return ctx.skip("no_targets");
      const check = await withoutAssertionHolders(seams, scope(), chosen.targets);
      if (!check.ok) return ctx.skip(check.reason);
      return framePlanned(check.targets, keysOf(scope(), check.targets));
    },
    async apply(planned) {
      // The state is read again at the last moment: a meeting may have started since the plan.
      if (seams.protectedState() !== "idle") throw new NotAppliedError("the user is busy");
      await freezeNow(seams, scope(), planned);
    },
    undo: (undo) => thawNow(seams, undo),
    support: () =>
      Promise.resolve(
        seams.platform === "darwin"
          ? { supported: true }
          : { supported: false, reason: "unsupported_platform" },
      ),
  };
}
