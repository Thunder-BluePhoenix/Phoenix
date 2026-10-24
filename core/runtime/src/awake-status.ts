// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The read-only answer behind the desktop tray's Keep-awake countdown (Phase 72). The keep-awake
// capability hands Core its session controller each time it is enabled (and `undefined` when it
// stops); this class only holds a way to read the status and shapes the answer. It cannot start,
// extend or end a session, and it leaves out the session id and the label.
import type { SessionController } from "@phoenix/capability-awake";
import type { AwakeStatusApi, AwakeTrayView } from "@phoenix/api";

export class AwakeStatusService implements AwakeStatusApi {
  private session: Pick<SessionController, "status"> | undefined;

  /** Called by the keep-awake capability each time it is enabled, and with `undefined` when it stops. */
  bind(session: Pick<SessionController, "status"> | undefined): void {
    this.session = session;
  }

  status(): AwakeTrayView {
    if (!this.session) return { available: false, active: false };
    let status: ReturnType<SessionController["status"]>;
    try {
      status = this.session.status();
    } catch {
      // The status could not be read: say nothing is known rather than invent an answer.
      return { available: false, active: false };
    }
    const session = status.session;
    if (!status.active || !session) return { available: true, active: false };
    return {
      available: true,
      active: true,
      mode: session.mode,
      remaining_seconds: session.remaining_seconds,
    };
  }
}
