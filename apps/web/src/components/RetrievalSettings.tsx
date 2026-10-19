// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState } from "react";
import { formatAgo, formatNumber } from "../core/format";
import { useAction, useRetrievalSettings, useRetrievalStatus } from "../core/hooks";
import type { RetrievalSettings as Settings, RetrievalStatus } from "../core/types";
import { useT, type MessageKey, type Translate } from "../i18n";
import { Feedback } from "./Feedback";

const INACTIVE_KEY: Record<string, MessageKey> = {
  retrieval_disabled: "memory.retrieval.inactive.retrieval_disabled",
  ai_disabled: "memory.retrieval.inactive.ai_disabled",
  kill_switch: "memory.retrieval.inactive.kill_switch",
};

const MB = 1024 * 1024;

/** The size of the index in KB (at least 1) or MB (one decimal), in the digits of the language. */
function bytes(n: number, t: Translate): string {
  if (n < MB)
    return t("memory.retrieval.kb", { n: formatNumber(Math.max(1, Math.round(n / 1024))) });
  const mb = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  return t("memory.retrieval.mb", { n: formatNumber(n / MB, undefined, mb) });
}

function StatusLines({ status }: { status: RetrievalStatus }) {
  const t = useT();
  const inactive = INACTIVE_KEY[status.inactive_reason ?? ""];
  const run = status.last_run;
  return (
    <dl className="approval-facts small" aria-label={t("memory.retrieval.statusLabel")}>
      <dt>{t("memory.retrieval.state")}</dt>
      <dd>
        {status.active
          ? t("memory.retrieval.working")
          : t(inactive ?? "memory.retrieval.inactive.other")}
      </dd>
      <dt>{t("memory.retrieval.indexSize")}</dt>
      <dd>
        {t("memory.retrieval.indexLine", {
          embedded: formatNumber(status.embedded),
          total: status.total,
          unembedded: formatNumber(status.unembedded),
          failures: formatNumber(status.failures),
          size: bytes(status.payload_bytes, t),
        })}
      </dd>
      <dt>{t("memory.retrieval.model")}</dt>
      <dd className="memory-text">
        {t("memory.retrieval.modelLine", { provider: status.provider, model: status.model })}
      </dd>
      <dt>{t("memory.retrieval.lastBuild")}</dt>
      <dd>
        {run
          ? t(run.capped ? "memory.retrieval.lastRunCapped" : "memory.retrieval.lastRun", {
              ago: formatAgo(run.at),
              embedded: formatNumber(run.embedded),
              failed: formatNumber(run.failed),
              remaining: formatNumber(run.remaining),
            })
          : t("memory.retrieval.neverBuilt")}
      </dd>
      <dt>{t("memory.retrieval.fallback")}</dt>
      <dd>
        {run && run.degraded.length > 0
          ? t("memory.retrieval.degraded", { reasons: run.degraded.join("; ") })
          : t("memory.retrieval.noFallback")}
      </dd>
      {status.other_models.length > 0 && (
        <>
          <dt>{t("memory.retrieval.oldVectors")}</dt>
          <dd className="memory-text">
            {t("memory.retrieval.oldVectorsLine", {
              models: status.other_models
                .map((m) => `${m.model} (${formatNumber(m.vectors)})`)
                .join(", "),
            })}
          </dd>
        </>
      )}
    </dl>
  );
}

function RetrievalForm({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) {
  const t = useT();
  const { data: status, error: statusError, reload: reloadStatus } = useRetrievalStatus();
  const { run, busy, error } = useAction();
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const refresh = async () => {
    setConfirmRebuild(false);
    await reload();
    await reloadStatus();
  };

  const toggle = async () => {
    setSaved(null);
    setConfirmRebuild(false);
    const on = !settings.enabled;
    const res = await run<Settings>("POST", "/api/retrieval/settings", { enabled: on });
    if (res) {
      setSaved(t(on ? "memory.retrieval.savedOn" : "memory.retrieval.savedOff"));
    }
    await refresh();
  };

  const rebuild = async () => {
    if (!status?.active || !confirmRebuild || busy) return;
    setSaved(null);
    setConfirmRebuild(false);
    const result = await run<RetrievalStatus>("POST", "/api/retrieval/rebuild", { confirm: true });
    if (result) {
      const report = result.last_run;
      setSaved(
        report
          ? t("memory.retrieval.rebuilt", {
              embedded: formatNumber(report.embedded),
              failed: formatNumber(report.failed),
              remaining: formatNumber(report.remaining),
              capped: report.capped ? 1 : 0,
              degraded: report.degraded.length > 0 ? 1 : 0,
              reasons: report.degraded.join("; "),
            })
          : t("memory.retrieval.rebuiltNoReport"),
      );
      await reloadStatus();
    }
  };

  return (
    <>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={() => void toggle()}
        />
        {t("memory.retrieval.toggle")}
      </label>
      <p className="muted small">
        {t.rich("memory.retrieval.toggleNote", {
          model: <code>{settings.model}</code>,
          provider: <strong>{settings.provider}</strong>,
        })}
      </p>
      {status && <StatusLines status={status} />}
      {statusError && !status && <Feedback error={statusError} />}
      <div className="button-row wrap">
        {!confirmRebuild ? (
          <button
            type="button"
            className="btn"
            disabled={busy || !status?.active}
            aria-describedby="retrieval-rebuild-note"
            onClick={() => setConfirmRebuild(true)}
          >
            {t("memory.retrieval.rebuild")}
          </button>
        ) : (
          <div
            className="button-row wrap"
            role="group"
            aria-label={t("memory.retrieval.confirmGroup")}
          >
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !status?.active}
              aria-describedby="retrieval-rebuild-note"
              onClick={() => void rebuild()}
            >
              {t("memory.retrieval.confirmRebuild")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirmRebuild(false)}
            >
              {t("common.button.cancel")}
            </button>
          </div>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
          {t("memory.retrieval.refresh")}
        </button>
      </div>
      <p id="retrieval-rebuild-note" className="muted small">
        {status?.active
          ? t("memory.retrieval.rebuildNote")
          : t("memory.retrieval.rebuildNoteInactive")}
      </p>
      <Feedback error={error} saved={saved} />
    </>
  );
}

/** Retrieval settings and status (Phase 37), on the Settings page. */
export function RetrievalSettingsSection() {
  const t = useT();
  const { data, error, reload } = useRetrievalSettings();
  return (
    <section aria-labelledby="retrieval-h" className="card">
      <h2 id="retrieval-h" className="h3">
        {t("memory.retrieval.title")}
      </h2>
      {data ? (
        <RetrievalForm settings={data} reload={reload} />
      ) : (
        <Feedback error={error ?? null} />
      )}
    </section>
  );
}
