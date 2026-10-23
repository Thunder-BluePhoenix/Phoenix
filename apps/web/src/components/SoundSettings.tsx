// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { SOUND_EVENTS, type SoundEvent, type SoundOutcome } from "@phoenix/pet-runtime";
import { useState } from "react";
import { formatNumber } from "../core/format";
import { useSoundHost, useSoundPrefs } from "../core/sounds";
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const EVENT_NAME: Record<SoundEvent, MessageKey> = {
  launch: "sounds.event.launch",
  poke: "sounds.event.poke",
  dizzy: "sounds.event.dizzy",
  recover: "sounds.event.recover",
  completion: "sounds.event.completion",
  "needs-you": "sounds.event.needsYou",
  failure: "sounds.event.failure",
};

/** Why a preview stayed silent; a sound that played needs no message. */
const SILENT_REASON: Partial<Record<SoundOutcome, MessageKey>> = {
  muted: "sounds.preview.muted",
  "silent-volume": "sounds.preview.silentVolume",
  quiet: "sounds.preview.quiet",
  "no-gesture": "sounds.preview.noGesture",
  failed: "sounds.preview.failed",
};

/**
 * Settings: Fawkes' sounds (Phase 59). Off by default; the switch and volume are kept in Core. A
 * preview plays one sound at the volume shown even while sounds are off (that is how a person hears
 * what they would be turning on), and stays silent under the same quiet rules as the real sounds.
 */
export function SoundSettingsSection() {
  const t = useT();
  const host = useSoundHost();
  const { prefs, failed } = useSoundPrefs(host);
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [silent, setSilent] = useState<string | null>(null);

  const save = async (change: { enabled?: boolean; volume?: number }) => {
    setError(null);
    if (!(await host.save(change))) setError(t("sounds.saveFailed"));
  };
  const commitVolume = () => {
    if (draft === null) return;
    const volume = draft;
    setDraft(null);
    if (volume !== prefs?.volume) void save({ volume });
  };
  const volume = draft ?? prefs?.volume ?? 0;
  const preview = async (event: SoundEvent) => {
    setSilent(null);
    const outcome = await host.preview(event, volume);
    const reason = SILENT_REASON[outcome];
    if (reason) setSilent(t(reason));
  };

  return (
    <section className="card" aria-labelledby="sounds-h">
      <h2 id="sounds-h" className="h3">
        {t("sounds.title")}
      </h2>
      <p className="muted small">{t("sounds.intro")}</p>
      {failed ? (
        <p className="error-text small" role="alert">
          {t("sounds.loadFailed")}
        </p>
      ) : (
        <>
          <label className="choice">
            <input
              type="checkbox"
              checked={prefs?.enabled === true}
              disabled={prefs === null}
              onChange={(event) => void save({ enabled: event.target.checked })}
            />
            {t("sounds.enabled")}
          </label>
          <label className="field">
            {t("sounds.volume")}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volume}
              disabled={prefs === null}
              aria-valuetext={t("sounds.volumeValue", { percent: formatNumber(volume) })}
              onChange={(event) => setDraft(Number(event.target.value))}
              onPointerUp={commitVolume}
              onKeyUp={commitVolume}
              onBlur={commitVolume}
            />
          </label>
          <fieldset>
            <legend className="small">{t("sounds.preview.legend")}</legend>
            {SOUND_EVENTS.map((event) => (
              <button
                key={event}
                type="button"
                className="btn"
                disabled={prefs === null}
                onClick={() => void preview(event)}
              >
                {t("sounds.preview.play", { name: t(EVENT_NAME[event]) })}
              </button>
            ))}
          </fieldset>
          <p className="muted small">{t("sounds.preview.hint")}</p>
          <Feedback error={error} saved={silent} />
        </>
      )}
      <p className="muted small">{t("sounds.note")}</p>
    </section>
  );
}
