// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 93: what the small Fawkes in the corner of the browser chrome shows. It reflects the ACTIVE
// tab's status using the pet's existing display states only (no new state): the chrome window draws
// it, never a page, so untrusted content cannot reach it. The explanation is a message key plus
// variables (never page text), so it is always translated and always written out as text.
import type { MessageKey } from "../i18n";

/** The existing Fawkes states this corner uses. */
export type CornerState =
  "IDLE" | "WORKING" | "THINKING" | "WAITING" | "WARNING" | "SLEEPING" | "OFFLINE";

export interface CornerInput {
  /** The shell is available (inside the desktop app). */
  connected: boolean;
  /** An active tab exists. */
  hasTab: boolean;
  loading: boolean;
  /** A permission prompt is waiting for the person. */
  permissionWaiting: boolean;
  /** The last address or action was refused; the message key says why. */
  refusal: MessageKey | null;
  /** A find request is running now. */
  finding: boolean;
  /** The find bar's last answer for the current query: null = none yet. */
  findFound: boolean | null;
  /** The active page's site when Shields are off for it (or everywhere), else null. */
  shieldsOffSite: string | null;
  blocked: number;
}

export interface CornerView {
  state: CornerState;
  explanation: MessageKey;
  vars: Record<string, string | number>;
}

/** The most urgent thing wins: a question for the person, a refusal, loading, searching, then rest. */
export function cornerView(input: CornerInput): CornerView {
  if (!input.connected)
    return { state: "OFFLINE", explanation: "browser.corner.noShell", vars: {} };
  if (input.permissionWaiting) {
    return { state: "WAITING", explanation: "browser.corner.permission", vars: {} };
  }
  if (input.refusal) return { state: "WARNING", explanation: input.refusal, vars: {} };
  if (!input.hasTab) return { state: "SLEEPING", explanation: "browser.corner.noTab", vars: {} };
  if (input.loading) return { state: "WORKING", explanation: "browser.corner.loading", vars: {} };
  if (input.finding) return { state: "THINKING", explanation: "browser.find.searching", vars: {} };
  if (input.findFound === true)
    return { state: "IDLE", explanation: "browser.find.found", vars: {} };
  if (input.findFound === false) {
    return { state: "IDLE", explanation: "browser.find.notFound", vars: {} };
  }
  if (input.shieldsOffSite !== null) {
    return {
      state: "IDLE",
      explanation: "browser.corner.shieldsOff",
      vars: { site: input.shieldsOffSite },
    };
  }
  if (input.blocked > 0) {
    return { state: "IDLE", explanation: "browser.corner.blocked", vars: { count: input.blocked } };
  }
  return { state: "IDLE", explanation: "browser.corner.idle", vars: {} };
}
