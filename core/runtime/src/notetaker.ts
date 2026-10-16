// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The botless notetaker (Phase 65), Core side. The rules live in `@phoenix/ai-multimodal`
// (notetaker/); this file connects them to Core: the setting, the audit log, the kill switch, the
// `notetaker.recording` / `notetaker.idle` events that make every Fawkes view show RECORDING for the
// whole capture, and the writer that turns what was heard into a meeting record in MeetingStore.
//
// Nothing in here writes audio anywhere. The transcript is written to the meeting record after every
// window (so a crash loses at most one window); the summary comes from a model on this device only
// and is simply absent when that fails.
import type {
  NotetakerApi,
  NotetakerSettingsView,
  NotetakerStartedView,
  NotetakerStatusView,
  NotetakerStreamHandle,
} from "@phoenix/api";
import {
  DictationError,
  NOTETAKER_LIMITS,
  NotetakerSessions,
  summariseCall,
  SUMMARY_TIMEOUT_MS,
  type NotetakerEndReason,
  type SpeechRecognizer,
  type SummaryGenerate,
  type Timers,
  type TranscriptSegment,
} from "@phoenix/ai-multimodal";
import type { AiService } from "@phoenix/ai-models";
import type { Logger } from "@phoenix/logging";
import type { EventBus } from "@phoenix/event-bus";
import type { PermissionGateway } from "@phoenix/permissions";
import type { MeetingStore, SettingsStore, Summary } from "@phoenix/persistence";
import { ErrorCode, PhoenixError, createEvent } from "@phoenix/protocol";
import type { MappingRule, StateEngine } from "@phoenix/state-engine";

export const NOTETAKER_SETTINGS_KEY = "notetaker.enabled";
/** The capability id of meetings made here. Kage's are "kage"; this one is never a capability. */
export const NOTETAKER_CAPABILITY_ID = "notetaker";

/** How Fawkes shows a recording. No timeout on purpose: a recording indicator never silently disappears. */
export const NOTETAKER_STATE_RULES: readonly MappingRule[] = [
  {
    match: "notetaker.recording",
    effect: { state: "RECORDING", explain: "Recording a call from this computer" },
  },
  { match: "notetaker.idle", effect: { clear: true } },
];

const RECORDING_PLACE = {
  location: "none \u2014 audio is never stored",
  retention: "audio is discarded as it is transcribed",
};

/** A confirmation surface bound to a person (never to the session token). */
export interface NotetakerConsentChannel {
  /** Short label of the surface, for the audit log (e.g. "desktop-dialog"). */
  readonly kind: string;
  /** Asks the person about THIS recording. Resolves true only when they said yes now. */
  confirm(info: { title: string | null }): Promise<boolean>;
}

const CONSENT_UNAVAILABLE_DETAIL =
  "Recording needs a confirmation from a person on a screen only they can use. This build has none (the browser and the session token cannot give it), so recording is off";

export interface NotetakerRuntimeDeps {
  settings: SettingsStore;
  bus: EventBus;
  state: StateEngine;
  permissions: PermissionGateway;
  meetings: MeetingStore;
  /** The model layer for the summary (always called as local-only, see ai-multimodal). */
  ai: AiService;
  aiEnabled: () => boolean;
  /** Absent = no on-device recogniser: the Core reports `unavailable` and refuses to start. */
  recognizer: SpeechRecognizer | null;
  logger: Logger;
  now?: () => number;
  timers?: Timers;
  /** Samples per transcription window (tests make it small). Default: 30 s. */
  windowSamples?: number;
  /**
   * The ONLY thing that can authorise a recording: a surface a person answers and a session-token
   * holder cannot drive. Null (the default) means Core has none, and every start is refused with
   * CONSENT_CHANNEL_UNAVAILABLE before any recogniser or buffer exists. Embedders (the desktop shell,
   * tests) pass it in code; no HTTP request, setting or event can supply or fake one.
   */
  consent: NotetakerConsentChannel | null;
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

/** Refusals become PhoenixErrors with a safe message; anything else is not leaked. */
function asPhoenixError(err: unknown): PhoenixError {
  if (err instanceof PhoenixError) return err;
  if (err instanceof DictationError) return new PhoenixError(CODE_BY_KIND[err.kind], err.message);
  return new PhoenixError(ErrorCode.INTERNAL_ERROR, "The notetaker failed");
}

/** What has been written to the meeting record so far, for the one active session. */
interface Draft {
  id: string;
  meetingId: string;
  segments: TranscriptSegment[];
}

export class NotetakerRuntime implements NotetakerApi {
  private readonly sessions: NotetakerSessions;
  private readonly recognizer: SpeechRecognizer;
  private readonly now: () => number;
  private readonly rules: readonly MappingRule[] = NOTETAKER_STATE_RULES;
  private readonly offKill: () => void;
  private draft: Draft | null = null;

  constructor(private readonly d: NotetakerRuntimeDeps) {
    this.now = d.now ?? Date.now;
    this.recognizer = d.recognizer ?? UNAVAILABLE;
    d.state.addRules(this.rules);
    this.sessions = new NotetakerSessions({
      recognizer: this.recognizer,
      enabled: () => this.enabled(),
      killSwitchEngaged: () => d.permissions.isKillSwitchEngaged(),
      onRecording: (on, id) => this.publishRecording(on, id),
      onStarted: (info) => this.openMeeting(info),
      confirmConsent: (info) => this.confirmWithPerson(info),
      onSegment: (id, segment) => this.writeSegment(id, segment),
      onEnded: (info) => this.closeMeeting(info),
      audit: (action, details) =>
        void d.permissions.audit.record({
          actor: "user",
          action,
          decision: "info",
          // The surface that confirmed, never the request flags (those are only claims).
          details:
            action === "notetaker.start"
              ? { ...details, consent_channel: d.consent?.kind }
              : details,
        }),
      ...(d.timers ? { timers: d.timers } : {}),
      ...(d.windowSamples ? { windowSamples: d.windowSamples } : {}),
      now: this.now,
    });
    // The emergency stop ends a recording at once, not at the next audio frame.
    this.offKill = d.bus.subscribe("notetaker", "security.kill_switch.engaged", () =>
      this.sessions.abortAll("kill_switch"),
    );
  }

  /** Ends any session (shutdown): audio zeroed, `notetaker.idle` published, rules removed. */
  close(): void {
    this.sessions.abortAll("shutdown");
    this.offKill();
    this.d.state.removeRules(this.rules);
  }

  private enabled(): boolean {
    return this.d.settings.get<boolean>(NOTETAKER_SETTINGS_KEY, false) === true;
  }

  private publish(type: string, session: string, ephemeral: boolean, extra = {}): void {
    const result = this.d.bus.publish(
      createEvent({
        event_type: type,
        source: "core",
        severity: "info",
        correlation_id: `notetaker-${session}`,
        // No text, no title: ids only.
        payload: { session, ...extra },
      }),
      ephemeral ? { ephemeral: true } : {},
    );
    if (!result.ok) this.d.logger.warn("notetaker event rejected", { code: result.error.code });
  }

  private publishRecording(recording: boolean, session: string): void {
    this.publish(recording ? "notetaker.recording" : "notetaker.idle", session, true);
  }

  /** Tells open views the meeting list changed. Durable, so a reload after reconnect sees it. */
  private meetingChanged(session: string, meetingId: string): void {
    this.publish("notetaker.meeting.updated", session, false, { meeting_id: meetingId });
  }

  // ── The meeting record ─────────────────────────────────────────────────────

  private openMeeting(info: { id: string; title: string | null; startedAtMs: number }): void {
    const startedAt = new Date(info.startedAtMs);
    const meeting = this.d.meetings.upsert({
      capabilityId: NOTETAKER_CAPABILITY_ID,
      externalId: info.id,
      status: "in_progress",
      title: info.title ?? `Call on ${startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
      startedAt: startedAt.toISOString(),
      participants: ["You", "Others"],
      recording: RECORDING_PLACE,
    });
    if (!meeting) throw new Error("meeting record refused");
    this.draft = { id: info.id, meetingId: meeting.id, segments: [] };
    this.meetingChanged(info.id, meeting.id);
  }

  /** Rewrites the whole transcript after each window: a crash loses at most the window in flight. */
  private writeSegment(id: string, segment: TranscriptSegment): void {
    const draft = this.draft;
    if (!draft || draft.id !== id) return;
    draft.segments.push(segment);
    draft.segments.sort((a, b) => a.start_ms - b.start_ms || a.speaker.localeCompare(b.speaker));
    this.d.meetings.setTranscript(draft.meetingId, {
      text: draft.segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
      segments: draft.segments.map((s) => ({ ...s })),
    });
  }

  private closeMeeting(info: {
    id: string;
    reason: NotetakerEndReason;
    completed: boolean;
    startedAtMs: number;
    endedAtMs: number;
  }): void {
    const draft = this.draft;
    this.draft = null;
    if (!draft || draft.id !== info.id) return;
    const heard = draft.segments.length > 0;
    this.d.meetings.upsert({
      capabilityId: NOTETAKER_CAPABILITY_ID,
      externalId: info.id,
      // An abort keeps what was already written; with nothing written the record says it failed.
      status: info.completed ? "transcribed" : heard ? "transcribed" : "failed",
      endedAt: new Date(info.endedAtMs).toISOString(),
      durationSeconds: Math.max(0, Math.round((info.endedAtMs - info.startedAtMs) / 1000)),
    });
    if (info.completed && !heard) {
      // A call with no recognised speech still has a (empty) transcript, so the page does not wait for one.
      this.d.meetings.setTranscript(draft.meetingId, { text: "", segments: [] });
    }
    this.meetingChanged(info.id, draft.meetingId);
  }

  /** The summary of a finished call, from a model on this device. Absent on any failure. */
  private async summarise(meetingId: string, session: string): Promise<void> {
    const transcript = this.d.meetings.transcript(meetingId);
    if (!transcript || transcript.text.trim().length === 0) return;
    if (!this.d.aiEnabled() || this.d.permissions.isKillSwitchEngaged()) return;
    const [capability, external] = [NOTETAKER_CAPABILITY_ID, session];
    this.d.meetings.upsert({
      capabilityId: capability,
      externalId: external,
      status: "summarizing",
    });
    const generate: SummaryGenerate = async (request) =>
      (await this.d.ai.run({ kind: "generate", request, timeoutMs: SUMMARY_TIMEOUT_MS })).result;
    const outcome = await summariseCall(transcript.text, { generate });
    // Nothing is stored after an emergency stop, and nothing for a record the user deleted meanwhile.
    if (outcome.summary !== null && !this.d.permissions.isKillSwitchEngaged()) {
      const stored: Summary & { generated_by: "ai"; generated_model: string } = {
        ...outcome.summary,
        generated_by: "ai",
        generated_model: outcome.model,
      };
      this.d.meetings.setSummary(meetingId, stored);
      this.d.meetings.upsert({ capabilityId: capability, externalId: external, status: "ready" });
    } else {
      this.d.meetings.upsert({
        capabilityId: capability,
        externalId: external,
        status: "transcribed",
      });
      this.d.logger.info("notetaker: no summary stored", {
        reason: outcome.summary === null ? outcome.reason : "emergency_stop",
      });
    }
    this.meetingChanged(session, meetingId);
  }

  // ── NotetakerApi ───────────────────────────────────────────────────────────

  async status(): Promise<NotetakerStatusView> {
    const killSwitchEngaged = this.d.permissions.isKillSwitchEngaged();
    const recognizer = killSwitchEngaged
      ? { available: false, detail: "Emergency stop engaged" }
      : await this.recognizer.availability();
    const ai = this.d.aiEnabled();
    const active = this.sessions.active();
    return {
      enabled: this.enabled(),
      kill_switch_engaged: killSwitchEngaged,
      recognizer,
      consent_channel: this.d.consent
        ? {
            available: true,
            detail: "A person confirms each recording on their own screen",
          }
        : {
            available: false,
            code: ErrorCode.CONSENT_CHANNEL_UNAVAILABLE,
            detail: CONSENT_UNAVAILABLE_DETAIL,
          },
      audio_on_disk: false,
      summary: {
        available: ai && !killSwitchEngaged,
        locality: "local",
        detail: ai
          ? "The summary is made by a model on this device only; if none answers, the call has a transcript and no summary"
          : "AI is off in Settings, so a call gets a transcript and no summary",
      },
      capture: {
        microphone: true,
        system_audio: false,
        detail:
          "Only your microphone is recorded from the browser; other participants are not captured. System audio needs the desktop app.",
      },
      ...(active
        ? {
            active: {
              id: active.id,
              started_at: new Date(active.started_at_ms).toISOString(),
              elapsed_s: Math.max(0, Math.round((this.now() - active.started_at_ms) / 1000)),
            },
          }
        : {}),
      limits: {
        max_seconds: NOTETAKER_LIMITS.maxSeconds,
        max_frame_bytes: NOTETAKER_LIMITS.maxFrameBytes,
        window_seconds: NOTETAKER_LIMITS.windowSeconds,
      },
    };
  }

  setSettings(enabled: boolean): NotetakerSettingsView {
    this.d.settings.set(NOTETAKER_SETTINGS_KEY, enabled);
    if (!enabled) this.sessions.abortAll("disabled");
    void this.d.permissions.audit.record({
      actor: "user",
      action: "notetaker.settings",
      decision: "info",
      details: { enabled },
    });
    return { enabled };
  }

  /** Asks the person (never the caller) about this recording. */
  private async confirmWithPerson(info: { title: string | null }): Promise<boolean> {
    const channel = this.d.consent;
    if (!channel) {
      throw new PhoenixError(ErrorCode.CONSENT_CHANNEL_UNAVAILABLE, CONSENT_UNAVAILABLE_DETAIL);
    }
    try {
      return (await channel.confirm(info)) === true;
    } catch {
      // A broken surface is not a yes.
      return false;
    }
  }

  async start(input: {
    title?: string | undefined;
    consent: boolean;
    notice_acknowledged: boolean;
  }): Promise<NotetakerStartedView> {
    // Fail closed first: without a person-bound channel nothing below may run (no recogniser
    // probe, no buffer, no meeting record, no RECORDING event). The request flags are claims.
    if (!this.d.consent) {
      throw new PhoenixError(ErrorCode.CONSENT_CHANNEL_UNAVAILABLE, CONSENT_UNAVAILABLE_DETAIL);
    }
    try {
      const started = await this.sessions.start(input);
      return { ...started, stream_path: `/api/notetaker/stream?session=${started.id}` };
    } catch (err) {
      throw asPhoenixError(err);
    }
  }

  async stop(id: string): Promise<{ meeting_id: string }> {
    const meetingId = `${NOTETAKER_CAPABILITY_ID}:${id}`;
    try {
      await this.sessions.stop(id);
    } catch (err) {
      throw asPhoenixError(err);
    }
    try {
      await this.summarise(meetingId, id);
    } catch (err) {
      // The transcript is already stored; a failure here must not lose the call.
      this.d.logger.warn("notetaker: summary step failed", {
        error: err instanceof Error ? err.name : "error",
      });
    }
    return { meeting_id: meetingId };
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

  openStream(id: string, onEnded: (reason: string) => void): NotetakerStreamHandle {
    try {
      return this.sessions.openStream(id, onEnded);
    } catch (err) {
      throw asPhoenixError(err);
    }
  }
}
