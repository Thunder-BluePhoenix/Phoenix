// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Feeds the Phase 91 celebration gate with the GitHub capability's own CI and pull-request
// events and tells every Fawkes view when one fires. A celebration is cosmetic: it carries a kind
// and a delivery number, never a repository, branch, workflow, title or person, and nothing is
// stored. The pipeline is keyed by a hash of repository, workflow and branch so that a red build
// on a feature branch can never be "fixed" by a green one on main.
import { createHash } from "node:crypto";
import type { EventBus } from "@phoenix/event-bus";
import type { AuditLog } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import { createCelebrationGate, type Outcome } from "./events";

export const REBIRTH_SETTINGS_KEY = "fawkes.rebirth";
export const CELEBRATION_EVENT = "fawkes.celebration";

export interface RebirthSettings {
  /** Opt-in. First green week and three merged pull requests; the rebirth itself is always on. */
  milestones: boolean;
  /** Black-and-white Fawkes with a visible outline. */
  highContrast: boolean;
}

const DEFAULTS: RebirthSettings = { milestones: false, highContrast: false };

export interface FawkesRebirthDependencies {
  bus: Pick<EventBus, "subscribe" | "publish">;
  settings: SettingsStore;
  audit: Pick<AuditLog, "record">;
  now?: () => number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** An opaque, stable pipeline id: nothing readable about the repository survives. */
function pipelineId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 24)}`;
}

export class FawkesRebirthService {
  private readonly gate;
  private readonly unsubscribe: () => void;
  /** Starts above any id a view could have seen before a restart, so a new one is never skipped. */
  private delivery: number;

  constructor(private readonly d: FawkesRebirthDependencies) {
    const now = d.now ?? Date.now;
    this.delivery = now();
    // The gate always counts milestones; whether one is shown is decided here, from the setting,
    // so turning them on later never replays an old one.
    this.gate = createCelebrationGate({ milestones: true, now });
    this.unsubscribe = d.bus.subscribe(
      "fawkes-rebirth",
      ["github.ci.passed", "github.ci.failed", "github.pr.merged", "github.pr.closed"],
      (event, info) => {
        if (info.seq === null) return;
        const outcome = this.outcomeOf(event, info.seq);
        if (outcome) this.celebrate(outcome);
      },
    );
  }

  settings(): RebirthSettings {
    const raw = this.d.settings.get<unknown>(REBIRTH_SETTINGS_KEY, null);
    if (raw === null || typeof raw !== "object") return { ...DEFAULTS };
    const record = raw as Record<string, unknown>;
    return {
      milestones: record.milestones === true,
      highContrast: record.highContrast === true,
    };
  }

  set(input: unknown): RebirthSettings {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Expected an object");
    const change = input as Record<string, unknown>;
    const keys = Object.keys(change);
    if (keys.length === 0 || keys.some((k) => k !== "milestones" && k !== "highContrast"))
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        'Expected "milestones" and/or "highContrast"',
      );
    if (keys.some((k) => typeof change[k] !== "boolean"))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Each setting must be true or false");
    const next = { ...this.settings(), ...(change as Partial<RebirthSettings>) };
    this.d.settings.set(REBIRTH_SETTINGS_KEY, next);
    this.d.audit.record({
      actor: "user",
      action: "fawkes.rebirth.settings.changed",
      decision: "info",
      details: { ...next },
    });
    return next;
  }

  close(): void {
    this.unsubscribe();
  }

  /**
   * Only what the GitHub capability itself emitted counts: the source is `github` (the session
   * token route refuses that name), and the bus sequence orders outcomes per pipeline.
   */
  private outcomeOf(event: PhoenixEvent, sequence: number): Outcome | undefined {
    if (event.source !== "github") return undefined;
    const at = Date.parse(event.timestamp);
    const payload = event.payload as Record<string, unknown>;
    const repository = text(payload.repository);
    if (!repository || !Number.isFinite(at)) return undefined;
    if (event.event_type === "github.ci.passed" || event.event_type === "github.ci.failed") {
      return {
        kind: "build",
        stream: pipelineId("ci", repository, text(payload.workflow), text(payload.branch)),
        sequence,
        result: event.event_type === "github.ci.passed" ? "passed" : "failed",
        at,
      };
    }
    const number = payload.number;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) return undefined;
    return {
      kind: "pull-request",
      stream: pipelineId("pr", repository),
      item: `pr${number}`,
      sequence,
      result: event.event_type === "github.pr.merged" ? "merged" : "closed",
      at,
    };
  }

  private celebrate(outcome: Outcome): void {
    const { milestones } = this.settings();
    for (const celebration of this.gate.accept(outcome)) {
      if (celebration.kind !== "rebirth" && !milestones) continue;
      const result = this.d.bus.publish(
        createEvent({
          event_type: CELEBRATION_EVENT,
          source: "core",
          severity: "info",
          // A kind and a delivery number only: no repository, branch, workflow or person.
          payload: { kind: celebration.kind, id: ++this.delivery },
        }),
        { ephemeral: true },
      );
      if (!result.ok) throw result.error;
    }
  }
}
