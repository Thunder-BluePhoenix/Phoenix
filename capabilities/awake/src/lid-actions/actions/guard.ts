// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The meeting / call guard every user-visible action shares: mute, display sleep and App Nap are
// not changed while the user is in a meeting, recording or dictating, and not when that cannot be
// known (fails closed), just like the freezes.
import { NotAppliedError } from "../../power/journal";
import type { LidSeams, SkipReason } from "../types";

/** Why the action must not run now, or null when the user is known to be idle. */
export function busyReason(seams: LidSeams): SkipReason | null {
  const activity = seams.protectedState();
  if (activity === "idle") return null;
  return activity === "active" ? "protected_state" : "state_unknown";
}

/** The same check at the last moment (a meeting may have started since the plan). */
export function assertIdle(seams: LidSeams): void {
  if (seams.protectedState() !== "idle") throw new NotAppliedError("the user is busy");
}
