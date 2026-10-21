// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Low Power Mode on while the lid is closed. Privileged: it goes through Recovery's helper client
// (`sudo -n pmset -a lowpowermode 1`, the sudoers allow-list) and is journalled under Recovery's
// own kind `pmset.lowpowermode`, whose reverter Recovery registers (so this action has no `undo`
// of its own, and the launchd backstop covers it too). No helper installed: skipped, with a notice.
import { ALLOWED_HELPER_ARGV } from "../../power/helper-client";
import type { LidAction, LidSeams } from "../types";

export const LOW_POWER_KIND = "pmset.lowpowermode";

function argv(value: "0" | "1"): readonly string[] {
  const hit = ALLOWED_HELPER_ARGV.find((a) => a[2] === "lowpowermode" && a[3] === value);
  if (!hit) throw new Error("not an allowed command");
  return hit;
}

export function createLowPower(seams: LidSeams): LidAction {
  return {
    id: "low_power",
    kind: LOW_POWER_KIND,
    async plan(ctx) {
      if (seams.platform !== "darwin") return ctx.skip("unsupported_platform");
      // Already on for another reason (the battery floor): that change is not ours to undo.
      if (seams.pendingKinds().includes(LOW_POWER_KIND)) return ctx.skip("already_on");
      if ((await seams.helper.probe()) !== true) return ctx.skip("helper_unavailable");
      return { apply: { argv: [...argv("1")] }, undo: { argv: [...argv("0")] }, count: 1 };
    },
    apply: () => seams.helper.run(argv("1")),
    async support() {
      if (seams.platform !== "darwin") return { supported: false, reason: "unsupported_platform" };
      return (await seams.helper.probe()) === true
        ? { supported: true }
        : { supported: false, reason: "helper_unavailable" };
    },
  };
}
