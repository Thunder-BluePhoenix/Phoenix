// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useClient, useConnection } from "../core/context";
import { createBrowserMicrophone, type DictationMicrophone } from "../core/dictation-mic";
import { useAction } from "../core/hooks";
import {
  assistantFor,
  browserSpeech,
  type AssistantPhase,
  type SpeechDeps,
} from "../core/voice-assistant";
import { isMailtoDraft, voiceBlocked, type VoiceSettings, type VoiceStatus } from "../core/voice";
import { Feedback } from "./Feedback";

/** Test seams: a fake microphone and fake speech synthesis. Production uses the browser's own. */
export interface VoiceSeams {
  createMicrophone?: () => DictationMicrophone;
  speech?: SpeechDeps;
}

const PHASE_TEXT: Record<AssistantPhase, string> = {
  idle: "Voice is off",
  starting: "Starting the microphone…",
  waiting: "Listening for “OK Fawkes”",
  awake: "Fawkes is listening to your request",
  thinking: "Working on your request…",
};

function useVoiceStatus(refreshKey: unknown) {
  const client = useClient();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await client.request<VoiceStatus>("GET", "/api/voice/status"));
    } catch {
      setStatus(null);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);
  return { status, refresh };
}

/**
 * The indicator that is on screen for as long as the microphone is open for voice: it says what
 * Fawkes is waiting for, shows the last answer as text (it is also spoken, when the browser can),
 * and has a Stop button. Rendered nowhere while voice is off.
 */
export function VoiceBanner({
  createMicrophone = createBrowserMicrophone,
  speech = browserSpeech,
}: VoiceSeams) {
  const client = useClient();
  const assistant = assistantFor(client, createMicrophone, speech);
  const local = useSyncExternalStore(assistant.subscribe, assistant.getState);
  if (local.phase === "idle" && !local.error && !local.reply) return null;
  const listening = local.phase !== "idle";
  const draft = local.reply?.action?.type === "mailto" ? local.reply.action.url : null;
  return (
    <section className="voice-banner" aria-label="Voice assistant">
      {listening && (
        <p className="voice-live" role="status">
          <span className="voice-dot" aria-hidden="true" /> Microphone on. {PHASE_TEXT[local.phase]}
          .{" "}
          <button type="button" className="link-button" onClick={() => void assistant.stop()}>
            Stop listening
          </button>
        </p>
      )}
      {local.error && (
        <p className="error-text small" role="alert">
          {local.error}
        </p>
      )}
      {local.reply && (
        <p className="small" role="status">
          <strong>Fawkes:</strong> {local.reply.text}
          {draft && isMailtoDraft(draft) && (
            <>
              {" "}
              <a href={draft}>Open the email draft</a>
            </>
          )}
        </p>
      )}
    </section>
  );
}

/** Settings > Voice: consent, what happens to audio, and the switch. Off by default. */
export function VoiceSettingsSection({
  createMicrophone = createBrowserMicrophone,
  speech = browserSpeech,
}: VoiceSeams) {
  const client = useClient();
  const connection = useConnection();
  const assistant = assistantFor(client, createMicrophone, speech);
  const local = useSyncExternalStore(assistant.subscribe, assistant.getState);
  const { status, refresh } = useVoiceStatus(local.phase);
  const { run, busy, error } = useAction();
  const [saved, setSaved] = useState<string | null>(null);

  if (!status)
    return (
      <section className="card" aria-labelledby="voice-h">
        <h2 id="voice-h" className="h3">
          Voice
        </h2>
        <p className="muted small">Voice settings are unavailable from Phoenix Core.</p>
      </section>
    );

  const listening = local.phase !== "idle";
  const toggle = async (enabled: boolean) => {
    setSaved(null);
    if (!enabled) await assistant.stop();
    const next = await run<VoiceSettings>("POST", "/api/voice/settings", { enabled });
    if (!next) return;
    setSaved(enabled ? "Voice is on." : "Voice is off. The microphone was released.");
    await refresh();
    // The click that turned it on is the user's gesture for the microphone prompt.
    if (enabled) await assistant.start();
  };
  const blocked = voiceBlocked(status, connection === "online");

  return (
    <section className="card voice-settings" aria-labelledby="voice-h">
      <h2 id="voice-h" className="h3">
        Voice (“OK Fawkes”)
      </h2>
      <p className="small">
        Say “OK Fawkes” and ask about your services. It is <strong>off</strong> until you turn it on
        here, and turning it on is your consent for voice only.
      </p>
      <ul className="small">
        <li>
          <strong>While it is on:</strong> this page keeps your microphone open and shows
          “Microphone on” the whole time. A simple loudness check runs on this device for every
          moment of sound; only when someone speaks is a short clip given to the speech recogniser
          on this device.
        </li>
        <li>
          <strong>What leaves this device:</strong> nothing. Recognition is local; there is no cloud
          speech path. Phoenix produces no audio: answers are spoken by your browser, when it can.
        </li>
        <li>
          <strong>What is kept:</strong> audio stays in memory for seconds and is erased when it has
          been understood, when you stop, or when the emergency stop is used. It is never written to
          disk and no transcript is stored. The audit log records that a request happened and which
          tool it used, never what you said.
        </li>
        <li>
          <strong>What it can do:</strong> read the status of services you have enabled, open the
          pill, and prepare an email draft for you to review. It cannot change anything, and it can
          never approve an action: only you can, in the Pet Panel. It can say “deny”.
        </li>
        <li>
          <strong>Limits:</strong> the wake phrase is found by transcribing short clips of speech
          (it is not a dedicated keyword detector), so it can miss it or mishear similar words.
        </li>
      </ul>
      <label className="choice">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Turn on “OK Fawkes”
      </label>
      <p className="small" role="status">
        Speech recogniser: {status.recognizer.available ? "available" : "unavailable"}.{" "}
        {status.recognizer.detail}
      </p>
      {status.kill_switch_engaged && (
        <p role="status">The emergency stop is engaged: voice is blocked.</p>
      )}
      {status.enabled && !listening && !blocked && (
        <p className="small">
          Voice is on but this page is not listening yet (after a reload the browser asks again).{" "}
          <button type="button" onClick={() => void assistant.start()}>
            Start listening
          </button>
        </p>
      )}
      {status.enabled && !listening && blocked && <p className="small">{blocked}</p>}
      <Feedback error={error} saved={saved} />
    </section>
  );
}
