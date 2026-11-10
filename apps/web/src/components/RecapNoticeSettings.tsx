// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState } from "react";
import { useClient } from "../core/context";
import { useT } from "../i18n";
import type { RecapNoticeStatus } from "../core/types";

/** The opt-in Monday recap notice: its own switch, separate from the Kage proactive one. */
export function RecapNoticeSettingsSection() {
  const t = useT();
  const client = useClient();
  const [status, setStatus] = useState<RecapNoticeStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    client.request<RecapNoticeStatus>("GET", "/api/recap/notice").then(
      (result) => active && setStatus(result),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [client]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      setStatus(await client.request<RecapNoticeStatus>("POST", "/api/recap/notice", { enabled }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="recap-notice-h" className="card">
      <h2 id="recap-notice-h" className="h3">
        {t("recapNotice.title")}
      </h2>
      <p className="muted small">{t("recapNotice.intro")}</p>
      {status && (
        <>
          <label className="choice">
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busy}
              onChange={(event) => void toggle(event.target.checked)}
            />
            {t("recapNotice.enable")}
          </label>
          <p className="muted small">{t("recapNotice.midweek")}</p>
          <p className="muted small" role="status">
            {status.last_week
              ? t("recapNotice.last", { week: status.last_week })
              : t("recapNotice.never")}
          </p>
        </>
      )}
      {failed && <p role="alert">{t("recapNotice.error")}</p>}
    </section>
  );
}
