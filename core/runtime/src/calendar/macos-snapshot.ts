// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's door for the desktop shell's macOS Calendar (EventKit) snapshots (Phase 83). The feed
// class validates and holds the snapshot; this wrapper only turns a refusal into a 400 with a fixed
// message and shapes the status answer.
import { MacosSnapshotError, type MacosCalendarFeed } from "@phoenix/capability-calendar";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export class MacosSnapshotService {
  constructor(private readonly feed: MacosCalendarFeed) {}

  submit(body: unknown): unknown {
    try {
      return this.feed.submit(body);
    } catch (error) {
      if (error instanceof MacosSnapshotError)
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, error.message);
      throw error;
    }
  }

  status(): unknown {
    return this.feed.status();
  }
}
