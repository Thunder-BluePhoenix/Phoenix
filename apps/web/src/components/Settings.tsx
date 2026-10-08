// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState, type FormEvent } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import {
  announcePetSettings,
  useAction,
  useCapabilities,
  useNotificationPreferences,
  usePetSettings,
  usePrivacy,
  type PetSettings,
} from "../core/hooks";
import type { CapabilityView, JsonSchema, PetState } from "../core/types";
import { QuickActions } from "./Overview";

/** Settings (PRD v2.0 §16, FR-014): Fawkes, notifications, capabilities, privacy. */
export function SettingsPage({ state }: { state: PetState }) {
  return (
    <div className="settings">
      <h1>Settings</h1>
      <FawkesSettings />
      <NotificationSettings />
      <CapabilitySettings recording={state.recording} />
      <PrivacySettings />
      <SupportSettings />
      <div className="card">
        <QuickActions state={state} />
      </div>
    </div>
  );
}

function Feedback({ error, saved }: { error: string | null; saved?: string | null }) {
  if (error)
    return (
      <p className="error-text small" role="alert">
        {error}
      </p>
    );
  return saved ? (
    <p className="small" role="status">
      {saved}
    </p>
  ) : null;
}

function FawkesSettings() {
  const { data } = usePetSettings();
  const { run, error } = useAction();
  const set = async (reduced_motion: PetSettings["reduced_motion"]) => {
    if (await run("POST", "/api/pet/settings", { reduced_motion })) announcePetSettings();
  };
  const options: [PetSettings["reduced_motion"], string][] = [
    ["auto", "Follow my system setting"],
    ["on", "Always reduce motion (Fawkes stays still)"],
    ["off", "Always animate"],
  ];
  return (
    <section aria-labelledby="fawkes-h" className="card">
      <h2 id="fawkes-h" className="h3">
        Fawkes
      </h2>
      <fieldset>
        <legend className="small">Motion</legend>
        {options.map(([value, label]) => (
          <label key={value} className="choice">
            <input
              type="radio"
              name="reduced-motion"
              checked={data.reduced_motion === value}
              onChange={() => void set(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="muted small">
        Fawkes' state is always written out in text as well; animation never carries information on
        its own.
      </p>
      <Feedback error={error} />
    </section>
  );
}

function NotificationSettings() {
  const { data: prefs, reload } = useNotificationPreferences();
  const { data: caps } = useCapabilities();
  const { run, error } = useAction();
  if (!prefs) return null;
  const save = async (patch: Record<string, unknown>) => {
    await run("POST", "/api/notifications/preferences", patch);
    await reload();
  };
  const toggleMute = (id: string) =>
    void save({
      muted_sources: prefs.muted_sources.includes(id)
        ? prefs.muted_sources.filter((s) => s !== id)
        : [...prefs.muted_sources, id],
    });
  return (
    <section aria-labelledby="notify-h" className="card">
      <h2 id="notify-h" className="h3">
        Notifications
      </h2>
      <label className="choice">
        <input
          type="checkbox"
          checked={!prefs.enabled}
          onChange={() => void save({ enabled: !prefs.enabled })}
        />
        Quiet mode (no notifications; activity is still recorded)
      </label>
      <label className="field">
        Notify me about
        <select
          value={prefs.min_severity}
          disabled={!prefs.enabled}
          onChange={(e) => void save({ min_severity: e.target.value })}
        >
          <option value="warning">Warnings and errors</option>
          <option value="error">Errors only</option>
        </select>
      </label>
      <p className="muted small">Requests for your approval always notify.</p>
      {caps.length > 0 && (
        <fieldset disabled={!prefs.enabled}>
          <legend className="small">Mute a capability</legend>
          {caps.map((c) => (
            <label key={c.id} className="choice">
              <input
                type="checkbox"
                checked={prefs.muted_sources.includes(c.id)}
                onChange={() => toggleMute(c.id)}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
      )}
      <Feedback error={error} />
    </section>
  );
}

function CapabilitySettings({ recording }: { recording: boolean }) {
  const { data: caps, error, reload } = useCapabilities();
  return (
    <section aria-labelledby="caps-h" className="card">
      <h2 id="caps-h" className="h3">
        Capabilities
      </h2>
      {error && <p className="error-text">{error}</p>}
      <div className="settings-caps">
        {caps.map((c) => (
          <CapabilityEditor key={c.id} capability={c} recording={recording} onChanged={reload} />
        ))}
      </div>
    </section>
  );
}

type FieldValue = string | boolean;

const fieldsOf = (schema: JsonSchema | undefined) =>
  Object.entries(schema?.properties ?? {}).filter(
    ([, p]) =>
      ["string", "integer", "number", "boolean"].includes(p.type ?? "") ||
      (p.type === "array" && p.items?.type === "string"),
  );

function toForm(schema: JsonSchema | undefined, config: Record<string, unknown> = {}) {
  const out: Record<string, FieldValue> = {};
  for (const [key, p] of fieldsOf(schema)) {
    const v = config[key];
    out[key] =
      p.type === "boolean"
        ? v === true
        : p.type === "array"
          ? (Array.isArray(v) ? v : []).join("\n")
          : v === undefined
            ? ""
            : String(v);
  }
  return out;
}

/** Form values → config, leaving empty fields out so capability defaults apply. */
export function fromForm(schema: JsonSchema | undefined, form: Record<string, FieldValue>) {
  const out: Record<string, unknown> = {};
  for (const [key, p] of fieldsOf(schema)) {
    const v = form[key];
    if (p.type === "boolean") {
      if (v) out[key] = true;
    } else if (p.type === "array") {
      const items = String(v ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (items.length) out[key] = items;
    } else if (String(v ?? "").trim() !== "") {
      out[key] = p.type === "string" ? String(v).trim() : Number(v);
    }
  }
  return out;
}

const LABELS: Record<string, string> = {
  base_url: "Server address",
  poll_ms: "Check every (ms)",
  bot_path: "Kage bot path",
  bot_name: "Bot display name",
  max_duration_min: "Maximum capture length (min)",
  repositories: "Repositories (one absolute path per line)",
  speed: "Playback speed",
};

function CapabilityEditor({
  capability: c,
  recording,
  onChanged,
}: {
  capability: CapabilityView;
  recording: boolean;
  onChanged: () => void;
}) {
  const { run, busy, error } = useAction();
  const [form, setForm] = useState(() => toForm(c.config_schema, c.config));
  const [saved, setSaved] = useState<string | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const enabled = c.status === "enabled";
  const fields = fieldsOf(c.config_schema);
  const base = `/api/capabilities/${encodeURIComponent(c.id)}`;

  const act = async (method: string, path: string, body: unknown, message: string) => {
    setSaved(null);
    const ok = await run(method, path, body);
    if (ok !== undefined) setSaved(message);
    onChanged();
    return ok !== undefined;
  };
  const saveConfig = (e: FormEvent) => {
    e.preventDefault();
    void act(
      "POST",
      `${base}/config`,
      { config: fromForm(c.config_schema, form) },
      enabled ? `Saved. Restart ${c.name} to apply.` : "Saved.",
    );
  };
  const restart = async () => {
    if (await act("POST", `${base}/disable`, {}, ""))
      await act("POST", `${base}/enable`, {}, "Restarted.");
  };

  return (
    <details className="settings-cap">
      <summary>
        <strong>{c.name}</strong>{" "}
        <span className={`small status status-${c.status}`}>
          {enabled ? "Enabled" : c.status === "installed" ? "Not enabled" : c.status}
        </span>
      </summary>
      <p className="muted small">{c.description}</p>
      {enabled && c.health.message && <p className="small">{c.health.message}</p>}

      <div className="button-row wrap">
        <button
          type="button"
          className={`btn ${enabled ? "" : "btn-primary"}`}
          disabled={busy || c.status === "disconnected"}
          onClick={() =>
            void act(
              "POST",
              `${base}/${enabled ? "disable" : "enable"}`,
              {},
              enabled ? "Disabled." : "Enabled.",
            )
          }
        >
          {enabled ? `Disable ${c.name}` : `Enable ${c.name}`}
        </button>
        {enabled && (
          <button
            type="button"
            className="btn"
            disabled={busy || (c.id === "kage" && recording)}
            title={
              c.id === "kage" && recording
                ? "Restarting Kage now would lose the recording"
                : undefined
            }
            onClick={() => void restart()}
          >
            Restart
          </button>
        )}
      </div>

      {fields.length > 0 && (
        <form onSubmit={saveConfig} className="settings-form">
          {fields.map(([key, p]) => {
            const label = LABELS[key] ?? key;
            const set = (v: FieldValue) => setForm((f) => ({ ...f, [key]: v }));
            if (p.type === "boolean") {
              return (
                <label key={key} className="choice">
                  <input
                    type="checkbox"
                    checked={form[key] === true}
                    onChange={(e) => set(e.target.checked)}
                  />
                  {label}
                </label>
              );
            }
            return (
              <label key={key} className="field">
                {label}
                {p.type === "array" ? (
                  <textarea
                    rows={3}
                    value={String(form[key] ?? "")}
                    onChange={(e) => set(e.target.value)}
                  />
                ) : (
                  <input
                    type={p.type === "string" ? "text" : "number"}
                    value={String(form[key] ?? "")}
                    {...(p.minimum !== undefined ? { min: p.minimum } : {})}
                    {...(p.maximum !== undefined ? { max: p.maximum } : {})}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
                {p.description && <span className="muted small">{p.description}</span>}
              </label>
            );
          })}
          <button type="submit" className="btn" disabled={busy}>
            Save configuration
          </button>
        </form>
      )}

      {(c.secrets ?? []).map((s) => (
        <form
          key={s.name}
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              "POST",
              `${base}/secrets/${s.name}`,
              { value: secretValues[s.name] ?? "" },
              "Saved to your OS keychain.",
            ).then((ok) => ok && setSecretValues((v) => ({ ...v, [s.name]: "" })));
          }}
        >
          <label className="field">
            {s.name === "api_key" ? "API key" : s.name}{" "}
            <span className="muted small">
              {s.set ? "(stored in your OS keychain)" : "(not set)"}
            </span>
            <input
              type="password"
              autoComplete="off"
              value={secretValues[s.name] ?? ""}
              placeholder={s.set ? "Enter a new value to replace it" : ""}
              onChange={(e) => setSecretValues((v) => ({ ...v, [s.name]: e.target.value }))}
            />
            {s.description && <span className="muted small">{s.description}</span>}
          </label>
          <div className="button-row wrap">
            <button type="submit" className="btn" disabled={busy || !secretValues[s.name]}>
              Save {s.name === "api_key" ? "API key" : s.name}
            </button>
            {s.set && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  void act(
                    "DELETE",
                    `${base}/secrets/${s.name}`,
                    undefined,
                    "Removed from your keychain.",
                  )
                }
              >
                Remove
              </button>
            )}
          </div>
        </form>
      ))}

      {c.permissions.length > 0 && (
        <div>
          <p className="small">Permissions</p>
          <ul className="perm-list">
            {c.permissions.map((p) => (
              <li key={p.permission} className="small">
                <span aria-hidden="true">{p.granted ? "✓" : "○"}</span> {p.description}{" "}
                {p.granted ? (
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        "POST",
                        `/api/permissions/${encodeURIComponent(c.id)}/revoke`,
                        { permissions: [p.permission] },
                        "Permission revoked. Enabling again asks for it again.",
                      )
                    }
                  >
                    Revoke<span className="sr-only"> {p.description}</span>
                  </button>
                ) : (
                  <span className="muted">(not granted)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.data_categories.length > 0 && (
        <p className="muted small">Accesses: {c.data_categories.join(", ")}</p>
      )}
      <Feedback error={error} saved={saved} />
    </details>
  );
}

const RETENTION_CHOICES: [string, string][] = [
  ["", "Until I delete it"],
  ["1", "1 day"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "1 year"],
];

const DATA_LABELS: Record<string, string> = {
  events: "Activity history",
  notifications: "Notifications",
  meetings: "Meetings",
};

/**
 * A report a user can paste into a bug report (PRD v2.0 §21). Core builds it from an allow-list, so
 * it is shown in full before anyone copies it: nothing here is hidden from the person sharing it.
 */
function SupportSettings() {
  const client = useClient();
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = async () => {
    setBusy(true);
    setCopied(null);
    setError(null);
    try {
      setReport(JSON.stringify(await client.request("GET", "/api/diagnostics"), null, 2));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report ?? "");
      setCopied("Copied.");
    } catch {
      setCopied("Could not copy automatically. Select the text above and copy it.");
    }
  };

  return (
    <section aria-labelledby="support-h" className="card">
      <h2 id="support-h" className="h3">
        Support
      </h2>
      <p className="small">
        If something is wrong, attach a diagnostics report to your bug report. It says how Phoenix
        is behaving (versions, capability health, counts, recent event names). It has no event
        contents, meeting titles, transcripts, settings values, secrets or file paths.
      </p>
      <div className="button-row wrap">
        <button type="button" className="btn" disabled={busy} onClick={() => void show()}>
          {report === null ? "Show diagnostics report" : "Refresh report"}
        </button>
        {report !== null && (
          <button type="button" className="btn" onClick={() => void copy()}>
            Copy report
          </button>
        )}
      </div>
      {report !== null && (
        <label className="field">
          Diagnostics report
          <textarea className="report" readOnly rows={12} value={report} />
        </label>
      )}
      <Feedback error={error} saved={copied} />
    </section>
  );
}

function PrivacySettings() {
  const { data: inv, error: loadError, reload } = usePrivacy();
  const { run, busy, error } = useAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (loadError) return <p className="error-text">{loadError}</p>;
  if (!inv) return null;

  const setRetention = async (id: string, value: string) => {
    if (await run("POST", "/api/privacy/retention", { [id]: value ? Number(value) : null })) {
      setSaved(`${DATA_LABELS[id] ?? id}: retention updated.`);
    }
    await reload();
  };
  const remove = async (id: string) => {
    const r = (await run("POST", "/api/privacy/delete", { data: id, confirm: true })) as
      { deleted: number } | undefined;
    setConfirm(null);
    if (r) setSaved(`Deleted ${r.deleted} ${(DATA_LABELS[id] ?? id).toLowerCase()} records.`);
    await reload();
  };

  return (
    <section aria-labelledby="privacy-h" className="card">
      <h2 id="privacy-h" className="h3">
        Privacy and data
      </h2>
      <p className="small">
        Everything stays on this computer, in <code className="break">{inv.location}</code>.
        Credentials are kept in your OS keychain, never in that folder.
      </p>
      <ul className="privacy-list">
        {inv.data.map((d) => (
          <li key={d.id}>
            <div>
              <strong>{DATA_LABELS[d.id] ?? d.id}</strong>{" "}
              <span className="muted small">({d.count} stored)</span>
              <p className="muted small">{d.description}</p>
            </div>
            <label className="field">
              Keep
              <select
                value={d.retention_days === null ? "" : String(d.retention_days)}
                disabled={busy}
                onChange={(e) => void setRetention(d.id, e.target.value)}
              >
                {RETENTION_CHOICES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {confirm === d.id ? (
              <div className="button-row wrap">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void remove(d.id)}
                >
                  Confirm: delete all {(DATA_LABELS[d.id] ?? d.id).toLowerCase()}
                </button>
                <button type="button" className="btn" onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-danger-outline"
                disabled={d.count === 0}
                onClick={() => setConfirm(d.id)}
              >
                Delete all…
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">
        <strong>Audit log</strong> ({inv.audit_log.count} entries): {inv.audit_log.description}
      </p>
      <p className="small">
        <strong>Credentials:</strong>{" "}
        {inv.credentials.length === 0
          ? "none stored."
          : inv.credentials.map((c) => `${c.capability} ${c.name} (${c.stored_in})`).join(", ")}
      </p>
      <p className="small">
        <strong>Telemetry:</strong>{" "}
        {inv.telemetry === "none" ? "Phoenix sends no telemetry." : inv.telemetry}
      </p>
      <p className="small">
        <strong>External AI:</strong> {inv.external_ai}
      </p>
      <Feedback error={error} saved={saved} />
    </section>
  );
}
