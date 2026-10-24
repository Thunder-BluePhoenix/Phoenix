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
import { formatNumber } from "../core/format";
import { isMessageKey, useT, type MessageKey, type Translate } from "../i18n";
import { AgentInstallersSection } from "./AgentInstallers";
import { HandoffNotesSection } from "./HandoffNotes";
import { ApprovalRulesSection } from "./ApprovalRules";
import { AutomationSettings } from "./AutomationSettings";
import { AiSettings, MemorySettingsSection } from "./MemorySettings";
import { Feedback } from "./Feedback";
import { DictationSettingsSection } from "./Dictation";
import { DemoSettingsSection } from "./Demo";
import { LanguageSection } from "./Language";
import { ShortcutSettings } from "./ShortcutSettings";
import { SoundSettingsSection } from "./SoundSettings";
import { VoiceSettingsSection } from "./Voice";
import { NotetakerSettingsSection } from "./Notetaker";
import { Multimodal } from "./Multimodal";
import { QuickActions } from "./Overview";
import { ProactiveSettingsSection } from "./ProactiveSettings";
import { RetrievalSettingsSection } from "./RetrievalSettings";
import { RegistrySettingsSection } from "./RegistrySettings";
import { SyncSettingsSection } from "./SyncSettings";
import { ContinuitySettings } from "./Continuity";
import { LidActionsSettings } from "./LidActions";
import { McpClients } from "./McpClients";
import { PhoneLink } from "./PhoneLink";
import { RemoteRelaySection } from "./RemoteRelay";
import { PortRadar } from "./PortRadar";
import { MachineHealth } from "./MachineHealth";
import { EngineeringSignals } from "./EngineeringSignals";
import { EventSourcePolicySection } from "./EventSourcePolicy";
import { FawkesRebirthSettingsSection } from "./FawkesRebirthSettings";
import { BrowserProfilesSection } from "./BrowserProfilesSettings";
import { MusicSitesSection } from "./MusicSitesSettings";
import { AwakeSettingsSection } from "./AwakeSettings";
import { ScheduledAwakeSection } from "./ScheduledAwakeSettings";
import { StatusLightsSection } from "./StatusLightsSettings";
import { TeamSettingsSection } from "./TeamSettings";
import { TeamWebhooksSection } from "./TeamWebhooks";
import { FawkesAppearanceSection } from "./Wardrobe";
import { FocusMode } from "./FocusMode";
import { ImageIssueSection } from "./ImageIssue";
import { ScreenshotIssueSection } from "./ScreenshotIssueSection";

/** Settings (PRD v2.0 §16, FR-014): Fawkes, notifications, capabilities, privacy, memory, AI. */
export function SettingsPage({ state }: { state: PetState }) {
  const t = useT();
  return (
    <div className="settings">
      <h1>{t("settings.title")}</h1>
      <LanguageSection />
      <FawkesSettings />
      <FawkesAppearanceSection />
      <SoundSettingsSection />
      <NotificationSettings />
      <FocusMode />
      <ImageIssueSection />
      <ScreenshotIssueSection />
      <CapabilitySettings recording={state.recording} />
      <PrivacySettings />
      <MemorySettingsSection />
      <AiSettings />
      <Multimodal />
      <DictationSettingsSection />
      <NotetakerSettingsSection />
      <VoiceSettingsSection />
      <RetrievalSettingsSection />
      <AutomationSettings />
      <ApprovalRulesSection />
      <AgentInstallersSection />
      <HandoffNotesSection />
      <ProactiveSettingsSection />
      <RegistrySettingsSection />
      <SyncSettingsSection />
      <PhoneLink />
      <RemoteRelaySection />
      <McpClients />
      <AwakeSettingsSection />
      <LidActionsSettings />
      <ContinuitySettings />
      <PortRadar />
      <MachineHealth />
      <EngineeringSignals />
      <ScheduledAwakeSection />
      <StatusLightsSection />
      <TeamSettingsSection />
      <TeamWebhooksSection />
      <BrowserProfilesSection />
      <MusicSitesSection />
      <FawkesRebirthSettingsSection />
      <EventSourcePolicySection />
      <SupportSettings />
      <ShortcutSettings />
      <DemoSettingsSection />
      <div className="card">
        <QuickActions state={state} />
      </div>
    </div>
  );
}

function FawkesSettings() {
  const t = useT();
  const { data } = usePetSettings();
  const { run, error } = useAction();
  const set = async (reduced_motion: PetSettings["reduced_motion"]) => {
    if (await run("POST", "/api/pet/settings", { reduced_motion })) announcePetSettings();
  };
  const setFollow = async (follow_cursor: boolean) => {
    if (await run("POST", "/api/pet/settings", { follow_cursor })) announcePetSettings();
  };
  const options: [PetSettings["reduced_motion"], string][] = [
    ["auto", t("settings.fawkes.motionAuto")],
    ["on", t("settings.fawkes.motionOn")],
    ["off", t("settings.fawkes.motionOff")],
  ];
  return (
    <section aria-labelledby="fawkes-h" className="card">
      <h2 id="fawkes-h" className="h3">
        Fawkes
      </h2>
      <fieldset>
        <legend className="small">{t("settings.fawkes.motion")}</legend>
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
      <p className="muted small">{t("settings.fawkes.note")}</p>
      <label className="choice">
        <input
          type="checkbox"
          checked={data.follow_cursor === true}
          onChange={(event) => void setFollow(event.target.checked)}
        />
        {t("follow.label")}
      </label>
      <p className="muted small">{t("follow.hint")}</p>
      <Feedback error={error} />
    </section>
  );
}

function NotificationSettings() {
  const t = useT();
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
        {t("settings.notifications.title")}
      </h2>
      <label className="choice">
        <input
          type="checkbox"
          checked={!prefs.enabled}
          onChange={() => void save({ enabled: !prefs.enabled })}
        />
        {t("settings.notifications.quiet")}
      </label>
      <label className="field">
        {t("settings.notifications.minSeverity")}
        <select
          value={prefs.min_severity}
          disabled={!prefs.enabled}
          onChange={(e) => void save({ min_severity: e.target.value })}
        >
          <option value="warning">{t("settings.notifications.severityWarning")}</option>
          <option value="error">{t("settings.notifications.severityError")}</option>
        </select>
      </label>
      <p className="muted small">{t("settings.notifications.approvalsNote")}</p>
      {caps.length > 0 && (
        <fieldset disabled={!prefs.enabled}>
          <legend className="small">{t("settings.notifications.muteLegend")}</legend>
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
  const t = useT();
  const { data: caps, error, reload } = useCapabilities();
  return (
    <section aria-labelledby="caps-h" className="card">
      <h2 id="caps-h" className="h3">
        {t("settings.capabilities.title")}
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

/** Display names of the capability config fields Phoenix knows; any other field shows its key. */
const LABELS: Record<string, MessageKey> = {
  base_url: "settings.field.baseUrl",
  poll_ms: "settings.field.pollMs",
  bot_path: "settings.field.botPath",
  bot_name: "settings.field.botName",
  max_duration_min: "settings.field.maxDurationMin",
  repositories: "settings.field.repositories",
  speed: "settings.field.speed",
};

/** How a capability's state reads next to its name; an unknown state shows as Core sent it. */
const STATUS_TEXT: Readonly<Partial<Record<string, MessageKey>>> = {
  enabled: "common.status.enabled",
  installed: "settings.capability.status.notEnabled",
  disabled: "settings.capability.status.disabled",
  failed: "settings.capability.status.failed",
  disconnected: "settings.capability.status.disconnected",
};

const joinList = (t: Translate, items: readonly string[]) =>
  items.join(t("settings.listSeparator"));

type AgentOperation = {
  status: string;
  result?: OrchestratedSessionList;
  error?: { message: string };
};

const activeSessions = (list: OrchestratedSessionList, unreadable: string) => {
  if (!Array.isArray(list.sessions)) throw new Error(unreadable);
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
  const t = useT();
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
      enabled
        ? t("settings.capability.done.savedRestart", { name: c.name })
        : t("settings.capability.done.saved"),
    );
  };
  const restart = async (body: unknown = {}) => {
    if (await act("POST", `${base}/disable`, {}, ""))
      await act("POST", `${base}/enable`, body, t("settings.capability.done.restarted"));
  };
  const loadAgentSessions = async () => {
    const unreadable = t("settings.guard.checkFailed");
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
        if (!operation.result) throw new Error(unreadable);
        return activeSessions(operation.result, unreadable);
      }
      if (operation.status === "failed" || operation.status === "cancelled")
        throw new Error(operation.error?.message ?? unreadable);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 150);
      await promise;
    }
    throw new Error(t("settings.guard.checkTimeout"));
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
        setGuardError(t("settings.guard.capabilityChanged"));
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
          setGuardError(t("settings.guard.sessionsChanged"));
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
      else await act("POST", `${base}/disable`, {}, t("settings.capability.done.disabled"));
    } catch (err) {
      setGuardError(err instanceof Error ? err.message : t("settings.guard.checkFailed"));
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
    } else void act("POST", `${base}/enable`, body, t("settings.capability.done.enabled"));
  };
  const noneDeclared = t("settings.disclosure.noneDeclared");
  const statusKey = STATUS_TEXT[c.status];

  return (
    <details className="settings-cap">
      <summary>
        <strong>{c.name}</strong>{" "}
        <span className={`small status status-${c.status}`}>
          {statusKey ? t(statusKey) : c.status}
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
              else void act("POST", `${base}/disable`, {}, t("settings.capability.done.disabled"));
            } else if (hasAiDeclarations) beginActivation("enable");
            else void act("POST", `${base}/enable`, {}, t("settings.capability.done.enabled"));
          }}
        >
          {enabled
            ? t("settings.capability.disable", { name: c.name })
            : t("settings.capability.enable", { name: c.name })}
        </button>
        {enabled && (
          <button
            type="button"
            className="btn"
            disabled={busy || guardBusy || (c.id === "kage" && recording)}
            title={
              c.id === "kage" && recording ? t("settings.capability.restartBlocked") : undefined
            }
            onClick={() => {
              if (hasAiDeclarations) beginActivation("restart");
              else if (c.id === "agents") void guardOperation("restart", {}, null);
              else void restart();
            }}
          >
            {t("settings.capability.restart")}
          </button>
        )}
      </div>
      {stopReview && stopReview.version === c.version && c.status === "enabled" && (
        <section aria-label={t("settings.guard.region")} className="settings-form">
          <h3>{t("settings.guard.title")}</h3>
          <p>
            {t(
              stopReview.action === "restart"
                ? "settings.guard.bodyRestart"
                : "settings.guard.bodyDisable",
              { name: c.name, sessions: joinList(t, stopReview.sessions) },
            )}
          </p>
          <label className="choice">
            <input
              type="checkbox"
              checked={stopAcknowledged}
              onChange={(e) => setStopAcknowledged(e.target.checked)}
            />
            {t("settings.guard.acknowledge")}
          </label>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || guardBusy || !stopAcknowledged}
              onClick={() => void guardOperation(stopReview.action, stopReview.body)}
            >
              {t(
                stopReview.action === "restart"
                  ? "settings.guard.confirmRestart"
                  : "settings.guard.confirmDisable",
              )}
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
              {t("common.button.cancel")}
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
        <section
          aria-label={t("settings.disclosure.region", { name: c.name })}
          className="settings-form"
        >
          <h3>
            {t(
              currentDisclosure.action === "restart"
                ? "settings.disclosure.titleRestart"
                : "settings.disclosure.titleEnable",
            )}
          </h3>
          <p>{t("settings.disclosure.manifest", { version: c.version })}</p>
          <p>
            {t("settings.disclosure.summary", {
              name: c.name,
              description: c.description,
              kind: c.kind,
            })}
          </p>
          <p>
            {t("settings.disclosure.dataCategories", {
              list: c.data_categories.length ? joinList(t, c.data_categories) : noneDeclared,
            })}
          </p>
          <h4>{t("settings.disclosure.permissionsHeading")}</h4>
          <ul>
            {c.permissions.map((p) => (
              <li key={p.permission}>
                {t(
                  p.granted
                    ? "settings.disclosure.permissionGranted"
                    : "settings.disclosure.permissionDenied",
                  { permission: p.permission, description: p.description },
                )}
              </li>
            ))}
          </ul>
          <h4>{t("settings.disclosure.contextHeading")}</h4>
          {contextSources.length === 0 && <p>{noneDeclared}</p>}
          {contextSources.map((source, index) => (
            <div key={index}>
              <h5>{source.name}</h5>
              <p>{source.description}</p>
              <p>
                {t(
                  source.provider.locality === "cloud"
                    ? "settings.disclosure.providerCloud"
                    : "settings.disclosure.providerLocal",
                  { provider: source.provider.provider },
                )}
              </p>
              <p>
                {t("settings.disclosure.permissions", {
                  list: source.permissions.length ? joinList(t, source.permissions) : noneDeclared,
                })}
              </p>
              <p>{t("settings.disclosure.dataAccess")}</p>
              <ul>
                {source.data_access.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {item.category}: {item.sensitivity}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <h4>{t("settings.disclosure.toolsHeading")}</h4>
          {aiTools.length === 0 && <p>{noneDeclared}</p>}
          {aiTools.map((tool, index) => (
            <div key={index}>
              <h5>{tool.name}</h5>
              <p>{tool.description}</p>
              <p>{t("settings.disclosure.toolKind", { kind: tool.kind, command: tool.command })}</p>
              <p>
                {t(
                  tool.provider.locality === "cloud"
                    ? "settings.disclosure.providerCloud"
                    : "settings.disclosure.providerLocal",
                  { provider: tool.provider.provider },
                )}
              </p>
              <p>
                {t("settings.disclosure.permissions", {
                  list: tool.permissions.length ? joinList(t, tool.permissions) : noneDeclared,
                })}
              </p>
              <p>{t("settings.disclosure.dataAccess")}</p>
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
            {t("settings.disclosure.acknowledge", { version: c.version })}
          </label>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !acknowledged}
              onClick={confirmActivation}
            >
              {t(
                currentDisclosure.action === "restart"
                  ? "settings.disclosure.confirmRestart"
                  : "settings.disclosure.confirmEnable",
                { version: c.version },
              )}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDisclosure(null);
                setAcknowledgedVersion(null);
              }}
            >
              {t("common.button.cancel")}
            </button>
          </div>
        </section>
      )}

      {fields.length > 0 && (
        <form onSubmit={saveConfig} className="settings-form">
          {fields.map(([key, p]) => {
            const labelKey = LABELS[key];
            const label = labelKey ? t(labelKey) : key;
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
            {t("settings.capability.saveConfig")}
          </button>
        </form>
      )}

      {(c.secrets ?? []).map((s) => {
        const secretLabel = s.name === "api_key" ? t("settings.secret.apiKey") : s.name;
        return (
          <form
            key={s.name}
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                "POST",
                `${base}/secrets/${s.name}`,
                { value: secretValues[s.name] ?? "" },
                t("settings.capability.done.secretSaved"),
              ).then((ok) => ok && setSecretValues((v) => ({ ...v, [s.name]: "" })));
            }}
          >
            <label className="field">
              {secretLabel}{" "}
              <span className="muted small">
                {s.set ? t("settings.secret.stored") : t("settings.secret.notSet")}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={secretValues[s.name] ?? ""}
                placeholder={s.set ? t("settings.secret.placeholder") : ""}
                onChange={(e) => setSecretValues((v) => ({ ...v, [s.name]: e.target.value }))}
              />
              {s.description && <span className="muted small">{s.description}</span>}
            </label>
            <div className="button-row wrap">
              <button type="submit" className="btn" disabled={busy || !secretValues[s.name]}>
                {t("settings.secret.save", { name: secretLabel })}
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
                      t("settings.capability.done.secretRemoved"),
                    )
                  }
                >
                  {t("common.button.remove")}
                </button>
              )}
            </div>
          </form>
        );
      })}

      {c.permissions.length > 0 && (
        <div>
          <p className="small">{t("settings.capability.permissions")}</p>
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
                        t("settings.capability.done.revoked"),
                      )
                    }
                  >
                    {t.rich("settings.capability.revoke", {
                      detail: <span className="sr-only">{p.description}</span>,
                    })}
                  </button>
                ) : (
                  <span className="muted">{t("settings.capability.notGranted")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.data_categories.length > 0 && (
        <p className="muted small">
          {t("settings.capability.accesses", { list: joinList(t, c.data_categories) })}
        </p>
      )}
      <Feedback error={error} saved={saved} />
    </details>
  );
}

/** Retention choices in days; the empty value keeps data until the user deletes it. */
const RETENTION_DAYS = [1, 7, 30, 90] as const;

/**
 * A report a user can paste into a bug report (PRD v2.0 §21). Core builds it from an allow-list, so
 * it is shown in full before anyone copies it: nothing here is hidden from the person sharing it.
 */
function SupportSettings() {
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t("common.error.coreUnreachable"));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report ?? "");
      setCopied(t("settings.support.copied"));
    } catch {
      setCopied(t("settings.support.copyFailed"));
    }
  };

  return (
    <section aria-labelledby="support-h" className="card">
      <h2 id="support-h" className="h3">
        {t("settings.support.title")}
      </h2>
      <p className="small">{t("settings.support.intro")}</p>
      <div className="button-row wrap">
        <button type="button" className="btn" disabled={busy} onClick={() => void show()}>
          {report === null ? t("settings.support.show") : t("settings.support.refresh")}
        </button>
        {report !== null && (
          <button type="button" className="btn" onClick={() => void copy()}>
            {t("settings.support.copy")}
          </button>
        )}
      </div>
      {report !== null && (
        <label className="field">
          {t("settings.support.reportLabel")}
          <textarea className="report" readOnly rows={12} value={report} />
        </label>
      )}
      <Feedback error={error} saved={copied} />
    </section>
  );
}

function PrivacySettings() {
  const t = useT();
  const { data: inv, error: loadError, reload } = usePrivacy();
  const { run, busy, error } = useAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (loadError) return <p className="error-text">{loadError}</p>;
  if (!inv) return null;

  /** A kind of data as a heading ("Activity history") or inside a sentence ("activity history"). */
  const dataName = (id: string, form: "data" | "what") => {
    const key = `settings.privacy.${form}.${id}`;
    return isMessageKey(key) ? t(key) : id;
  };
  const retentionChoices: [string, string][] = [
    ["", t("settings.privacy.retention.forever")],
    ...RETENTION_DAYS.map((days): [string, string] => [
      String(days),
      t("settings.privacy.retention.days", { days }),
    ]),
    ["365", t("settings.privacy.retention.year")],
  ];

  const setRetention = async (id: string, value: string) => {
    if (await run("POST", "/api/privacy/retention", { [id]: value ? Number(value) : null })) {
      setSaved(t("settings.privacy.retentionUpdated", { label: dataName(id, "data") }));
    }
    await reload();
  };
  const remove = async (id: string) => {
    const r = (await run("POST", "/api/privacy/delete", { data: id, confirm: true })) as
      { deleted: number } | undefined;
    setConfirm(null);
    if (r) {
      const key = `settings.privacy.deleted.${id}`;
      setSaved(t(isMessageKey(key) ? key : "settings.privacy.deleted.other", { count: r.deleted }));
    }
    await reload();
  };

  return (
    <section aria-labelledby="privacy-h" className="card">
      <h2 id="privacy-h" className="h3">
        {t("settings.privacy.title")}
      </h2>
      <p className="small">
        {t.rich("settings.privacy.location", {
          location: <code className="break">{inv.location}</code>,
        })}
      </p>
      <ul className="privacy-list">
        {inv.data.map((d) => (
          <li key={d.id}>
            <div>
              <strong>{dataName(d.id, "data")}</strong>{" "}
              <span className="muted small">
                {t("settings.privacy.stored", { count: formatNumber(d.count) })}
              </span>
              <p className="muted small">{d.description}</p>
            </div>
            <label className="field">
              {t("settings.privacy.keep")}
              <select
                value={d.retention_days === null ? "" : String(d.retention_days)}
                disabled={busy}
                onChange={(e) => void setRetention(d.id, e.target.value)}
              >
                {retentionChoices.map(([v, label]) => (
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
                  {t("settings.privacy.confirmDelete", { what: dataName(d.id, "what") })}
                </button>
                <button type="button" className="btn" onClick={() => setConfirm(null)}>
                  {t("common.button.cancel")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-danger-outline"
                disabled={d.count === 0}
                onClick={() => setConfirm(d.id)}
              >
                {t("settings.privacy.deleteAll")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {t.rich("settings.privacy.audit", {
          label: <strong>{t("settings.privacy.auditLog")}</strong>,
          count: inv.audit_log.count,
          description: inv.audit_log.description,
        })}
      </p>
      <p className="small">
        <strong>{t("settings.privacy.credentialsLabel")}</strong>{" "}
        {inv.credentials.length === 0
          ? t("settings.privacy.credentialsNone")
          : joinList(
              t,
              inv.credentials.map((c) => `${c.capability} ${c.name} (${c.stored_in})`),
            )}
      </p>
      <p className="small">
        <strong>{t("settings.privacy.telemetryLabel")}</strong>{" "}
        {inv.telemetry === "none" ? t("settings.privacy.telemetryNone") : inv.telemetry}
      </p>
      <p className="small">
        <strong>{t("settings.privacy.externalAiLabel")}</strong> {inv.external_ai}
      </p>
      <Feedback error={error} saved={saved} />
    </section>
  );
}
