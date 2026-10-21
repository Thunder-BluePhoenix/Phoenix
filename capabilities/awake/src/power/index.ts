// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Recovery module (Phase 73): lid-closed mode, the recovery journal, the lid observer and the
// battery / heat floors. Appended to MODULES in ../index.ts.
//
// Phoenix never holds root. The one privileged operation (`pmset -a disablesleep 1|0`, and
// `pmset -a lowpowermode 1|0` for the floors) goes through `sudo -n` and a sudoers rule the user
// installs from a script (scripts/awake/install-helper.sh). No rule: the command exits non-zero,
// the feature is "unavailable" and the session carries on without it.
//
// Undo guarantees, in the order they are built:
//   1. every change is written to the journal BEFORE it is made (reconcile.ts);
//   2. the session ending, a floor, disable and Core exit all undo it;
//   3. the next launch reconciles whatever a crash left;
//   4. a launchd backstop undoes the privileged kinds within a minute of a session ending or its
//      owner dying (helper/phoenix-awake-backstop.mjs);
//   5. `canQuit()` says no while something still needs undoing.
import { homedir } from "node:os";
import { join } from "node:path";
import type { CapabilityContext } from "@phoenix/sdk";
import { isRecord } from "../guards";
import {
  AwakeError,
  type AwakeDeps,
  type AwakeModule,
  type BatteryReading,
  type TimerHandle,
} from "../system";
import type { Fields, PendingEntry } from "./format";
import {
  FLOORS_CONFIG_SCHEMA,
  FloorWatcher,
  floorsFromConfig,
  type FloorsConfig,
  type LowPowerResult,
} from "./floors";
import {
  ALLOWED_HELPER_ARGV,
  HelperUnavailableError,
  createHelperClient,
  validateHelperCommand,
  type HelperClient,
} from "./helper-client";
import {
  JournalWriteError,
  NotAppliedError,
  RecoveryJournal,
  nodeJournalFs,
  type JournalFs,
} from "./journal";
import { createLidObserver, type LidObserver } from "./lid";
import { RecoveryLock, createProcessProbe, type ProcessProbe } from "./lock";
import {
  RecoveryManager,
  type QuitCheck,
  type RecoveryEvent,
  type Reverter,
  type UndoReport,
} from "./reconcile";
import { SAFETY_TEXT_SHA256, SAFETY_VERSION, readSafety, writeSafety } from "./safety";
import { readThermal } from "./thermal";

export * from "./backstop";
export * from "./floors";
export * from "./format";
export * from "./helper-client";
export * from "./journal";
export * from "./lid";
export * from "./lock";
export * from "./reconcile";
export * from "./safety";
export * from "./thermal";

const DISABLESLEEP = "pmset.disablesleep";
const LOWPOWERMODE = "pmset.lowpowermode";
const DEFAULT_POLL_MS = 5_000;
const HELPER_PROBE_TTL_MS = 30_000;
const STATUS_PENDING_LIMIT = 200;
const PMSET_READ = "/usr/bin/pmset";
const PMSET_READ_TIMEOUT_MS = 5_000;
/** The longest `shutdown()` waits for the undo before it lets the host go on (the launchd backstop is the net). */
export const SHUTDOWN_WAIT_MS = 10_000;

/**
 * One numeric setting from `pmset -g` output (read-only), or undefined when it is not listed or not
 * a plain number. [INFERENCE] The exact key names (`SleepDisabled`, `lowpowermode`) are those macOS
 * prints today; anything else reads as "unknown", never as "off".
 */
export function pmsetSetting(output: string, name: string): number | undefined {
  for (const line of output.split("\n")) {
    const m = /^\s*([A-Za-z]+)\s+(\d+)\s*$/.exec(line);
    if (m && m[1]?.toLowerCase() === name.toLowerCase()) return Number(m[2]);
  }
  return undefined;
}

/** What the recovery module shares with the other Awake modules (Lid74), keyed by the init `deps`. */
export interface PowerServices {
  recovery: RecoveryManager;
  lid: LidObserver;
  helper: HelperClient;
  /** Registers how to undo a journalled kind. Call it in your `init`; reconcile runs after every init. */
  registerReverter(kind: string, reverter: Reverter): void;
  /** The quit veto: `ok: false` while a change still needs undoing. Emits awake.recovery.quit_refused. */
  canQuit(): QuitCheck;
  /** Runs one lid / floor / session-lifecycle check now (the module also runs it on a timer). */
  tick(): Promise<void>;
}

const services = new WeakMap<AwakeDeps, PowerServices>();

/** The shared services for an initialised capability, or undefined before the recovery module started. */
export function powerServices(deps: AwakeDeps): PowerServices | undefined {
  return services.get(deps);
}

export interface RecoveryModuleOptions {
  /** The Core data directory; files go in `<dir>/awake/`. Default: see `defaultDataDir`. */
  dir?: string;
  fs?: JournalFs;
  probe?: ProcessProbe;
  newId?: () => string;
  /** Milliseconds between session / lid checks. */
  pollMs?: number;
}

/** Same rule as core/config: PHOENIX_DATA_DIR, else ~/.phoenix/<env>. Core does not hand it to capabilities yet. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.PHOENIX_DATA_DIR;
  if (set && set.startsWith("/")) return set;
  const name = env.PHOENIX_ENV;
  return join(homedir(), ".phoenix", name === "staging" || name === "prod" ? name : "dev");
}

const EVENTS = [
  "awake.lid.closed",
  "awake.lid.opened",
  "awake.lid_closed.started",
  "awake.lid_closed.ended",
  "awake.privileged.apply",
  "awake.privileged.undo",
  "awake.recovery.pending",
  "awake.recovery.reconciled",
  "awake.recovery.discarded",
  "awake.recovery.quit_refused",
  "awake.safety.acknowledged",
  "awake.floor.low_power_on",
  "awake.floor.low_power_off",
  "awake.floor.low_power_unavailable",
  "awake.floor.ended",
];

const NO_INPUT = { type: "object", additionalProperties: false, properties: {} };

function noInput(input: unknown): void {
  if (input === undefined) return;
  if (!isRecord(input) || Object.keys(input).length > 0) {
    throw new AwakeError("invalid", "this command takes no input");
  }
}

/** The recorded undo for a pmset kind: one allowed OFF command, nothing else. */
function offArgv(kind: string, undo: Fields): readonly string[] {
  const checked = validateHelperCommand(undo.argv);
  const setting = kind === DISABLESLEEP ? "disablesleep" : "lowpowermode";
  if (!checked.ok || checked.command.setting !== setting || checked.command.value !== 0) {
    throw new Error("the recorded undo is not an allowed command");
  }
  return checked.command.argv;
}

/** An undo restored the machine only if it neither failed nor was blocked by a held recovery lock. */
function restoredBy(report: UndoReport): boolean {
  return report.failed.length === 0 && !report.locked;
}

function argvFor(setting: "disablesleep" | "lowpowermode", value: 0 | 1): readonly string[] {
  const hit = ALLOWED_HELPER_ARGV.find((a) => a[2] === setting && a[3] === String(value));
  if (!hit) throw new Error("not an allowed command");
  return hit;
}

interface Run {
  ctx: CapabilityContext;
  deps: AwakeDeps;
  floors: FloorsConfig;
  journal: RecoveryJournal;
  manager: RecoveryManager;
  probe: ProcessProbe;
  lid: LidObserver;
  helper: HelperClient;
  watcher: FloorWatcher;
  safetyPath: string;
  dir: string;
  fs: JournalFs;
  /** The session this module is tracking, and whether it recorded any change for it. */
  tracked: { id: string; touched: boolean } | null;
  engaged: { sessionId: string; since: number } | null;
  helperProbe: { at: number; installed: boolean | null } | null;
  lastFloorTick: number;
  timer: TimerHandle | undefined;
  unsubscribe: (() => void) | undefined;
  stopped: boolean;
  /** Set by shutdownRun: resolves when the shutdown undo finished or its wait cap passed. */
  shuttingDown: Promise<void> | undefined;
  busy: Promise<void> | undefined;
}

export function createRecoveryModule(options: RecoveryModuleOptions = {}): AwakeModule {
  let run: Run | undefined;

  const need = (): Run => {
    if (!run) throw new AwakeError("unavailable", "The awake capability is not running");
    return run;
  };

  function emit(
    r: Run,
    type: string,
    severity: "info" | "warning",
    payload: Record<string, unknown>,
  ): void {
    try {
      const result = r.ctx.emit({
        event_type: type,
        severity,
        subject: "Recovery",
        payload,
      });
      if (!result.ok) r.ctx.logger.warn("awake event not published", { type });
    } catch {
      // An undeclared or rejected event never stops recovery.
    }
  }

  /** `pmset -g` (read-only) through the injected Runner; undefined when it cannot be read. */
  async function readPmset(r: Run): Promise<string | undefined> {
    if (r.deps.env.platform !== "darwin") return undefined;
    const result = await r.deps.env
      .run(PMSET_READ, ["-g"], { timeoutMs: PMSET_READ_TIMEOUT_MS })
      .catch(() => undefined);
    return result && result.code === 0 ? result.stdout : undefined;
  }

  /**
   * [INFERENCE: key names as macOS prints them] Whether `pmset -g` says sleep is disabled although
   * the journal has no disablesleep entry and this instance did not turn it on: something outside
   * Phoenix (anything running as this account can use the sudo rule) did. null = cannot tell.
   */
  async function sleepDisabledUnjournaled(
    r: Run,
    pending: readonly PendingEntry[],
  ): Promise<boolean | null> {
    const out = await readPmset(r);
    if (out === undefined) return null;
    const value = pmsetSetting(out, "SleepDisabled");
    if (value === undefined) return null;
    return value === 1 && r.engaged === null && !pending.some((e) => e.kind === DISABLESLEEP);
  }

  /** A journalled privileged change for the tracked session. */
  async function privileged(
    r: Run,
    kind: string,
    setting: "disablesleep" | "lowpowermode",
    sessionId: string,
  ): Promise<void> {
    const on = argvFor(setting, 1);
    const off = argvFor(setting, 0);
    if (r.tracked?.id === sessionId) r.tracked.touched = true;
    await r.manager.change(
      kind,
      { argv: [...on] },
      { argv: [...off] },
      () => r.helper.run(on),
      sessionId,
    );
  }

  async function lowPowerOn(r: Run): Promise<LowPowerResult> {
    const session = r.deps.session.active();
    if (r.deps.env.platform !== "darwin" || !session) return "unavailable";
    try {
      await privileged(r, LOWPOWERMODE, "lowpowermode", session.id);
      return "on";
    } catch {
      // No helper, journal not writable, or the command failed: Low Power Mode is unavailable.
      return "unavailable";
    }
  }

  async function lowPowerOff(r: Run): Promise<void> {
    await r.manager.undo((e) => e.kind === LOWPOWERMODE).catch(() => undefined);
  }

  /** Ends lid-closed mode (sleep restored). The session-end mark goes first, for the backstop. */
  async function disengage(r: Run, why: string): Promise<UndoReport | undefined> {
    const engaged = r.engaged;
    if (!engaged) return undefined;
    r.engaged = null;
    r.manager.markSessionEnded(engaged.sessionId);
    const report = await r.manager.undo((e) => e.kind === DISABLESLEEP);
    // A held recovery lock means NOTHING was undone: that is not "restored" (and stays pending).
    const restored = restoredBy(report);
    emit(r, "awake.lid_closed.ended", restored ? "info" : "warning", {
      session_id: engaged.sessionId,
      why,
      restored,
    });
    return report;
  }

  async function cleanupSession(r: Run, id: string, why: string): Promise<void> {
    const tracked = r.tracked;
    if (!tracked || tracked.id !== id) return;
    r.tracked = null;
    if (tracked.touched) r.manager.markSessionEnded(id);
    await disengage(r, why);
    await r.watcher.release();
  }

  async function tickNow(r: Run): Promise<void> {
    const active = r.deps.session.active();
    if (r.tracked && r.tracked.id !== active?.id)
      await cleanupSession(r, r.tracked.id, "session_ended");
    if (!active) return;
    if (!r.tracked) {
      r.tracked = { id: active.id, touched: false };
      r.watcher.begin();
      r.lastFloorTick = Number.NEGATIVE_INFINITY;
    }
    await r.lid.poll();
    const now = r.deps.env.clock.now();
    if (now - r.lastFloorTick >= r.deps.batteryPollMs) {
      r.lastFloorTick = now;
      await r.watcher.tick();
    }
  }

  function runTick(r: Run): Promise<void> {
    r.busy ??= tickNow(r)
      .catch((err: unknown) => {
        r.ctx.logger.warn("awake recovery check failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        r.busy = undefined;
      });
    return r.busy;
  }

  function arm(r: Run, pollMs: number): void {
    if (r.stopped) return;
    r.timer = r.deps.env.clock.setTimer(() => {
      void runTick(r).finally(() => arm(r, pollMs));
    }, pollMs);
  }

  async function helperInstalled(r: Run): Promise<boolean | null> {
    const now = r.deps.env.clock.now();
    if (r.helperProbe && now - r.helperProbe.at < HELPER_PROBE_TTL_MS)
      return r.helperProbe.installed;
    if (r.deps.env.platform !== "darwin") return null;
    const installed = await r.helper.probe();
    r.helperProbe = { at: now, installed };
    return installed;
  }

  return {
    events: EVENTS,
    permissions: ["filesystem_write"],
    stateRules: [
      {
        match: "awake.recovery.pending",
        group: "awake.recovery",
        effect: {
          state: "WARNING",
          explain: "A system change could not be undone: open Keep awake",
        },
      },
      { match: "awake.recovery.reconciled", group: "awake.recovery", effect: { clear: true } },
    ],
    configProperties: FLOORS_CONFIG_SCHEMA,
    commandSpecs: [
      {
        name: "lid_closed.start",
        description:
          "Keeps the computer awake with the lid closed for the running keep-awake session (`pmset -a disablesleep 1` through the optional sudo rule). Needs the one-time safety acknowledgement and the privileged helper. Asks for confirmation every time.",
        side_effect: "execute",
        permissions: ["shell_command"],
        timeout_ms: 30_000,
        input_schema: NO_INPUT,
      },
      {
        name: "lid_closed.end",
        description: "Ends lid-closed mode and restores normal sleep.",
        side_effect: "execute",
        permissions: ["shell_command"],
        timeout_ms: 30_000,
        input_schema: NO_INPUT,
      },
      {
        name: "recovery.status",
        description:
          "What the recovery journal says still needs undoing, the lid state, the floors, and whether the safety warning was acknowledged. Read-only.",
        side_effect: "read",
        timeout_ms: 20_000,
        input_schema: NO_INPUT,
      },
      {
        name: "recovery.undo_now",
        description: "Undoes every change the recovery journal still lists. Asks for confirmation.",
        side_effect: "execute",
        permissions: ["shell_command"],
        timeout_ms: 60_000,
        input_schema: NO_INPUT,
      },
      {
        name: "recovery.discard",
        description:
          "Removes ONE pending recovery entry whose kind this version of Phoenix has no way to undo (for example a leftover or forged journal line that keeps the warning on). It changes nothing on the computer and is recorded in the audit log. Entries that can be undone are refused: use recovery.undo_now. Asks for confirmation.",
        side_effect: "write",
        permissions: ["filesystem_write"],
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 80 } },
        },
      },
      {
        name: "safety.acknowledge",
        description:
          "SAFETY ACKNOWLEDGEMENT, made in YOUR name: records that YOU read the lid-closed safety warning (a closed computer that stays awake can overheat: never carry it in a bag or case while it is on). Approve this ONLY if you yourself read the warning on screen; an agent or script must never approve it for you. The input carries the SHA-256 of the warning text, so the acknowledgement is bound to that wording. Asks for confirmation.",
        side_effect: "write",
        permissions: ["filesystem_write"],
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["acknowledge", "version", "text_sha256"],
          properties: {
            acknowledge: { const: true },
            version: { type: "integer", minimum: 1 },
            text_sha256: { type: "string", minLength: 64, maxLength: 64 },
          },
        },
      },
    ],
    commands: {
      async "lid_closed.start"(input) {
        noInput(input);
        const r = need();
        if (r.stopped) throw new AwakeError("unavailable", "The awake capability is shutting down");
        if (r.deps.env.platform !== "darwin") {
          throw new AwakeError("unavailable", "Lid-closed mode is available on macOS only");
        }
        if (!readSafety(r.fs, r.safetyPath).acknowledged) {
          throw new AwakeError(
            "invalid",
            "Read and acknowledge the safety warning first (safety.acknowledge)",
          );
        }
        const session = r.deps.session.active();
        if (!session) {
          throw new AwakeError(
            "no_session",
            "Start a keep-awake session first: lid-closed mode lasts as long as it",
          );
        }
        if (r.engaged) throw new AwakeError("conflict", "Lid-closed mode is already on");
        r.tracked ??= { id: session.id, touched: false };
        try {
          await privileged(r, DISABLESLEEP, "disablesleep", session.id);
        } catch (err) {
          if (err instanceof JournalWriteError) {
            throw new AwakeError(
              "unavailable",
              "The recovery journal cannot be written, so nothing was changed",
            );
          }
          if (err instanceof HelperUnavailableError) {
            throw new AwakeError(
              "unavailable",
              "The privileged helper is not installed (see docs/awake-helper.md): the session continues without lid-closed mode",
            );
          }
          // The command may have run (a timeout): put sleep back rather than guess.
          await r.manager.undo((e) => e.kind === DISABLESLEEP).catch(() => undefined);
          throw new AwakeError("unavailable", "Lid-closed mode could not be turned on");
        }
        if (r.stopped) {
          // Shutdown began while the change was in flight; its undo is queued behind it and restores sleep.
          throw new AwakeError("unavailable", "The awake capability is shutting down");
        }
        r.engaged = { sessionId: session.id, since: r.deps.env.clock.now() };
        emit(r, "awake.lid_closed.started", "info", { session_id: session.id });
        return { engaged: true, session_id: session.id };
      },
      async "lid_closed.end"(input) {
        noInput(input);
        const r = need();
        const was = r.engaged !== null;
        const report = await disengage(r, "user");
        return { ended: was, restored: report ? restoredBy(report) : true };
      },
      async "recovery.status"(input) {
        noInput(input);
        const r = need();
        const parsed = r.journal.read();
        const self = await r.manager.identity();
        const pending = [];
        for (const e of parsed.pending.slice(0, STATUS_PENDING_LIMIT)) {
          const mine = e.owner.pid === self.pid && e.owner.started === self.started;
          const owner = mine ? "self" : (await r.probe.alive(e.owner)) ? "other" : "dead";
          pending.push({
            id: e.id,
            kind: e.kind,
            at: e.at,
            session: e.session,
            owner,
            discardable: !r.manager.canUndo(e.kind),
          });
        }
        const safety = readSafety(r.fs, r.safetyPath);
        const last = r.watcher.last;
        const blocked = r.manager.lockBlocked();
        return {
          session_active: r.deps.session.active() !== null,
          // The journal this Phoenix writes. Compare it with the WATCH line of install-helper.sh --print-plan.
          journal_path: r.journal.path,
          recovery_lock: {
            blocked: blocked !== undefined,
            since: blocked ? new Date(blocked.since).toISOString() : null,
          },
          sleep_disabled_unjournaled: await sleepDisabledUnjournaled(r, parsed.pending),
          journal: {
            pending,
            untrusted: parsed.untrusted,
            partial_tail: parsed.partialTail,
            size_bytes: r.journal.sizeBytes(),
          },
          can_quit: r.manager.canQuit().ok,
          helper: { installed: await helperInstalled(r) },
          lid: { supported: r.lid.supported(), state: r.lid.state() },
          lid_closed: {
            engaged: r.engaged !== null,
            since: r.engaged ? new Date(r.engaged.since).toISOString() : null,
            session_id: r.engaged?.sessionId ?? null,
          },
          floors: {
            enabled: r.floors.enabled,
            low_power_percent: r.floors.lowPowerPercent,
            end_percent: r.floors.endPercent,
            thermal_low_power_level: r.floors.thermalLowPower,
            thermal_end_level: r.floors.thermalEnd,
            low_power_active: r.watcher.lowPower,
            last: last
              ? {
                  battery: batteryView(last.battery),
                  thermal:
                    last.thermal.kind === "level" ? last.thermal : { kind: last.thermal.kind },
                }
              : null,
          },
          safety: { ...safety, text_sha256: SAFETY_TEXT_SHA256 },
        };
      },
      async "recovery.discard"(input) {
        const r = need();
        if (!isRecord(input) || typeof input.id !== "string" || Object.keys(input).length !== 1) {
          throw new AwakeError("invalid", "discard needs exactly { id }");
        }
        let discarded;
        try {
          discarded = await r.manager.discard(input.id);
        } catch {
          throw new AwakeError("unavailable", "The recovery journal cannot be written");
        }
        if (!discarded) {
          throw new AwakeError(
            "invalid",
            "No such pending entry, or it can be undone (use recovery.undo_now): nothing was discarded",
          );
        }
        r.ctx.logger.warn("recovery entry discarded", { id: discarded.id, kind: discarded.kind });
        return { discarded: true, id: discarded.id, kind: discarded.kind };
      },
      async "recovery.undo_now"(input) {
        noInput(input);
        const r = need();
        const report = await r.manager.undo();
        if (r.engaged && !r.journal.read().pending.some((e) => e.kind === DISABLESLEEP))
          r.engaged = null;
        return {
          undone: report.undone.length,
          failed: report.failed.map((f) => ({ id: f.id, kind: f.kind })),
          held_by_other: report.heldByOther,
          locked: report.locked,
          untrusted: report.untrusted,
        };
      },
      "safety.acknowledge"(input) {
        const r = need();
        if (
          !isRecord(input) ||
          input.acknowledge !== true ||
          input.version !== SAFETY_VERSION ||
          input.text_sha256 !== SAFETY_TEXT_SHA256
        ) {
          throw new AwakeError(
            "invalid",
            `acknowledge must be true, version ${SAFETY_VERSION} and the text_sha256 of the warning shown in recovery.status`,
          );
        }
        const at = new Date(r.deps.env.clock.now()).toISOString();
        try {
          writeSafety(r.fs, r.safetyPath, r.dir, at);
        } catch {
          throw new AwakeError("unavailable", "The acknowledgement could not be saved");
        }
        emit(r, "awake.safety.acknowledged", "info", {
          version: SAFETY_VERSION,
          text_sha256: SAFETY_TEXT_SHA256,
        });
        return { acknowledged: true, version: SAFETY_VERSION, acknowledged_at: at };
      },
    },
    init(ctx, deps) {
      run?.unsubscribe?.();
      if (run) {
        run.stopped = true;
        if (run.timer !== undefined) run.deps.env.clock.clearTimer(run.timer);
      }
      const dir = join(options.dir ?? defaultDataDir(), "awake");
      const fs = options.fs ?? nodeJournalFs;
      const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
      const clock = deps.env.clock;
      const journal = new RecoveryJournal({ path: join(dir, "recovery-journal.jsonl"), fs });
      const probe = options.probe ?? createProcessProbe(deps.env.run, process.pid);
      const reverters: Record<string, Reverter> = {};
      const helper = createHelperClient(deps.env.run);
      const manager = new RecoveryManager({
        journal,
        lock: new RecoveryLock({
          path: join(dir, "recovery.lock"),
          fs,
          probe,
          now: () => clock.now(),
        }),
        probe,
        reverters,
        verifyNotApplied: async (entry) => {
          // Read-only. Only the two pmset kinds can be checked; anything else (or an unreadable
          // answer) is "not sure", so the entry stays pending.
          const out = await readPmset(r);
          if (out === undefined) return false;
          if (entry.kind === DISABLESLEEP) return pmsetSetting(out, "SleepDisabled") === 0;
          if (entry.kind === LOWPOWERMODE) return pmsetSetting(out, "lowpowermode") === 0;
          return false;
        },
        now: () => clock.now(),
        newId: options.newId ?? (() => `chg_${crypto.randomUUID().replaceAll("-", "")}`),
        emit: (type: RecoveryEvent, severity, payload) => emit(r, type, severity, payload),
      });
      const lid = createLidObserver(deps.env);
      const floors = floorsFromConfig(ctx.config);
      // The watcher's ports and the manager's emit close over `r`; they only run after it exists.
      const r: Run = {
        ctx,
        deps,
        floors,
        journal,
        manager,
        probe,
        lid,
        helper,
        watcher: new FloorWatcher(floors, {
          readBattery: () => deps.battery(),
          readThermal: () => readThermal(deps.env),
          lowPowerOn: () => lowPowerOn(r),
          lowPowerOff: () => lowPowerOff(r),
          endSession: (reason) => {
            const id = deps.session.active()?.id;
            deps.session.end(reason);
            if (id !== undefined) void cleanupSession(r, id, reason);
          },
          emit: (type, severity, payload) => emit(r, type, severity, payload),
        }),
        safetyPath: join(dir, "safety.json"),
        dir,
        fs,
        tracked: null,
        engaged: null,
        helperProbe: null,
        lastFloorTick: Number.NEGATIVE_INFINITY,
        timer: undefined,
        unsubscribe: undefined,
        stopped: false,
        shuttingDown: undefined,
        busy: undefined,
      };
      for (const kind of [DISABLESLEEP, LOWPOWERMODE]) {
        reverters[kind] = async (undo, entry) => {
          await helper.run(offArgv(entry.kind, undo));
        };
      }
      lid.onLid((state) => {
        emit(r, state === "closed" ? "awake.lid.closed" : "awake.lid.opened", "info", {
          session_id: deps.session.active()?.id ?? null,
        });
      });
      run = r;
      services.set(deps, {
        recovery: manager,
        lid,
        helper,
        registerReverter(kind, reverter) {
          if (Object.hasOwn(reverters, kind))
            throw new Error(`a reverter for "${kind}" is already registered`);
          reverters[kind] = reverter;
        },
        canQuit() {
          const check = manager.canQuit();
          if (!check.ok) {
            emit(r, "awake.recovery.quit_refused", "warning", { count: check.pending.length });
          }
          return check;
        },
        tick: () => runTick(r),
      });
      try {
        r.unsubscribe = deps.feed?.subscribe(
          "awake-recovery",
          ["awake.session.ended"],
          () => void runTick(r),
        );
      } catch {
        r.unsubscribe = undefined;
      }
      arm(r, pollMs);
      // Crash recovery. Runs after every module's synchronous init, so reverters registered by
      // other modules (Lid74) exist by then.
      queueMicrotask(() => {
        void manager.reconcile().catch((err: unknown) => {
          ctx.logger.warn("awake reconcile failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
      const onAbort = () => void shutdownRun(r);
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener("abort", onAbort, { once: true });
    },
    /** Stops and undoes; resolves when the undo is done or SHUTDOWN_WAIT_MS has passed (a caller may await it). */
    shutdown(): Promise<void> {
      return run ? shutdownRun(run) : Promise.resolve();
    },
  };

  /** Stops timers and starts the undo. The synchronous part is the journal mark the backstop reads. */
  function shutdownRun(r: Run): Promise<void> {
    if (r.stopped) return r.shuttingDown ?? Promise.resolve();
    r.stopped = true;
    if (r.timer !== undefined) r.deps.env.clock.clearTimer(r.timer);
    r.unsubscribe?.();
    const id = r.tracked?.id;
    if (id !== undefined && (r.tracked?.touched ?? false)) r.manager.markSessionEnded(id);
    // Sync release is impossible for sudo. The mark above, the launchd backstop and the next
    // launch's reconcile are the net; the undo below is the fast path.
    r.tracked = null;
    r.engaged = null;
    // The undo queues behind any change still in flight (see RecoveryManager.change), so the OFF
    // can never overtake an ON that is still running.
    const undone = r.manager.undo().then(
      () => undefined,
      () => undefined,
    );
    const capped = Promise.withResolvers<void>();
    const timer = r.deps.env.clock.setTimer(() => capped.resolve(), SHUTDOWN_WAIT_MS);
    r.shuttingDown = Promise.race([undone, capped.promise]).then(() =>
      r.deps.env.clock.clearTimer(timer),
    );
    return r.shuttingDown;
  }
}

function batteryView(reading: BatteryReading): Record<string, unknown> {
  return reading.kind === "battery"
    ? { kind: "battery", percent: reading.percent, on_battery: reading.onBattery }
    : { kind: reading.kind };
}

/** The instance appended to MODULES in ../index.ts. */
export const recoveryModule: AwakeModule = createRecoveryModule();
