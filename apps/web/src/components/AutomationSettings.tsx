// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatNumber } from "../core/format";
import { useAction, useAgentSettings } from "../core/hooks";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

/** Settings: whether Fawkes may run agent tasks at all (`agents.enabled`, off by default). */
export function AutomationSettings() {
  const t = useT();
  const { data, error, reload } = useAgentSettings();
  const { run, busy, error: saveError } = useAction();
  const toggle = async (enabled: boolean) => {
    await run("POST", "/api/agent/settings", { enabled });
    await reload();
  };
  return (
    <section aria-labelledby="automation-h" className="card">
      <h2 id="automation-h" className="h3">
        {t("automation.settings.title")}
      </h2>
      <p className="small">{t("automation.settings.intro")}</p>
      {data ? (
        <>
          <label className="choice">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            {t("automation.settings.allow")}
          </label>
          <p className="muted small" role="status">
            {t(data.enabled ? "automation.settings.statusOn" : "automation.settings.statusOff", {
              active: data.active_runs,
              max: formatNumber(data.limits.max_active_runs),
            })}
          </p>
        </>
      ) : (
        error && <p className="muted small">{t("automation.settings.unavailable", { error })}</p>
      )}
      <Feedback error={saveError} />
    </section>
  );
}
