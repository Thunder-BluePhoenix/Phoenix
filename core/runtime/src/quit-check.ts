// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Phase 73 quit veto, as Core's read-only answer to the desktop shell's Quit. The recovery
// manager owns the truth (`canQuit()`); the keep-awake capability hands Core a function that asks
// it each time the capability is enabled. This class only holds that function and shapes the
// answer. It cannot undo, discard or change a journal entry, and it is NOT cleared when the
// capability stops, because an undo that failed at that moment is still pending.
import type { QuitCheck } from "@phoenix/capability-awake";
import type { QuitCheckApi, QuitCheckView } from "@phoenix/api";

/** The most changes the answer lists; `count` still says how many there are. */
export const QUIT_CHECK_LIST_LIMIT = 20;

export class QuitCheckService implements QuitCheckApi {
  private check: (() => QuitCheck) | undefined;

  /** Called by the keep-awake capability each time it is enabled. */
  bind(check: (() => QuitCheck) | undefined): void {
    this.check = check;
  }

  status(): QuitCheckView {
    if (!this.check) return { available: false, can_quit: true, count: 0, pending: [] };
    let result: QuitCheck;
    try {
      result = this.check();
    } catch {
      // The veto could not be read: say nothing is known rather than invent an answer.
      return { available: false, can_quit: true, count: 0, pending: [] };
    }
    return {
      available: true,
      can_quit: result.ok,
      count: result.pending.length,
      pending: result.pending
        .slice(0, QUIT_CHECK_LIST_LIMIT)
        .map((p) => ({ kind: p.kind, at: p.at })),
    };
  }
}
