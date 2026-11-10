// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Dictation (Phase 64), Core side. The rules live in `@phoenix/ai-multimodal` (dictation/); this
// file connects them to Core: settings in the settings store, aggregate statistics in the
// `dictation_stats` table (migration 27: counts only), AI clean-up through AiService (local only),
// the kill switch, the audit log and the `dictation.listening` / `dictation.idle` events that make
// every Fawkes view show LISTENING for the whole capture.
import type {
  DictationApi,
  DictationResultView,
  DictationSettingsView,
  DictationStartedView,
  DictationStatsView,
  DictationStatusView,
  DictationStreamHandle,
} from "@phoenix/api";
import {
  DEFAULT_DICTATION_SETTINGS,
  DictationError,
  DictationSessions,
  MAX_APP_MODES,
  MAX_DISTINCT_APPS,
  OTHER_APP,
  SESSION_LIMITS,
  VOCABULARY_LIMITS,
  cleanupGenerateWith,
  localDay,
  patchSettings,
  readSettings,
  realTimers,
  summarise,
  type DictationSettings,
  type FinishedSession,
  type SpeechRecognizer,
  type StatsRow,
  type Timers,
} from "@phoenix/ai-multimodal";
import type { AiService } from "@phoenix/ai-models";
import type { Logger } from "@phoenix/logging";
import type { EventBus } from "@phoenix/event-bus";
import type { PermissionGateway } from "@phoenix/permissions";
import type { Database, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError, createEvent } from "@phoenix/protocol";
import type { MappingRule, StateEngine } from "@phoenix/state-engine";

export const DICTATION_SETTINGS_KEY = "dictation.settings";
/** The user's retention for `dictation_stats` (its own key: the dictation settings stay untouched). */
export const DICTATION_STATS_RETENTION_KEY = ["dictation", "stats_retention"].join(".");
/** Days a statistics row may be kept. `null` (the default) keeps rows until the user deletes them. */
export const DICTATION_STATS_RETENTION_CHOICES = [30, 90, 365] as const;
export type DictationStatsRetentionDays = (typeof DICTATION_STATS_RETENTION_CHOICES)[number] | null;
/** How often the pruning pass runs after Core starts. */
export const DICTATION_STATS_PRUNE_INTERVAL_MS = 86_400_000;

/**
 * The first local day that is still kept: rows with a `day` before it are older than `days` days.
 * A row dated exactly `days` calendar days ago is kept; one more day is deleted. Calendar
 * arithmetic at noon, so a daylight-saving shift never moves the boundary.
 */
export function statsRetentionCutoffDay(nowMs: number, days: number): string {
  const [y, m, d] = localDay(nowMs).split("-").map(Number) as [number, number, number];
  return localDay(new Date(y, m - 1, d - days, 12).getTime());
}

/**
 * How Fawkes shows a dictation. No timeout on purpose: the indicator must not disappear while
 * audio can still arrive; the session manager always publishes `dictation.idle` (its own length
 * limit is 120 s).
 */
export const DICTATION_STATE_RULES: readonly MappingRule[] = [
  {
    match: "dictation.listening",
    effect: { state: "LISTENING", explain: "Dictating: your microphone is on" },
  },
  { match: "dictation.idle", effect: { clear: true } },
];

export interface DictationRuntimeDeps {
  db: Database;
  settings: SettingsStore;
  bus: EventBus;
  state: StateEngine;
  permissions: PermissionGateway;
  /** The model layer for optional clean-up (always called as local-only, see ai-multimodal). */
  ai: AiService;
  aiEnabled: () => boolean;
  /** Absent = no on-device recogniser: the Core reports `unavailable` and refuses to start. */
  recognizer: SpeechRecognizer | null;
  logger: Logger;
  now?: () => number;
  timers?: Timers;
}

const UNAVAILABLE: SpeechRecognizer = {
  availability: () =>
    Promise.resolve({
      available: false,
      detail:
        "No on-device speech recogniser that keeps audio off the disk is configured. Set a local Whisper model to enable one.",
    }),
  start() {
    throw new DictationError("unavailable", "No speech recogniser is configured");
  },
};

const CODE_BY_KIND: Record<DictationError["kind"], ErrorCode> = {
  disabled: ErrorCode.CAPABILITY_DISABLED,
  busy: ErrorCode.INVALID_REQUEST,
  not_found: ErrorCode.RESOURCE_NOT_FOUND,
  limit: ErrorCode.INVALID_REQUEST,
  invalid: ErrorCode.INVALID_REQUEST,
  unavailable: ErrorCode.CAPABILITY_UNAVAILABLE,
  aborted: ErrorCode.INVALID_REQUEST,
};

/** Dictation refusals become PhoenixErrors with a safe message; anything else is not leaked. */
function asPhoenixError(err: unknown): PhoenixError {
  if (err instanceof PhoenixError) return err;
  if (err instanceof DictationError) return new PhoenixError(CODE_BY_KIND[err.kind], err.message);
  return new PhoenixError(ErrorCode.INTERNAL_ERROR, "Dictation failed");
}

async function contained<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw asPhoenixError(err);
  }
}

export class DictationRuntime implements DictationApi {
  private readonly sessions: DictationSessions;
  private readonly recognizer: SpeechRecognizer;
  private readonly now: () => number;
  private readonly rules: readonly MappingRule[];
  private readonly offKill: () => void;
  private cancelPrune: (() => void) | null = null;
  private closed = false;

  constructor(private readonly d: DictationRuntimeDeps) {
    this.now = d.now ?? Date.now;
    this.recognizer = d.recognizer ?? UNAVAILABLE;
    this.rules = DICTATION_STATE_RULES;
    d.state.addRules(this.rules);
    this.sessions = new DictationSessions({
      recognizer: this.recognizer,
      settings: () => this.load(),
      killSwitchEngaged: () => d.permissions.isKillSwitchEngaged(),
      generate: () => (d.aiEnabled() ? cleanupGenerateWith(d.ai) : null),
      onListening: (on, id) => this.publishListening(on, id),
      onFinished: (done) => this.addStats(done),
      audit: (action, details) =>
        void d.permissions.audit.record({ actor: "user", action, decision: "info", details }),
      ...(d.timers ? { timers: d.timers } : {}),
      now: this.now,
    });
    // The emergency stop ends a dictation at once, not at the next audio frame.
    this.offKill = d.bus.subscribe("dictation", "security.kill_switch.engaged", () =>
      this.sessions.abortAll("kill_switch"),
    );
  }

  /** Ends any session (shutdown): audio zeroed, `dictation.idle` published, rules removed. */
  close(): void {
    this.closed = true;
    this.cancelPrune?.();
    this.cancelPrune = null;
    this.sessions.abortAll("shutdown");
    this.offKill();
    this.d.state.removeRules(this.rules);
  }

  private publishListening(listening: boolean, session: string): void {
    const result = this.d.bus.publish(
      createEvent({
        event_type: listening ? "dictation.listening" : "dictation.idle",
        source: "core",
        severity: "info",
        correlation_id: `dictation-${session}`,
        // No text, no app id: the id of the session only.
        payload: { session },
      }),
      { ephemeral: true },
    );
    if (!result.ok) this.d.logger.warn("dictation event rejected", { code: result.error.code });
  }

  private load(): DictationSettings {
    return readSettings(this.d.settings.get<unknown>(DICTATION_SETTINGS_KEY, null));
  }

  settings(): DictationSettingsView {
    return this.load();
  }

  setSettings(patch: unknown): DictationSettingsView {
    let next: DictationSettings;
    try {
      next = patchSettings(this.load(), patch);
    } catch (err) {
      throw asPhoenixError(err);
    }
    this.d.settings.set(DICTATION_SETTINGS_KEY, next);
    if (!next.enabled) this.sessions.abortAll("disabled");
    void this.d.permissions.audit.record({
      actor: "user",
      action: "dictation.settings",
      decision: "info",
      details: {
        enabled: next.enabled,
        default_mode: next.default_mode,
        apps: Object.keys(next.app_modes).length,
        dictionary: next.vocabulary.dictionary.length,
        replacements: next.vocabulary.replacements.length,
        snippets: next.vocabulary.snippets.length,
      },
    });
    return next;
  }

  async status(): Promise<DictationStatusView> {
    const killSwitchEngaged = this.d.permissions.isKillSwitchEngaged();
    const recognizer = killSwitchEngaged
      ? { available: false, detail: "Emergency stop engaged" }
      : await this.recognizer.availability();
    const ai = this.d.aiEnabled();
    return {
      enabled: this.load().enabled,
      kill_switch_engaged: killSwitchEngaged,
      recognizer,
      audio_on_disk: recognizer.audio_on_disk === true,
      cleanup: {
        available: ai && !killSwitchEngaged,
        locality: "local",
        detail: ai
          ? "Clean-up uses a model on this device only; if none answers, your text is used as recognised"
          : "AI is off in Settings, so clean-up modes other than 'as said' do nothing",
      },
      active: this.sessions.active(),
      limits: {
        max_seconds: SESSION_LIMITS.maxSeconds,
        max_bytes: SESSION_LIMITS.maxBytes,
        max_frame_bytes: SESSION_LIMITS.maxFrameBytes,
      },
      vocabulary_limits: {
        dictionary: VOCABULARY_LIMITS.dictionary,
        replacements: VOCABULARY_LIMITS.replacements,
        snippets: VOCABULARY_LIMITS.snippets,
        phrase_words: VOCABULARY_LIMITS.phraseWords,
        phrase_chars: VOCABULARY_LIMITS.phraseChars,
        term_chars: VOCABULARY_LIMITS.termChars,
        replacement_chars: VOCABULARY_LIMITS.replacementChars,
        snippet_chars: VOCABULARY_LIMITS.snippetChars,
        app_modes: MAX_APP_MODES,
      },
    };
  }

  start(app: string | undefined): Promise<DictationStartedView> {
    return contained(() => this.sessions.start(app));
  }

  finish(id: string): Promise<DictationResultView> {
    return contained(() => this.sessions.finish(id));
  }

  cancel(id: string): void {
    try {
      this.sessions.cancel(id);
    } catch (err) {
      throw asPhoenixError(err);
    }
  }

  streamAvailable(id: string): boolean {
    return this.sessions.streamAvailable(id);
  }

  openStream(id: string, onEnded: (reason: string) => void): DictationStreamHandle {
    try {
      return this.sessions.openStream(id, onEnded);
    } catch (err) {
      throw asPhoenixError(err);
    }
  }

  /** Adds one finished dictation to today's row. Counts only. */
  private addStats(done: FinishedSession): void {
    const day = localDay(this.now());
    const known = this.d.db
      .prepare("SELECT 1 AS yes FROM dictation_stats WHERE app = ? LIMIT 1")
      .get(done.app) as { yes: number } | undefined;
    let app = done.app;
    if (!known && app !== "") {
      const distinct = (
        this.d.db.prepare("SELECT COUNT(DISTINCT app) AS n FROM dictation_stats").get() as {
          n: number;
        }
      ).n;
      if (distinct >= MAX_DISTINCT_APPS) app = OTHER_APP;
    }
    this.d.db
      .prepare(
        `INSERT INTO dictation_stats (day, app, words, speech_ms, sessions) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(day, app) DO UPDATE SET
           words = words + excluded.words,
           speech_ms = speech_ms + excluded.speech_ms,
           sessions = sessions + 1`,
      )
      .run(day, app, done.words, done.speech_ms);
  }

  stats(): DictationStatsView {
    const rows = this.d.db
      .prepare("SELECT day, app, words, speech_ms, sessions FROM dictation_stats")
      .all() as unknown as StatsRow[];
    return summarise(
      rows,
      this.load().typing_wpm ?? DEFAULT_DICTATION_SETTINGS.typing_wpm,
      localDay(this.now()),
    );
  }

  /** The saved retention for statistics rows; `null` (the default, and any stored value that is not a choice) keeps them until deleted. */
  statsRetention(): { retention_days: DictationStatsRetentionDays } {
    const stored = this.d.settings.get<unknown>(DICTATION_STATS_RETENTION_KEY, null);
    const known = DICTATION_STATS_RETENTION_CHOICES.find((days) => days === stored);
    return { retention_days: known ?? null };
  }

  /** Saves the retention. It is applied by the next pruning pass (Core start or the daily timer), not now. */
  setStatsRetention(input: unknown): { retention_days: DictationStatsRetentionDays } {
    const bad = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
    if (typeof input !== "object" || input === null || Array.isArray(input))
      throw bad("The body must be an object");
    const keys = Object.keys(input);
    if (keys.length !== 1 || keys[0] !== "retention_days")
      throw bad("Only `retention_days` is accepted");
    const value = (input as { retention_days: unknown }).retention_days;
    const choice =
      value === null ? null : DICTATION_STATS_RETENTION_CHOICES.find((days) => days === value);
    if (choice === undefined) throw bad("`retention_days` must be null, 30, 90 or 365");
    this.d.settings.set(DICTATION_STATS_RETENTION_KEY, choice);
    void this.d.permissions.audit.record({
      actor: "user",
      action: "dictation.stats.retention",
      decision: "info",
      details: { retention_days: choice },
    });
    return { retention_days: choice };
  }

  /** How many statistics rows exist (for the privacy inventory). */
  statsRowCount(): number {
    return (this.d.db.prepare("SELECT COUNT(*) AS n FROM dictation_stats").get() as { n: number })
      .n;
  }

  /**
   * Deletes `dictation_stats` rows older than the saved retention, by their `day`; no other table
   * is touched. With no retention set (the default) nothing is deleted. The audit entry carries the
   * count only. Returns how many rows were deleted.
   */
  pruneStats(): number {
    const { retention_days: days } = this.statsRetention();
    if (days === null) return 0;
    const cutoff = statsRetentionCutoffDay(this.now(), days);
    const deleted = Number(
      this.d.db.prepare("DELETE FROM dictation_stats WHERE day < ?").run(cutoff).changes,
    );
    if (deleted > 0)
      void this.d.permissions.audit.record({
        actor: "core",
        action: "dictation.stats.retention_prune",
        decision: "info",
        details: { retention_days: days, rows: deleted },
      });
    return deleted;
  }

  /** Runs the pruning pass now, then once a day on the injected timers until `close()`. */
  startStatsRetention(): void {
    if (this.closed) return;
    this.cancelPrune?.();
    try {
      this.pruneStats();
    } catch (err) {
      this.d.logger.warn("dictation statistics pruning failed", { error: String(err) });
    }
    this.cancelPrune = (this.d.timers ?? realTimers).after(
      () => this.startStatsRetention(),
      DICTATION_STATS_PRUNE_INTERVAL_MS,
    );
  }

  deleteStats(): { deleted: number } {
    const result = this.d.db.prepare("DELETE FROM dictation_stats").run();
    void this.d.permissions.audit.record({
      actor: "user",
      action: "dictation.stats.delete",
      decision: "info",
      details: { rows: Number(result.changes) },
    });
    return { deleted: Number(result.changes) };
  }
}
