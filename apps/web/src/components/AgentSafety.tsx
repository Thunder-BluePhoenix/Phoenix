// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useState } from "react";
import { useAction } from "../core/hooks";
import { formatAgo, formatDate } from "../core/format";
import {
  useSafetyStatus,
  type SafetyCheckpoint,
  type SafetyPreview,
  type SafetyRollbackResult,
  type SafetySettings,
} from "../core/safety";
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

type Skip =
  `safety.skipped.${"disabled" | "kill_switch" | "not_git" | "git_unavailable" | "too_many_files" | "too_large" | "throttled" | "snapshot_failed"}`;
type Why =
  `safety.preview.why.${"tracked_by_head" | "ignored" | "submodule" | "unsafe_path" | "not_a_file"}`;
type Change = `safety.preview.change.${"modified" | "deleted" | "type_changed"}`;
type Refusal =
  `safety.preview.refusal.${"repository_missing" | "checkpoint_gone" | "head_moved" | "snapshot_failed"}`;

/** What the preview of one checkpoint shows, and the button that asks for the owner's approval. */
function PreviewPanel({
  checkpoint,
  onClose,
  onDone,
}: {
  checkpoint: SafetyCheckpoint;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const ids = useId();
  const load = useAction();
  const roll = useAction();
  const [preview, setPreview] = useState<SafetyPreview | null>(null);
  const [result, setResult] = useState<SafetyRollbackResult | null>(null);

  const loadRun = load.run;
  const open = useCallback(async () => {
    const p = await loadRun<SafetyPreview>(
      "GET",
      `/api/agent-safety/checkpoints/${encodeURIComponent(checkpoint.id)}/preview`,
    );
    if (p) setPreview(p);
  }, [loadRun, checkpoint.id]);
  // Opening the panel previews right away: a rollback is only ever offered next to a fresh preview.
  useEffect(() => {
    void open();
  }, [open]);
  const rollBack = async () => {
    if (!preview?.preview_hash) return;
    const done = await roll.run<SafetyRollbackResult>(
      "POST",
      `/api/agent-safety/checkpoints/${encodeURIComponent(checkpoint.id)}/rollback`,
      { preview_hash: preview.preview_hash },
    );
    if (done) {
      setResult(done);
      setPreview(null);
      onDone();
    }
  };

  const nothing =
    preview !== null &&
    preview.refusal === null &&
    preview.counts.restore === 0 &&
    preview.counts.remove === 0;

  return (
    <div className="card safety-preview" aria-labelledby={`${ids}-h`} role="group">
      <h3 id={`${ids}-h`} className="h3">
        {t("safety.preview.title")}
      </h3>
      <Feedback error={load.error ?? roll.error} />
      {preview?.refusal && (
        <p className="error-text small" role="alert">
          {t(`safety.preview.refusal.${preview.refusal}` satisfies Refusal)}
        </p>
      )}
      {nothing && <p className="small">{t("safety.preview.nothing")}</p>}
      {preview && preview.refusal === null && !nothing && (
        <>
          <p className="small">
            {t("safety.preview.counts", {
              restore: preview.counts.restore,
              remove: preview.counts.remove,
              kept: preview.counts.kept,
            })}
          </p>
          {preview.restore.length > 0 && (
            <>
              <h4 className="small">{t("safety.preview.restore")}</h4>
              <ul className="safety-files">
                {preview.restore.map((f) => (
                  <li key={f.path}>
                    <code className="break">{f.path}</code> ·{" "}
                    {t(`safety.preview.change.${f.change}` satisfies Change)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.remove.length > 0 && (
            <>
              <h4 className="small">{t("safety.preview.remove")}</h4>
              <ul className="safety-files">
                {preview.remove.map((p) => (
                  <li key={p}>
                    <code className="break">{p}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.kept.length > 0 && (
            <>
              <h4 className="small">{t("safety.preview.kept")}</h4>
              <ul className="safety-files">
                {preview.kept.map((k) => (
                  <li key={k.path}>
                    <code className="break">{k.path}</code> ·{" "}
                    {t(`safety.preview.why.${k.why}` satisfies Why)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.lists_truncated && (
            <p className="muted small">{t("safety.preview.truncated")}</p>
          )}
          <h4 className="small">{t("safety.preview.diff")}</h4>
          {preview.diff === "" ? (
            <p className="muted small">{t("safety.preview.diffEmpty")}</p>
          ) : (
            <pre className="safety-diff" tabIndex={0}>
              {preview.diff}
            </pre>
          )}
          {preview.diff_truncated && (
            <p className="muted small">{t("safety.preview.diffTruncated")}</p>
          )}
          {preview.diff_redacted && (
            <p className="muted small">{t("safety.preview.diffRedacted")}</p>
          )}
          <p className="muted small">{t("safety.preview.approvalNote")}</p>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn"
              disabled={roll.busy}
              onClick={() => void rollBack()}
            >
              {t("safety.rollback.button")}
            </button>
          </div>
          {roll.busy && (
            <p className="small" role="status">
              {t("safety.rollback.waiting")}
            </p>
          )}
        </>
      )}
      {result && (
        <p className="small" role="status">
          {t("safety.rollback.done", { restored: result.restored, removed: result.removed })}{" "}
          {t(result.exact ? "safety.rollback.exact" : "safety.rollback.inexact")}
        </p>
      )}
      <div className="button-row">
        <button type="button" className="btn" onClick={onClose}>
          {t("safety.checkpoints.close")}
        </button>
      </div>
    </div>
  );
}

const NUMBER_FIELDS: readonly { key: keyof SafetySettings; label: MessageKey }[] = [
  { key: "retention_days", label: "safety.settings.retention" },
  { key: "max_files", label: "safety.settings.maxFiles" },
  { key: "loop_threshold", label: "safety.settings.loopThreshold" },
  { key: "waiting_min", label: "safety.settings.waitingMin" },
  { key: "idle_min", label: "safety.settings.idleMin" },
];

function SettingsForm({ settings, onSaved }: { settings: SafetySettings; onSaved: () => void }) {
  const t = useT();
  const ids = useId();
  const { run, busy, error } = useAction();
  const [saved, setSaved] = useState(false);
  const save = async (patch: Partial<SafetySettings>) => {
    setSaved(false);
    const next = await run("POST", "/api/agent-safety/settings", patch);
    if (next) {
      setSaved(true);
      onSaved();
    }
  };
  return (
    <div>
      <h3 className="h3">{t("safety.settings.title")}</h3>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(e) => void save({ enabled: e.target.checked })}
        />
        {t("safety.settings.enabled")}
      </label>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.notify}
          disabled={busy}
          onChange={(e) => void save({ notify: e.target.checked })}
        />
        {t("safety.settings.notify")}
      </label>
      {NUMBER_FIELDS.map(({ key, label }) => (
        <label key={key} className="field" htmlFor={`${ids}-${key}`}>
          {t(label)}
          <input
            id={`${ids}-${key}`}
            key={`${key}-${settings[key]}`}
            type="number"
            defaultValue={Number(settings[key])}
            disabled={busy}
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value !== settings[key]) void save({ [key]: value });
            }}
          />
        </label>
      ))}
      <p className="muted small">{t("safety.settings.detectNote")}</p>
      <Feedback error={error} saved={saved ? t("safety.settings.saved") : null} />
    </div>
  );
}

/**
 * Agent safety net (Phase 77): the checkpoints taken before coding agents' first edits, a rollback
 * preview with approval, loop and stall warnings, and the settings. Agent and file names are
 * untrusted text and are only ever rendered as text.
 */
export function AgentSafety() {
  const t = useT();
  const ids = useId();
  const { status, error, reload, warnings } = useSafetyStatus();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section aria-labelledby={`${ids}-h`} className="card agent-safety">
      <h2 id={`${ids}-h`} className="h3">
        {t("safety.title")}
      </h2>
      <p className="muted small">{t("safety.intro")}</p>
      <p className="muted small">{t("safety.timing")}</p>
      <p className="muted small">{t("safety.ignored")}</p>
      {error && !status && (
        <p className="error-text small" role="status">
          {t("safety.loadFailed", { error })}
        </p>
      )}
      {status && (
        <>
          {status.kill_switch && (
            <p className="safety-warning small" role="status">
              {t("safety.killSwitch")}
            </p>
          )}
          {warnings.length > 0 && (
            <div>
              <h3 className="h3">{t("safety.warnings.title")}</h3>
              <ul className="card-list" aria-live="polite">
                {warnings.map((w) => (
                  <li key={w.id} className="safety-warning small">
                    {t("safety.warnings.line", {
                      kind: t(w.type === "loop" ? "safety.warnings.loop" : "safety.warnings.stall"),
                      agent: w.agent,
                      repository: w.repository,
                      reason: w.reason,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3 className="h3">{t("safety.checkpoints.title")}</h3>
          {status.checkpoints.length === 0 ? (
            <p className="muted small">{t("safety.checkpoints.none")}</p>
          ) : (
            <ul className="card-list" aria-label={t("safety.checkpoints.title")}>
              {status.checkpoints.map((c) => (
                <li key={c.id} className="card">
                  <p>
                    <strong className="memory-text">
                      {t("safety.checkpoints.row", { agent: c.agent, repository: c.repository })}
                    </strong>
                  </p>
                  <p className="muted small">
                    {t("safety.checkpoints.facts", {
                      taken: formatAgo(c.created_at),
                      count: c.file_count,
                      expires: formatDate(c.expires_at),
                    })}
                  </p>
                  {c.rolled_back_at && (
                    <p className="small">
                      {t("safety.checkpoints.rolledBack", { when: formatAgo(c.rolled_back_at) })}
                    </p>
                  )}
                  {open === c.id ? (
                    <PreviewPanel
                      checkpoint={c}
                      onClose={() => setOpen(null)}
                      onDone={() => void reload()}
                    />
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      aria-label={t("safety.checkpoints.previewLabel", {
                        agent: c.agent,
                        repository: c.repository,
                      })}
                      onClick={() => setOpen(c.id)}
                    >
                      {t("safety.checkpoints.preview")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {status.skipped.length > 0 && (
            <div>
              <h3 className="h3">{t("safety.skipped.title")}</h3>
              <ul className="card-list">
                {status.skipped.map((s) => (
                  <li key={`${s.session_id}-${s.at}`} className="muted small">
                    {t("safety.skipped.line", {
                      agent: s.agent,
                      repository: s.repository,
                      reason: t(`safety.skipped.${s.reason}` satisfies Skip),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <SettingsForm settings={status.settings} onSaved={() => void reload()} />
        </>
      )}
      {status === null && !error && <p className="muted small">{t("common.status.loading")}</p>}
    </section>
  );
}
