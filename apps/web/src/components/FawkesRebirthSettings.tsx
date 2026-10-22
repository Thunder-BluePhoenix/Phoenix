// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useAction } from "../core/hooks";
import { announceRebirthSettings, REBIRTH_PATH, useRebirthSettings } from "../core/rebirth";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

/** The two Phase 91 switches. Both are off by default; the rebirth itself has no switch. */
export function FawkesRebirthSettingsSection() {
  const t = useT();
  const { data, error: loadError, reload } = useRebirthSettings();
  const { run, busy, error } = useAction();
  const change = async (key: "milestones" | "highContrast", value: boolean) => {
    if (await run("PUT", REBIRTH_PATH, { [key]: value })) {
      announceRebirthSettings();
      await reload();
    }
  };
  return (
    <section className="card" aria-labelledby="fawkes-rebirth-h">
      <h2 id="fawkes-rebirth-h">{t("fawkesRebirth.settings.title")}</h2>
      <p>{t("fawkesRebirth.settings.intro")}</p>
      {loadError ? (
        <p className="error-text small" role="alert">
          {t("fawkesRebirth.settings.loadFailed")}
        </p>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked={data.milestones}
              disabled={busy}
              onChange={(event) => void change("milestones", event.target.checked)}
            />{" "}
            {t("fawkesRebirth.settings.milestones")}
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              checked={data.highContrast}
              disabled={busy}
              onChange={(event) => void change("highContrast", event.target.checked)}
            />{" "}
            {t("fawkesRebirth.settings.contrast")}
          </label>
        </>
      )}
      <Feedback error={error} />
    </section>
  );
}
