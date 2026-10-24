// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The « OK Fawkes » voice assistant (Phase 66), Core side. The rules live in `@phoenix/ai-multimodal`
// (voice/); this file connects them to Core: the on/off setting in the settings store, the kill
// switch, the audit log, the tool gateway and the `voice.listening` / `voice.idle` events.
//
// Three decisions are made here, and each is visible in this file:
//   * VOICE MAY DENY, NEVER APPROVE. The voice code is handed `VoiceApprovals` (list pending, deny)
//     and nothing else of the permission gateway; the only thing it can do to a confirmation is
//     `resolveConfirmation(id, false, "voice")`.
//   * Tool calls go through `ToolGateway.call` as an actor that does NOT claim `trustedByUser`, so
//     the policy engine asks a person for anything above low risk. The call is built here from a
//     tool name chosen in the registry, with empty input; the spoken text is never part of it, except
//     the query of the confirmed web search (`web-search.search_confirmed`, an `external` command):
//     the capability manager asks a person to approve that exact query, and voice can only deny.
//   * Fawkes shows LISTENING only during the awake window (after "OK Fawkes"). While it is waiting
//     for the wake phrase nothing is shown by a state rule; the page shows its own indicator and
//     `GET /api/voice/status` reports the session, so the two are distinguishable.
import type {
  VoiceApi,
  VoiceSettingsView,
  VoiceStartedView,
  VoiceStatusView,
  VoiceStreamHandle,
  VoiceStreamMessageView,
} from "@phoenix/api";
import type { ToolGateway } from "@phoenix/ai-tool-gateway";
import {
  VOICE_LIMITS,
  type VoiceLimits,
  VoiceError,
  VoiceSessions,
  patchVoiceSettings,
  readVoiceSettings,
  type SpeechRecognizer,
  type Timers,
  type UtteranceConfig,
  type VoiceActions,
  type VoiceApprovals,
  type VoiceSettings,
  type VoiceTool,
} from "@phoenix/ai-multimodal";
import type { Logger } from "@phoenix/logging";
import type { EventBus } from "@phoenix/event-bus";
import type { PermissionGateway } from "@phoenix/permissions";
import type { SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError, createEvent } from "@phoenix/protocol";
import type { MappingRule, StateEngine } from "@phoenix/state-engine";

export const VOICE_SETTINGS_KEY = "voice.settings";

/** The actor of every voice tool call: an untrusted origin, never "directly asked for by the user". */
export const VOICE_ACTOR = { kind: "agent", id: "voice", trustedByUser: false } as const;

/**
 * How Fawkes shows the awake window. No timeout on purpose: the session manager always publishes
 * `voice.idle` (the window closes on a timer, a request, stop, kill switch or shutdown).
 */
export const VOICE_STATE_RULES: readonly MappingRule[] = [
  {
    match: "voice.listening",
    effect: { state: "LISTENING", explain: "Voice: Fawkes heard its name and is listening" },
  },
  { match: "voice.idle", effect: { clear: true } },
];

export interface VoiceRuntimeDeps {
  settings: SettingsStore;
  bus: EventBus;
  state: StateEngine;
  permissions: PermissionGateway;
  gateway: ToolGateway;
  /** Absent = no on-device recogniser: the Core reports `unavailable` and refuses to start. */
  recognizer: SpeechRecognizer | null;
  logger: Logger;
  now?: () => number;
  timers?: Timers;
  utterance?: UtteranceConfig;
  limits?: Partial<VoiceLimits>;
}

const UNAVAILABLE: SpeechRecognizer = {
  availability: () =>
    Promise.resolve({
      available: false,
      detail:
        "No on-device speech recogniser that keeps audio off the disk is configured. Set a local Whisper model to enable one.",
    }),
  start() {
    throw new VoiceError("unavailable", "No speech recogniser is configured");
  },
};

const CODE_BY_KIND: Record<VoiceError["kind"], ErrorCode> = {
  disabled: ErrorCode.CAPABILITY_DISABLED,
  busy: ErrorCode.INVALID_REQUEST,
  not_found: ErrorCode.RESOURCE_NOT_FOUND,
  limit: ErrorCode.INVALID_REQUEST,
  invalid: ErrorCode.INVALID_REQUEST,
  unavailable: ErrorCode.CAPABILITY_UNAVAILABLE,
  aborted: ErrorCode.INVALID_REQUEST,
};

/** Voice refusals become PhoenixErrors with a safe message; anything else is not leaked. */
function asPhoenixError(err: unknown): PhoenixError {
  if (err instanceof PhoenixError) return err;
  if (err instanceof VoiceError) return new PhoenixError(CODE_BY_KIND[err.kind], err.message);
  return new PhoenixError(ErrorCode.INTERNAL_ERROR, "Voice failed");
}

/** The narrowed permission view: voice can list and DENY, and there is no way to approve. */
export function voiceApprovals(permissions: PermissionGateway): VoiceApprovals {
  return {
    pending: () => permissions.pendingConfirmations().map((c) => ({ id: c.id })),
    deny: (id) => void permissions.resolveConfirmation(id, false, "voice"),
  };
}

/** The narrowed tool view: the enabled tools, and one call with empty input as the voice actor. */
export function voiceActions(gateway: ToolGateway): VoiceActions {
  return {
    tools: (): VoiceTool[] =>
      gateway.tools().map((t) => ({
        name: t.name,
        sideEffect: t.sideEffect,
        inputSchema: t.inputSchema,
      })),
    call: async (tool, signal, input) => {
      const result = await gateway.call(
        {
          actor: VOICE_ACTOR,
          tool,
          input: input ?? {},
          environment: "local",
          dataClass: "internal",
        },
        { signal },
      );
      return { output: result.output };
    },
  };
}

export class VoiceRuntime implements VoiceApi {
  private readonly sessions: VoiceSessions;
  private readonly recognizer: SpeechRecognizer;
  private readonly rules: readonly MappingRule[];
  private readonly offKill: () => void;

  constructor(private readonly d: VoiceRuntimeDeps) {
    this.recognizer = d.recognizer ?? UNAVAILABLE;
    this.rules = VOICE_STATE_RULES;
    d.state.addRules(this.rules);
    this.sessions = new VoiceSessions({
      recognizer: this.recognizer,
      settings: () => this.load(),
      killSwitchEngaged: () => d.permissions.isKillSwitchEngaged(),
      actions: voiceActions(d.gateway),
      approvals: voiceApprovals(d.permissions),
      onAwake: (awake, id) => this.publishAwake(awake, id),
      audit: (action, details) =>
        void d.permissions.audit.record({ actor: "voice", action, decision: "info", details }),
      ...(d.timers ? { timers: d.timers } : {}),
      ...(d.now ? { now: d.now } : {}),
      ...(d.utterance ? { utterance: d.utterance } : {}),
      ...(d.limits ? { limits: d.limits } : {}),
    });
    // The emergency stop ends the session at once, not at the next audio frame.
    this.offKill = d.bus.subscribe("voice", "security.kill_switch.engaged", () =>
      this.sessions.abortAll("kill_switch"),
    );
  }

  /** Ends any session (shutdown): audio zeroed, `voice.idle` published, rules removed. */
  close(): void {
    this.sessions.abortAll("shutdown");
    this.offKill();
    this.d.state.removeRules(this.rules);
  }

  private publishAwake(awake: boolean, session: string): void {
    const result = this.d.bus.publish(
      createEvent({
        event_type: awake ? "voice.listening" : "voice.idle",
        source: "core",
        severity: "info",
        correlation_id: `voice-${session}`,
        // No text: the id of the session only.
        payload: { session },
      }),
      { ephemeral: true },
    );
    if (!result.ok) this.d.logger.warn("voice event rejected", { code: result.error.code });
  }

  private load(): VoiceSettings {
    return readVoiceSettings(this.d.settings.get<unknown>(VOICE_SETTINGS_KEY, null));
  }

  settings(): VoiceSettingsView {
    return this.load();
  }

  setSettings(patch: unknown): VoiceSettingsView {
    let next: VoiceSettings;
    try {
      next = patchVoiceSettings(this.load(), patch);
    } catch (err) {
      throw asPhoenixError(err);
    }
    this.d.settings.set(VOICE_SETTINGS_KEY, next);
    if (!next.enabled) this.sessions.abortAll("disabled");
    void this.d.permissions.audit.record({
      actor: "user",
      action: "voice.settings",
      decision: "info",
      details: { enabled: next.enabled },
    });
    return next;
  }

  async status(): Promise<VoiceStatusView> {
    const killSwitchEngaged = this.d.permissions.isKillSwitchEngaged();
    const recognizer = killSwitchEngaged
      ? { available: false, detail: "Emergency stop engaged" }
      : await this.recognizer.availability();
    return {
      enabled: this.load().enabled,
      kill_switch_engaged: killSwitchEngaged,
      recognizer,
      audio_on_disk: false,
      active: this.sessions.active(),
      limits: {
        max_frame_bytes: this.d.limits?.maxFrameBytes ?? VOICE_LIMITS.maxFrameBytes,
        awake_window_ms: this.d.limits?.awakeWindowMs ?? VOICE_LIMITS.awakeWindowMs,
      },
    };
  }

  async start(): Promise<VoiceStartedView> {
    try {
      return await this.sessions.start();
    } catch (err) {
      throw asPhoenixError(err);
    }
  }

  stop(id: string): void {
    this.sessions.stop(id);
  }

  streamAvailable(id: string): boolean {
    return this.sessions.streamAvailable(id);
  }

  openStream(
    id: string,
    send: (message: VoiceStreamMessageView) => void,
    onEnded: (reason: string) => void,
  ): VoiceStreamHandle {
    try {
      return this.sessions.openStream(id, send, onEnded);
    } catch (err) {
      throw asPhoenixError(err);
    }
  }
}
