// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { AwakeError } from "@phoenix/capability-awake";
import type { AwakeController, KeepAwakeSession } from "./ports";

/**
 * Drives the one Phase 72 keep-awake session. The scheduler only ever ends or extends the session
 * it started: if the user (or another module) holds a session, `start` is refused by the session
 * itself (`conflict`) and `end`/`extend` for a different id do nothing.
 */
export function awakeControllerFromSession(session: KeepAwakeSession): AwakeController {
  return {
    async start(minutes, label) {
      const status = await session.start("timed", minutes, label);
      const id = status.session?.id;
      if (id === undefined) throw new AwakeError("unavailable", "The session did not report an id");
      return id;
    },
    extend(id, minutes) {
      if (session.active()?.id !== id)
        throw new AwakeError("no_session", "The hold is not running");
      session.extend(minutes);
    },
    end(id, reason) {
      if (session.active()?.id === id) session.end(reason);
    },
    alive(id) {
      return session.active()?.id === id;
    },
  };
}
