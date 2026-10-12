// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import type { CapabilityView, JsonSchema, OrchestratedSessionList, PetState } from "../core/types";
import { AutomationSettings } from "./AutomationSettings";
import { AiSettings, MemorySettingsSection } from "./MemorySettings";
import { Feedback } from "./Feedback";
import { Multimodal } from "./Multimodal";
import { QuickActions } from "./Overview";
import { ProactiveSettingsSection } from "./ProactiveSettings";
import { RetrievalSettingsSection } from "./RetrievalSettings";
import { RegistrySettingsSection } from "./RegistrySettings";
import { SyncSettingsSection } from "./SyncSettings";

/** Settings (PRD v2.0 §16, FR-014): Fawkes, notifications, capabilities, privacy, memory, AI. */
export function SettingsPage({ state }: { state: PetState }) {
  return (
    <div className="settings">
      <h1>Settings</h1>
      <FawkesSettings />
      <NotificationSettings />
      <CapabilitySettings recording={state.recording} />
      <PrivacySettings />
      <MemorySettingsSection />
      <AiSettings />
      <Multimodal />
      <RetrievalSettingsSection />
      <AutomationSettings />
      <ProactiveSettingsSection />
      <RegistrySettingsSection />
      <SyncSettingsSection />
      <SupportSettings />
      <div className="card">
        <QuickActions state={state} />
      </div>
    </div>
  );
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

type AgentOperation = {
  status: string;
  result?: OrchestratedSessionList;
  error?: { message: string };
};

const activeSessions = (list: OrchestratedSessionList) => {
  if (!Array.isArray(list.sessions)) throw new Error("Could not check agent sessions");
  return list.sessions
    .filter((session) => session.state === "running" || session.state === "waiting")
    .map((session) => `${session.id}:${session.state}`)
    .sort();
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
  const client = useClient();
  const guardInFlight = useRef(false);
  const currentCapability = useRef(c);
  currentCapability.current = c;
  const [guardBusy, setGuardBusy] = useState(false);
  const [guardError, setGuardError] = useState<string | null>(null);
  const [stopReview, setStopReview] = useState<{
    action: "disable" | "restart";
    version: string;
    sessions: string[];
    body: unknown;
  } | null>(null);
  const [stopAcknowledged, setStopAcknowledged] = useState(false);
  const [form, setForm] = useState(() => toForm(c.config_schema, c.config));
  const [saved, setSaved] = useState<string | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [disclosure, setDisclosure] = useState<{
    version: string;
    action: "enable" | "restart";
  } | null>(null);
  const [acknowledgedVersion, setAcknowledgedVersion] = useState<string | null>(null);
  useEffect(() => {
    setDisclosure(null);
    setAcknowledgedVersion(null);
    setStopReview(null);
    setStopAcknowledged(false);
    setGuardError(null);
  }, [c.version]);
  useEffect(() => {
    if (c.status !== "enabled") {
      setStopReview(null);
      setStopAcknowledged(false);
    }
  }, [c.status]);
  const contextSources = c.context_sources ?? [];
  const aiTools = c.ai_tools ?? [];
  const hasAiDeclarations = contextSources.length > 0 || aiTools.length > 0;
  const currentDisclosure = disclosure?.version === c.version ? disclosure : null;
  const acknowledged = currentDisclosure !== null && acknowledgedVersion === c.version;
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
  const restart = async (body: unknown = {}) => {
    if (await act("POST", `${base}/disable`, {}, ""))
      await act("POST", `${base}/enable`, body, "Restarted.");
  };
  const loadAgentSessions = async () => {
    const started = await client.request<{ id: string }>(
      "POST",
      "/api/capabilities/agents/commands/session.list",
      { input: {} },
    );
    for (let check = 0; check < 40; check++) {
      const operation = await client.request<AgentOperation>(
        "GET",
        `/api/operations/${encodeURIComponent(started.id)}`,
      );
      if (operation.status === "succeeded") {
        if (!operation.result) throw new Error("Could not check agent sessions");
        return activeSessions(operation.result);
      }
      if (operation.status === "failed" || operation.status === "cancelled")
        throw new Error(operation.error?.message ?? "Could not check agent sessions");
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 150);
      await promise;
    }
    throw new Error("Checking agent sessions took too long");
  };
  const guardOperation = async (
    action: "disable" | "restart",
    body: unknown = {},
    review = stopReview,
  ) => {
    if (guardInFlight.current || busy) return;
    guardInFlight.current = true;
    setGuardBusy(true);
    setGuardError(null);
    const version = c.version;
    try {
      const sessions = await loadAgentSessions();
      if (
        currentCapability.current.version !== version ||
        currentCapability.current.status !== "enabled"
      ) {
        setStopReview(null);
        setStopAcknowledged(false);
        setGuardError("Capability changed. Review the current state before trying again.");
        return;
      }
      if (review) {
        if (review.version !== version || review.action !== action || !stopAcknowledged) return;
        if (
          sessions.length !== review.sessions.length ||
          sessions.some((session, index) => session !== review.sessions[index])
        ) {
          setStopReview({ action, version, sessions, body });
          setStopAcknowledged(false);
          setGuardError("Agent sessions changed. Review and acknowledge the current sessions.");
          return;
        }
      } else if (sessions.length) {
        setStopReview({ action, version, sessions, body });
        setStopAcknowledged(false);
        return;
      }
      setStopReview(null);
      setStopAcknowledged(false);
      if (action === "restart") await restart(body);
      else await act("POST", `${base}/disable`, {}, "Disabled.");
    } catch (err) {
      setGuardError(err instanceof Error ? err.message : "Could not check agent sessions");
    } finally {
      guardInFlight.current = false;
      setGuardBusy(false);
    }
  };
  const beginActivation = (action: "enable" | "restart") => {
    setAcknowledgedVersion(null);
    setDisclosure({ version: c.version, action });
  };
  const confirmActivation = () => {
    if (!currentDisclosure || !acknowledged || busy || guardBusy) return;
    setDisclosure(null);
    setAcknowledgedVersion(null);
    const body = { manifest_version: currentDisclosure.version };
    if (currentDisclosure.action === "restart") {
      if (c.id === "agents") void guardOperation("restart", body, null);
      else void restart(body);
    } else void act("POST", `${base}/enable`, body, "Enabled.");
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
          disabled={busy || guardBusy || c.status === "disconnected"}
          onClick={() => {
            if (enabled) {
              setDisclosure(null);
              setAcknowledgedVersion(null);
              if (c.id === "agents") void guardOperation("disable", {}, null);
              else void act("POST", `${base}/disable`, {}, "Disabled.");
            } else if (hasAiDeclarations) beginActivation("enable");
            else void act("POST", `${base}/enable`, {}, "Enabled.");
          }}
        >
          {enabled ? `Disable ${c.name}` : `Enable ${c.name}`}
        </button>
        {enabled && (
          <button
            type="button"
            className="btn"
            disabled={busy || guardBusy || (c.id === "kage" && recording)}
            title={
              c.id === "kage" && recording
                ? "Restarting Kage now would lose the recording"
                : undefined
            }
            onClick={() => {
              if (hasAiDeclarations) beginActivation("restart");
              else if (c.id === "agents") void guardOperation("restart", {}, null);
              else void restart();
            }}
          >
            Restart
          </button>
        )}
      </div>
      {stopReview && stopReview.version === c.version && c.status === "enabled" && (
        <section aria-label="Agent session stop acknowledgement" className="settings-form">
          <h3>Stopping active agent sessions</h3>
          <p>
            {stopReview.action === "restart" ? "Restarting" : "Disabling"} {c.name} will stop these
            running or waiting sessions: {stopReview.sessions.join(", ")}.
          </p>
          <label className="choice">
            <input
              type="checkbox"
              checked={stopAcknowledged}
              onChange={(e) => setStopAcknowledged(e.target.checked)}
            />
            I acknowledge that these agent sessions will be stopped.
          </label>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || guardBusy || !stopAcknowledged}
              onClick={() => void guardOperation(stopReview.action, stopReview.body)}
            >
              Confirm {stopReview.action}
            </button>
            <button
              type="button"
              className="btn"
              disabled={guardBusy}
              onClick={() => {
                setStopReview(null);
                setStopAcknowledged(false);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {guardError && (
        <p role="alert" className="error-text">
          {guardError}
        </p>
      )}
      {hasAiDeclarations && currentDisclosure && (
        <section aria-label={`AI activation disclosure for ${c.name}`} className="settings-form">
          <h3>
            Review AI access before{" "}
            {currentDisclosure.action === "restart" ? "restarting" : "enabling"}
          </h3>
          <p>
            Manifest version: {c.version}. Review the declared access and provider locality before
            activation.
          </p>
          <p>
            Capability: {c.name} — {c.description} ({c.kind})
          </p>
          <p>
            Data categories:{" "}
            {c.data_categories.length ? c.data_categories.join(", ") : "None declared"}
          </p>
          <h4>Capability permissions</h4>
          <ul>
            {c.permissions.map((p) => (
              <li key={p.permission}>
                {p.permission}: {p.description} ({p.granted ? "granted" : "not granted"})
              </li>
            ))}
          </ul>
          <h4>Context sources</h4>
          {contextSources.length === 0 && <p>None declared</p>}
          {contextSources.map((source, index) => (
            <div key={index}>
              <h5>{source.name}</h5>
              <p>{source.description}</p>
              <p>
                Provider: {source.provider.provider}; locality:{" "}
                {source.provider.locality === "cloud" ? "external/cloud" : "local"}
              </p>
              <p>
                Permissions:{" "}
                {source.permissions.length ? source.permissions.join(", ") : "None declared"}
              </p>
              <p>Data access:</p>
              <ul>
                {source.data_access.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {item.category}: {item.sensitivity}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <h4>AI tools and providers</h4>
          {aiTools.length === 0 && <p>None declared</p>}
          {aiTools.map((tool, index) => (
            <div key={index}>
              <h5>{tool.name}</h5>
              <p>{tool.description}</p>
              <p>
                Kind: {tool.kind}; command: {tool.command}
              </p>
              <p>
                Provider: {tool.provider.provider}; locality:{" "}
                {tool.provider.locality === "cloud" ? "external/cloud" : "local"}
              </p>
              <p>
                Permissions:{" "}
                {tool.permissions.length ? tool.permissions.join(", ") : "None declared"}
              </p>
              <p>Data access:</p>
              <ul>
                {tool.data_access.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {item.category}: {item.sensitivity}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <label className="choice">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledgedVersion(e.target.checked ? c.version : null)}
            />
            I have reviewed AI access for manifest version {c.version} and acknowledge this
            activation.
          </label>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !acknowledged}
              onClick={confirmActivation}
            >
              Confirm {currentDisclosure.action === "restart" ? "restart" : "enable"} for version{" "}
              {c.version}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDisclosure(null);
                setAcknowledgedVersion(null);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

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
  memory: "Memory",
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
