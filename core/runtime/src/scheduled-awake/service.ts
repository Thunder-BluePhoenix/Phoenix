// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's owner of the Phase 90 scheduler. It supplies what the engine deliberately does not have:
// the one Phase 72 keep-awake session, a power source, a durable store, and the permission gate.
//
// Who confirms what. Turning scheduling on and saving a schedule are the decisions that let the
// machine stay awake with nobody there, so each goes through the permission gateway and asks the
// user. The hold a schedule later starts does not ask again: that is what the user already
// agreed to, and a prompt at 03:00 would only expire. Everything that only shortens or removes
// awake time (turning off, deleting, skipping, cancelling) is audited and never blocked. The
// emergency stop turns the scheduler off, because otherwise it would restart the hold the stop
// just ended on its next check.
import {
  AwakeError,
  realClock,
  realRunner,
  type AwakeClock,
  type AwakeEnv,
  type SessionController,
} from "@phoenix/capability-awake";
import type { AuditLog, PermissionGateway } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { awakeControllerFromSession } from "./adapter";
import { ScheduledAwake, type SchedulerStatus } from "./engine";
import type { PowerSource } from "./power";
import type { KeepAwakeSession, PersistedState, ScheduleEvent, ScheduleStore } from "./ports";
import { parseScheduleInput, type ScheduleSpec } from "./schedule";
import { SystemPowerSource } from "./system-power";

export const SCHEDULED_AWAKE_KEY = "scheduled-awake.state";
const CAPABILITY = "awake";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ScheduledAwakeDependencies {
  settings: SettingsStore;
  permissions: Pick<PermissionGateway, "authorize" | "recordOutcome" | "isKillSwitchEngaged">;
  audit: Pick<AuditLog, "record">;
  clock?: AwakeClock;
  /** Default: the Phase 72 battery reader plus macOS Low Power Mode, read-only. */
  power?: PowerSource;
  /** Only used to build the default power source. */
  env?: Pick<AwakeEnv, "platform" | "run">;
}

export interface ScheduledAwakeView extends SchedulerStatus {
  /** False while the keep-awake capability is off: a window then waits as `start_failed`. */
  awakeAvailable: boolean;
}

/** Keeps the settings row the engine saves into; whatever it loads is treated as untrusted. */
class SettingsScheduleStore implements ScheduleStore {
  constructor(private readonly settings: SettingsStore) {}

  load(): Promise<unknown> {
    return Promise.resolve(this.settings.get<unknown>(SCHEDULED_AWAKE_KEY, null));
  }

  save(state: PersistedState): Promise<void> {
    this.settings.set(SCHEDULED_AWAKE_KEY, state);
    return Promise.resolve();
  }
}

/** The Phase 72 session, bound while the keep-awake capability is enabled. */
class BoundSession implements KeepAwakeSession {
  current: SessionController | undefined;

  private need(): SessionController {
    if (!this.current)
      throw new AwakeError("unavailable", "The keep-awake capability is not enabled");
    return this.current;
  }

  start(mode: "timed", minutes: number, label: string | undefined) {
    return this.need().start(mode, minutes, label);
  }

  extend(minutes: number) {
    return this.need().extend(minutes);
  }

  end(reason: Parameters<SessionController["end"]>[0]): boolean {
    return this.current?.end(reason) ?? false;
  }

  active() {
    return this.current?.active() ?? null;
  }
}

function describe(spec: ScheduleSpec): string {
  const when =
    spec.recurrence.kind === "weekly"
      ? spec.recurrence.days.map((d) => DAY_NAMES[d]).join(", ")
      : spec.recurrence.date;
  return `${spec.start} to ${spec.end} (${spec.timeZone}), ${when}`;
}

/** Maps the scheduler's own error type onto the API's. */
function asPhoenixError(error: unknown): never {
  if (error instanceof AwakeError) {
    throw new PhoenixError(
      error.kind === "unavailable" ? ErrorCode.CAPABILITY_UNAVAILABLE : ErrorCode.INVALID_REQUEST,
      error.message,
    );
  }
  throw error;
}

export class ScheduledAwakeService {
  private readonly session = new BoundSession();
  private readonly engine: ScheduledAwake;
  /** Only a change in why a window waits is worth an audit row; it is re-reported every minute. */
  private lastWaiting = "";

  constructor(private readonly d: ScheduledAwakeDependencies) {
    const controller = awakeControllerFromSession(this.session);
    this.engine = new ScheduledAwake({
      clock: d.clock ?? realClock,
      controller: {
        ...controller,
        // A stopped Core must not be talked back into holding the machine.
        start: (minutes, label) => {
          if (d.permissions.isKillSwitchEngaged())
            return Promise.reject(new AwakeError("cancelled", "Emergency stop is engaged"));
          return controller.start(minutes, label);
        },
      },
      power:
        d.power ?? new SystemPowerSource(d.env ?? { platform: processPlatform(), run: realRunner }),
      store: new SettingsScheduleStore(d.settings),
      emit: (event) => this.record(event),
    });
  }

  /** The awake capability calls this each time it is enabled (and with `undefined` when it stops). */
  bindSession(session: SessionController | undefined): void {
    this.session.current = session;
  }

  start(): Promise<void> {
    return this.engine.start();
  }

  close(): Promise<void> {
    return this.engine.stop();
  }

  status(): ScheduledAwakeView {
    return { ...this.engine.status(), awakeAvailable: this.session.current !== undefined };
  }

  async setEnabled(on: boolean): Promise<ScheduledAwakeView> {
    if (on) {
      await this.confirmed(
        "Turn on scheduled keep-awake: this computer will stay awake during the windows you saved, without asking again each time.",
        { change: "enable" },
        () => this.engine.setEnabled(true),
      );
    } else {
      await this.unconfirmed("disable", () => this.engine.setEnabled(false));
    }
    return this.status();
  }

  async upsertSchedule(input: unknown): Promise<ScheduledAwakeView> {
    let spec: ScheduleSpec;
    try {
      spec = parseScheduleInput(input);
    } catch (error) {
      return asPhoenixError(error);
    }
    await this.confirmed(
      `Save a keep-awake schedule: ${describe(spec)}. While scheduling is on, this computer stays awake then.`,
      { change: "schedule", schedule: spec.id },
      () => this.engine.upsertSchedule(input),
    );
    return this.status();
  }

  async removeSchedule(id: string): Promise<ScheduledAwakeView> {
    await this.unconfirmed("remove_schedule", () => this.engine.removeSchedule(id), {
      schedule: id,
    });
    return this.status();
  }

  async skipWindow(key: string): Promise<ScheduledAwakeView> {
    await this.unconfirmed("skip", () => this.engine.skipWindow(key), { window: key });
    return this.status();
  }

  async unskipWindow(key: string): Promise<ScheduledAwakeView> {
    await this.unconfirmed("unskip", () => this.engine.unskipWindow(key), { window: key });
    return this.status();
  }

  async cancelCurrent(): Promise<{ status: ScheduledAwakeView; skipped: string[] }> {
    const { skipped } = await this.unconfirmed("cancel_current", () => this.engine.cancelCurrent());
    return { status: this.status(), skipped };
  }

  /** The emergency stop: off, without a prompt. The user turns it back on, with a prompt. */
  async stopForKillSwitch(): Promise<void> {
    if (!this.engine.status().enabled) return;
    await this.engine.setEnabled(false);
    this.d.audit.record({
      actor: "kill-switch",
      action: "scheduled_awake.disabled",
      capabilityId: CAPABILITY,
      decision: "info",
      details: { by: "kill_switch" },
    });
  }

  scheduleCount(): number {
    return this.engine.status().schedules.length;
  }

  private async confirmed<T>(
    summary: string,
    details: Record<string, string>,
    run: () => Promise<T>,
  ): Promise<T> {
    const action = await this.d.permissions.authorize({
      capabilityId: CAPABILITY,
      command: "scheduled_awake",
      permissions: [],
      sideEffect: "execute",
      summary,
      details,
    });
    try {
      const result = await run();
      this.d.permissions.recordOutcome(action, "succeeded");
      return result;
    } catch (error) {
      this.d.permissions.recordOutcome(action, "failed");
      return asPhoenixError(error);
    }
  }

  private async unconfirmed<T>(
    change: string,
    run: () => Promise<T>,
    details: Record<string, string> = {},
  ): Promise<T> {
    if (this.d.permissions.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    try {
      const result = await run();
      this.d.audit.record({
        actor: "user",
        action: `scheduled_awake.${change}`,
        capabilityId: CAPABILITY,
        decision: "info",
        details,
      });
      return result;
    } catch (error) {
      return asPhoenixError(error);
    }
  }

  private record(event: ScheduleEvent): void {
    if (event.type === "hold.waiting") {
      const signature = JSON.stringify(event.detail);
      if (signature === this.lastWaiting) return;
      this.lastWaiting = signature;
    } else if (event.type === "hold.started") {
      this.lastWaiting = "";
    }
    this.d.audit.record({
      actor: "scheduled-awake",
      action: `scheduled_awake.${event.type}`,
      capabilityId: CAPABILITY,
      decision: "info",
      details: event.detail,
    });
  }
}

function processPlatform(): AwakeEnv["platform"] {
  return process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
}
