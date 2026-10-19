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
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

/** Test seams: a fake microphone and fake speech synthesis. Production uses the browser's own. */
export interface VoiceSeams {
  createMicrophone?: () => DictationMicrophone;
  speech?: SpeechDeps;
}

const PHASE_TEXT: Record<AssistantPhase, MessageKey> = {
  idle: "capture.voice.phase.idle",
  starting: "capture.voice.phase.starting",
  waiting: "capture.voice.phase.waiting",
  awake: "capture.voice.phase.awake",
  thinking: "capture.voice.phase.thinking",
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
  const t = useT();
  const client = useClient();
  const assistant = assistantFor(client, createMicrophone, speech);
  const local = useSyncExternalStore(assistant.subscribe, assistant.getState);
  if (local.phase === "idle" && !local.error && !local.reply) return null;
  const listening = local.phase !== "idle";
  const draft = local.reply?.action?.type === "mailto" ? local.reply.action.url : null;
  return (
    <section className="voice-banner" aria-label={t("capture.voice.banner.label")}>
      {listening && (
        <p className="voice-live" role="status">
          <span className="voice-dot" aria-hidden="true" />{" "}
          {t("capture.voice.banner.live", { phase: t(PHASE_TEXT[local.phase]) })}{" "}
          <button type="button" className="link-button" onClick={() => void assistant.stop()}>
            {t("capture.voice.banner.stop")}
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
          <strong>{t("capture.voice.banner.fawkes")}</strong> {local.reply.text}
          {draft && isMailtoDraft(draft) && (
            <>
              {" "}
              <a href={draft}>{t("capture.voice.banner.openDraft")}</a>
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
  const t = useT();
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
          {t("capture.voice.settings.titleShort")}
        </h2>
        <p className="muted small">{t("capture.voice.settings.unavailable")}</p>
      </section>
    );

  const listening = local.phase !== "idle";
  const toggle = async (enabled: boolean) => {
    setSaved(null);
    if (!enabled) await assistant.stop();
    const next = await run<VoiceSettings>("POST", "/api/voice/settings", { enabled });
    if (!next) return;
    setSaved(enabled ? t("capture.voice.settings.savedOn") : t("capture.voice.settings.savedOff"));
    await refresh();
    // The click that turned it on is the user's gesture for the microphone prompt.
    if (enabled) await assistant.start();
  };
  const blocked = voiceBlocked(status, connection === "online");

  return (
    <section className="card voice-settings" aria-labelledby="voice-h">
      <h2 id="voice-h" className="h3">
        {t("capture.voice.settings.title")}
      </h2>
      <p className="small">
        {t.rich("capture.voice.settings.intro", {
          off: <strong>{t("capture.voice.settings.introOff")}</strong>,
        })}
      </p>
      <ul className="small">
        <li>
          <strong>{t("capture.voice.settings.whileOn.lead")}</strong>{" "}
          {t("capture.voice.settings.whileOn.body")}
        </li>
        <li>
          <strong>{t("capture.voice.settings.leaves.lead")}</strong>{" "}
          {t("capture.voice.settings.leaves.body")}
        </li>
        <li>
          <strong>{t("capture.voice.settings.kept.lead")}</strong>{" "}
          {t("capture.voice.settings.kept.body")}
        </li>
        <li>
          <strong>{t("capture.voice.settings.canDo.lead")}</strong>{" "}
          {t("capture.voice.settings.canDo.body")}
        </li>
        <li>
          <strong>{t("capture.voice.settings.limits.lead")}</strong>{" "}
          {t("capture.voice.settings.limits.body")}
        </li>
      </ul>
      <label className="choice">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        {t("capture.voice.settings.toggle")}
      </label>
      <p className="small" role="status">
        {t(
          status.recognizer.available
            ? "capture.audio.recognizerAvailable"
            : "capture.audio.recognizerUnavailable",
          { detail: status.recognizer.detail },
        )}
      </p>
      {status.kill_switch_engaged && <p role="status">{t("capture.voice.settings.killSwitch")}</p>}
      {status.enabled && !listening && !blocked && (
        <p className="small">
          {t("capture.voice.settings.notListening")}{" "}
          <button type="button" onClick={() => void assistant.start()}>
            {t("capture.voice.settings.start")}
          </button>
        </p>
      )}
      {status.enabled && !listening && blocked && <p className="small">{blocked}</p>}
      <Feedback error={error} saved={saved} />
    </section>
  );
}
