// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { VoiceBanner, type VoiceSeams } from "../components/Voice";
import { useClient, useConnection } from "../core/context";
import { createBrowserMicrophone } from "../core/dictation-mic";
import { voiceBlocked, type VoiceStatus } from "../core/voice";
import { assistantFor, browserSpeech } from "../core/voice-assistant";
import { useT } from "../i18n";
import { claimListening, insideDesktopShell, type TitleTarget } from "./shell";

export interface VoiceWindowProps extends VoiceSeams {
  /** Test seam: where the "active / idle" claim for the desktop shell is written. */
  titleTarget?: TitleTarget;
  /** Test seam: whether this page runs inside the desktop shell's webview. */
  inShell?: boolean;
}

/**
 * The desktop shell's voice window (`/voice.html`). It runs the SAME assistant as Settings > Voice;
 * consent stays there (it switches voice on in Core). This page only starts and stops listening, and
 * keeps the shell's claim in step: "active" BEFORE the microphone is requested, "idle" once it is
 * released. The shell shows its own LISTENING indicator and has its own stop; this page can invoke
 * no shell command at all.
 */
export function VoiceWindowApp({
  createMicrophone = createBrowserMicrophone,
  speech = browserSpeech,
  titleTarget,
  inShell = insideDesktopShell(),
}: VoiceWindowProps) {
  const t = useT();
  const client = useClient();
  const connection = useConnection();
  const assistant = assistantFor(client, createMicrophone, speech);
  const local = useSyncExternalStore(assistant.subscribe, assistant.getState);
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
  }, [refresh, local.phase]);

  const listening = local.phase !== "idle";
  useEffect(() => {
    claimListening(listening, titleTarget);
  }, [listening, titleTarget]);

  const blocked = voiceBlocked(status, connection === "online");
  return (
    <main className="voice-window">
      <h1 className="h3">{t("capture.voice.window.title")}</h1>
      <p className="small">{t("capture.voice.window.intro")}</p>
      {inShell && <p className="small">{t("capture.voice.window.shell")}</p>}
      <p className="voice-state" role="status">
        {listening ? t("capture.voice.window.listening") : t("capture.voice.window.off")}
      </p>
      <VoiceBanner createMicrophone={createMicrophone} speech={speech} />
      {!listening && !blocked && (
        <button type="button" onClick={() => void assistant.start()}>
          {t("capture.voice.settings.start")}
        </button>
      )}
      {!listening && blocked && <p className="small">{blocked}</p>}
    </main>
  );
}
