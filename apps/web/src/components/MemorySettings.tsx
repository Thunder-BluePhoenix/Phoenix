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
import { Feedback } from "./Feedback";

const RETENTION_CHOICES: [string, string][] = [
  ["", "Keep until deleted"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "365 days"],
];

const LAYER_LABEL: Record<MemoryLayer, string> = {
  working: "Working notes (what you are doing right now)",
  episodic: "Events (commits, meetings)",
  project: "Project knowledge (docs)",
  preference: "Preferences",
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
  const current = value === null ? "" : String(value);
  const choices = RETENTION_CHOICES.some(([v]) => v === current)
    ? RETENTION_CHOICES
    : [...RETENTION_CHOICES, [current, `${current} days`] as [string, string]];
  return (
    <label className="field">
      {LAYER_LABEL[layer]}
      <select
        value={current}
        disabled={busy}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        {choices.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
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
      setPathError(`“${bad}” is not an absolute path to a .md file.`);
      return;
    }
    if (list.length > 50) {
      setPathError("At most 50 documents can be listed.");
      return;
    }
    setPathError(null);
    void save({ doc_paths: list }, "Document list saved. Phoenix re-reads those files now.");
  };

  return (
    <>
      <fieldset>
        <legend className="small">How long Phoenix remembers things</legend>
        {MEMORY_LAYERS.map((layer) => (
          <RetentionChoice
            key={layer}
            layer={layer}
            value={settings.retention_days[layer]}
            busy={busy}
            onChange={(days) =>
              void save(
                { retention_days: { ...settings.retention_days, [layer]: days } },
                "Retention updated.",
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
            void save({ capture_git: !settings.capture_git }, "Git learning updated.")
          }
        />
        Learn from my Git commits
      </label>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.allow_sensitive_meetings}
          disabled={busy}
          onChange={() =>
            void save(
              { allow_sensitive_meetings: !settings.allow_sensitive_meetings },
              "Meeting memory updated.",
            )
          }
        />
        Include meeting summaries marked sensitive
      </label>
      <p className="muted small">
        Off by default. When on, summaries of meetings Phoenix classed as sensitive are remembered
        too, labelled Sensitive. They stay on this computer and are not sent to cloud AI unless you
        also allow that below.
      </p>
      <form className="settings-form" onSubmit={savePaths}>
        <label className="field">
          Documents to learn from (one absolute path to a .md file per line)
          <textarea
            rows={4}
            value={paths}
            spellCheck={false}
            onChange={(e) => setPaths(e.target.value)}
          />
        </label>
        <button type="submit" className="btn" disabled={busy}>
          Save document list
        </button>
        <Feedback error={pathError} />
      </form>
      <Feedback error={error} saved={saved} />
    </>
  );
}

/** Memory settings: what Phoenix learns, from where, and for how long. */
export function MemorySettingsSection() {
  const { data, error, reload } = useMemorySettings();
  return (
    <section aria-labelledby="memory-h" className="card">
      <h2 id="memory-h" className="h3">
        Memory
      </h2>
      <p className="small">
        Fawkes remembers facts from sources you allow, on this computer only. Browse, forget or
        delete them in the Memory tab of the Pet Panel.
      </p>
      {data ? (
        // Re-keyed so the document box restarts from what Core saved, not from stale edits.
        <MemorySettingsForm
          key={JSON.stringify(data.doc_paths)}
          settings={data}
          reload={reload}
        />
      ) : (
        error && <Feedback error={error} />
      )}
    </section>
  );
}

const CLASS_LABEL: Record<MemorySensitivity, string> = {
  public: "Public memories",
  internal: "Internal memories",
  sensitive: "Sensitive memories (including sensitive meeting summaries)",
};

function ProviderList({ status }: { status: AiStatus }) {
  if (status.providers.length === 0) return <p className="muted small">No AI providers found.</p>;
  return (
    <ul className="privacy-list ai-providers" aria-label="AI providers">
      {status.providers.map((p) => (
        <li key={p.id}>
          <strong>{p.label}</strong>{" "}
          <span className="small">
            {p.locality === "local" ? "On this device" : "Cloud (leaves this device)"}
          </span>{" "}
          <span className="small">
            {p.available ? "Available" : `Not available${p.reason ? `: ${p.reason}` : ""}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The key goes to Core and into the OS keychain; this component never holds it after saving. */
function AnthropicKey() {
  const { run, busy, error } = useAction();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    if ((await run("POST", "/api/ai/secret", { value })) !== undefined) {
      setValue("");
      setSaved("Key set. It is stored in your OS keychain and is never shown again.");
    }
  };
  const remove = async () => {
    setSaved(null);
    if ((await run("DELETE", "/api/ai/secret")) !== undefined) {
      setSaved("Key removed from your keychain.");
    }
  };
  return (
    <form className="settings-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        Anthropic API key
        <input
          type="password"
          autoComplete="off"
          value={value}
          maxLength={512}
          onChange={(e) => setValue(e.target.value)}
        />
        <span className="muted small">Only used if you allow external AI below.</span>
      </label>
      <div className="button-row wrap">
        <button type="submit" className="btn" disabled={busy || !value}>
          Save Anthropic key
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
          Remove Anthropic key
        </button>
      </div>
      <Feedback error={error} saved={saved} />
    </form>
  );
}

function AiSettingsForm({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
  const { run, busy, error } = useAction();
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const cloud = status.providers.filter((p) => p.locality === "cloud");
  const cloudNames = cloud.length > 0 ? cloud.map((p) => p.label).join(", ") : "cloud AI providers";

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
        Turn on AI features
      </label>
      <p className="muted small">
        {status.enabled
          ? "AI is on. Local models run on this device."
          : "AI is off. Nothing is sent to any AI model."}
      </p>
      <ProviderList status={status} />
      <label className="field">
        Preferred AI provider
        <select
          value={status.preferred ?? ""}
          disabled={busy}
          onChange={(e) => void post("/api/ai/settings", { preferred: e.target.value || null })}
        >
          <option value="">Automatic (on-device first)</option>
          {status.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.locality === "cloud" ? " (cloud)" : " (on this device)"}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="ai-external">
        <legend className="small">External AI (cloud)</legend>
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
          Allow Phoenix to send data to external AI providers
        </label>
        <p className="muted small">
          Off by default. Nothing leaves this device unless this is on and the type of memory
          below is also allowed.
        </p>
        {(["public", "internal"] as const).map((cls) => (
          <label key={cls} className="choice">
            <input
              type="checkbox"
              checked={status.cloud_opt_in[cls]}
              disabled={busy}
              onChange={() => void setOptIn(cls, !status.cloud_opt_in[cls])}
            />
            Allow {CLASS_LABEL[cls].toLowerCase()} to be sent to external AI
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
            Allow {CLASS_LABEL.sensitive.toLowerCase()} to be sent to external AI
          </label>
          <p className="small">
            <strong>Not recommended.</strong> Off by default.
          </p>
          {confirmSensitive && !status.cloud_opt_in.sensitive && (
            <div className="ai-sensitive-confirm" role="group" aria-label="Confirm sensitive data">
              <p className="small">
                Sensitive memories, including meeting summaries, may be sent to {cloudNames}. They
                would leave this computer and be processed under that provider’s terms. You can
                switch this off again at any time.
              </p>
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
                  Confirm: allow sensitive memories to be sent
                </button>
                <button type="button" className="btn" onClick={() => setConfirmSensitive(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </fieldset>
      <AnthropicKey />
      <Feedback error={error} />
    </>
  );
}

/** AI settings: off by default; local first; every cloud step is its own explicit choice. */
export function AiSettings() {
  const { data, error, reload } = useAiStatus();
  return (
    <section aria-labelledby="ai-h" className="card">
      <h2 id="ai-h" className="h3">
        AI
      </h2>
      {data ? <AiSettingsForm status={data} reload={reload} /> : error && <Feedback error={error} />}
    </section>
  );
}
