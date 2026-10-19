// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState, type FormEvent } from "react";
import { useAction, useAiStatus, useMemorySettings } from "../core/hooks";
import {
  MEMORY_LAYERS,
  type AiStatus,
  type MemoryLayer,
  type MemorySensitivity,
  type MemorySettings,
} from "../core/types";
import { useT, type MessageKey } from "../i18n";
import { AiProviders } from "./AiProviders";
import { Feedback } from "./Feedback";

/** Retention choices in days; "" keeps until deleted. */
const RETENTION_DAYS = ["7", "30", "90", "365"] as const;

const LAYER_KEY: Record<MemoryLayer, MessageKey> = {
  working: "memory.settings.layer.working",
  episodic: "memory.settings.layer.episodic",
  project: "memory.settings.layer.project",
  preference: "memory.settings.layer.preference",
};

/** Absolute `.md` path on POSIX or Windows; Core is the authority and re-checks. */
const isAbsoluteMarkdownPath = (p: string) =>
  /\.md$/i.test(p) && (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p));

function RetentionChoice({
  layer,
  value,
  busy,
  onChange,
}: {
  layer: MemoryLayer;
  value: number | null;
  busy: boolean;
  onChange: (days: number | null) => void;
}) {
  const t = useT();
  const current = value === null ? "" : String(value);
  // A value Core stores that is not one of the usual choices stays selectable.
  const days: string[] = [...RETENTION_DAYS];
  if (current !== "" && !days.includes(current)) days.push(current);
  return (
    <label className="field">
      {t(LAYER_KEY[layer])}
      <select
        value={current}
        disabled={busy}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t("memory.settings.retention.forever")}</option>
        {days.map((v) => (
          <option key={v} value={v}>
            {t("memory.settings.retention.days", { days: Number(v) })}
          </option>
        ))}
      </select>
    </label>
  );
}

function MemorySettingsForm({
  settings,
  reload,
}: {
  settings: MemorySettings;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [paths, setPaths] = useState(settings.doc_paths.join("\n"));
  const [pathError, setPathError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async (patch: Partial<MemorySettings>, message: string) => {
    setSaved(null);
    if (await run("POST", "/api/memory/settings", patch)) setSaved(message);
    await reload();
  };
  const savePaths = (e: FormEvent) => {
    e.preventDefault();
    const list = paths
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const bad = list.find((p) => !isAbsoluteMarkdownPath(p));
    if (bad) {
      setPathError(t("memory.settings.pathNotAbsolute", { path: bad }));
      return;
    }
    if (list.length > 50) {
      setPathError(t("memory.settings.pathTooMany"));
      return;
    }
    setPathError(null);
    void save({ doc_paths: list }, t("memory.settings.pathsSaved"));
  };

  return (
    <>
      <fieldset>
        <legend className="small">{t("memory.settings.retentionLegend")}</legend>
        {MEMORY_LAYERS.map((layer) => (
          <RetentionChoice
            key={layer}
            layer={layer}
            value={settings.retention_days[layer]}
            busy={busy}
            onChange={(days) =>
              void save(
                { retention_days: { ...settings.retention_days, [layer]: days } },
                t("memory.settings.retentionUpdated"),
              )
            }
          />
        ))}
      </fieldset>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.capture_git}
          disabled={busy}
          onChange={() =>
            void save({ capture_git: !settings.capture_git }, t("memory.settings.gitUpdated"))
          }
        />
        {t("memory.settings.learnGit")}
      </label>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.allow_sensitive_meetings}
          disabled={busy}
          onChange={() =>
            void save(
              { allow_sensitive_meetings: !settings.allow_sensitive_meetings },
              t("memory.settings.meetingUpdated"),
            )
          }
        />
        {t("memory.common.includeSensitive")}
      </label>
      <p className="muted small">{t("memory.settings.sensitiveNote")}</p>
      <form className="settings-form" onSubmit={savePaths}>
        <label className="field">
          {t("memory.settings.docsLabel")}
          <textarea
            rows={4}
            value={paths}
            spellCheck={false}
            onChange={(e) => setPaths(e.target.value)}
          />
        </label>
        <button type="submit" className="btn" disabled={busy}>
          {t("memory.settings.saveDocs")}
        </button>
        <Feedback error={pathError} />
      </form>
      <Feedback error={error} saved={saved} />
    </>
  );
}

/** Memory settings: what Phoenix learns, from where, and for how long. */
export function MemorySettingsSection() {
  const t = useT();
  const { data, error, reload } = useMemorySettings();
  return (
    <section aria-labelledby="memory-h" className="card">
      <h2 id="memory-h" className="h3">
        {t("memory.settings.title")}
      </h2>
      <p className="small">{t("memory.settings.intro")}</p>
      {data ? (
        // Re-keyed so the document box restarts from what Core saved, not from stale edits.
        <MemorySettingsForm key={JSON.stringify(data.doc_paths)} settings={data} reload={reload} />
      ) : (
        error && <Feedback error={error} />
      )}
    </section>
  );
}

const CLASS_KEY: Record<MemorySensitivity, MessageKey> = {
  public: "memory.ai.allowPublic",
  internal: "memory.ai.allowInternal",
  sensitive: "memory.ai.allowSensitive",
};

function AiSettingsForm({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const cloud = status.providers.filter((p) => p.locality === "cloud");
  const cloudNames =
    cloud.length > 0 ? cloud.map((p) => p.label).join(", ") : t("memory.ai.cloudProviders");

  const post = async (path: string, body: unknown) => {
    await run("POST", path, body);
    await reload();
  };
  const setOptIn = (cls: MemorySensitivity, value: boolean) =>
    post("/api/ai/settings", { cloud_opt_in: { [cls]: value } });

  return (
    <>
      <label className="choice">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={() => void post("/api/ai/settings", { enabled: !status.enabled })}
        />
        {t("memory.ai.turnOn")}
      </label>
      <p className="muted small">{status.enabled ? t("memory.ai.isOn") : t("memory.ai.isOff")}</p>
      <label className="field">
        {t("memory.ai.preferred")}
        <select
          value={status.preferred ?? ""}
          disabled={busy}
          onChange={(e) => void post("/api/ai/settings", { preferred: e.target.value || null })}
        >
          <option value="">{t("memory.ai.automatic")}</option>
          {status.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.locality === "cloud"
                ? t("memory.ai.providerCloud", { label: p.label })
                : t("memory.ai.providerLocal", { label: p.label })}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="ai-external">
        <legend className="small">{t("memory.ai.externalLegend")}</legend>
        <label className="choice">
          <input
            type="checkbox"
            checked={status.external_processing_granted}
            disabled={busy}
            onChange={() =>
              void post("/api/ai/external-processing", {
                granted: !status.external_processing_granted,
              })
            }
          />
          {t("memory.ai.allowExternal")}
        </label>
        <p className="muted small">{t("memory.ai.externalNote")}</p>
        {(["public", "internal"] as const).map((cls) => (
          <label key={cls} className="choice">
            <input
              type="checkbox"
              checked={status.cloud_opt_in[cls]}
              disabled={busy}
              onChange={() => void setOptIn(cls, !status.cloud_opt_in[cls])}
            />
            {t(CLASS_KEY[cls])}
          </label>
        ))}

        <div className="ai-sensitive">
          <label className="choice">
            <input
              type="checkbox"
              checked={status.cloud_opt_in.sensitive}
              disabled={busy}
              onChange={() => {
                if (status.cloud_opt_in.sensitive) void setOptIn("sensitive", false);
                else setConfirmSensitive(true);
              }}
            />
            {t(CLASS_KEY.sensitive)}
          </label>
          <p className="small">
            {t.rich("memory.ai.notRecommendedLine", {
              lead: <strong>{t("memory.ai.notRecommended")}</strong>,
            })}
          </p>
          {confirmSensitive && !status.cloud_opt_in.sensitive && (
            <div
              className="ai-sensitive-confirm"
              role="group"
              aria-label={t("memory.ai.confirmGroup")}
            >
              <p className="small">{t("memory.ai.confirmBody", { providers: cloudNames })}</p>
              <div className="button-row wrap">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => {
                    setConfirmSensitive(false);
                    void setOptIn("sensitive", true);
                  }}
                >
                  {t("memory.ai.confirmSensitive")}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmSensitive(false)}>
                  {t("common.button.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      </fieldset>
      <AiProviders status={status} reload={reload} />
      <Feedback error={error} />
    </>
  );
}

/** AI settings: off by default; local first; every cloud step is its own explicit choice. */
export function AiSettings() {
  const t = useT();
  const { data, error, reload } = useAiStatus();
  return (
    <section aria-labelledby="ai-h" className="card">
      <h2 id="ai-h" className="h3">
        {t("memory.ai.title")}
      </h2>
      {data ? (
        <AiSettingsForm status={data} reload={reload} />
      ) : (
        error && <Feedback error={error} />
      )}
    </section>
  );
}
