// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState, type FormEvent } from "react";
import {
  buildConfig,
  CHAT_APPROVALS_PATH,
  CHAT_SECRETS,
  chatSecretPath,
  MAX_DIGEST_MINUTES,
  MIN_DIGEST_MINUTES,
  providerReady,
  readForm,
  secretShapeOk,
  storedSecrets,
  useChatAction,
  type ChatAction,
  type ChatApprovalsForm,
  type ChatIdProviderForm,
  type ChatProviderForm,
  type ChatProviderId,
  type ChatSecretSpec,
} from "../core/chat-approvals";
import { useCapabilities } from "../core/hooks";
import type { CapabilityView } from "../core/types";
import { useT } from "../i18n";

/**
 * Chat approvals (Phase 86): which chat providers may answer or announce approvals, who may decide,
 * which projects are switched on, the optional digest, and the provider secrets. Everything starts
 * off. Secrets are write-only: what is typed is dropped from the page the moment it is sent
 * (accepted or not), nothing is ever read back, and the "stored" mark comes from Core's list of
 * secret names (set / not set), never from a value. Every error is a fixed, translated text.
 * Nothing here has been used with a real Slack, Discord or Teams.
 */
export function ChatApprovalsSection() {
  const t = useT();
  const { data: capabilities, reload } = useCapabilities();
  const action = useChatAction();
  const capability = capabilities.find((c) => c.id === "chat-approvals");

  return (
    <section className="card" aria-labelledby="chat-approvals-h">
      <h2 id="chat-approvals-h">{t("chatApprovals.title")}</h2>
      {capability === undefined ? (
        <p className="muted small">{t("chatApprovals.notAvailable")}</p>
      ) : (
        <>
          <p>{t("chatApprovals.intro")}</p>
          <p className="small">{t("chatApprovals.limits")}</p>
          <p className="small">{t("chatApprovals.noDm")}</p>
          {capability.status !== "enabled" && (
            <p className="warning-text small" role="note">
              {t("chatApprovals.capabilityOff")}{" "}
              {capability.status !== "disconnected" && (
                <button
                  type="button"
                  className="btn"
                  disabled={action.busy}
                  onClick={() =>
                    void action
                      .run(
                        "POST",
                        `${CHAT_APPROVALS_PATH}/enable`,
                        {},
                        "chatApprovals.error.capability",
                      )
                      .then(reload)
                  }
                >
                  {t("chatApprovals.enable")}
                </button>
              )}
            </p>
          )}
          <ConfigForm capability={capability} action={action} onSaved={reload} />
          <Secrets capability={capability} action={action} onChanged={reload} />
        </>
      )}
      {action.error !== null && (
        <p className="error-text small" role="alert">
          {t(action.error)}
        </p>
      )}
    </section>
  );
}

function ConfigForm({
  capability,
  action,
  onSaved,
}: {
  capability: CapabilityView;
  action: ChatAction;
  onSaved: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<ChatApprovalsForm>(() => readForm(capability.config));
  const [saved, setSaved] = useState(false);
  const change = (next: ChatApprovalsForm) => {
    setSaved(false);
    setForm(next);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const built = buildConfig(form, capability.config);
    if ("error" in built) {
      action.fail(built.error);
      return;
    }
    const done = await action.run(
      "POST",
      `${CHAT_APPROVALS_PATH}/config`,
      { config: built.config },
      "chatApprovals.error.save",
    );
    if (done === undefined) return;
    setSaved(true);
    onSaved();
  };

  return (
    <form noValidate onSubmit={(event) => void save(event)}>
      <IdProvider
        id="slack"
        form={form}
        onChange={(slack) => change({ ...form, slack })}
        busy={action.busy}
      />
      <IdProvider
        id="discord"
        form={form}
        onChange={(discord) => change({ ...form, discord })}
        busy={action.busy}
      />
      <fieldset disabled={action.busy}>
        <legend>{t("chatApprovals.provider.teams")}</legend>
        <p className="muted small">{t("chatApprovals.teamsNote")}</p>
        <Switches
          provider="teams"
          value={form.teams}
          onChange={(teams) => change({ ...form, teams })}
        />
        <p className="muted small" role="status">
          {providerReady(form, "teams") ? t("chatApprovals.ready") : t("chatApprovals.notReady")}
        </p>
      </fieldset>

      <fieldset disabled={action.busy}>
        <legend>{t("chatApprovals.projects.title")}</legend>
        <p className="muted small">{t("chatApprovals.projects.hint")}</p>
        <label>
          {t("chatApprovals.projects.label")}
          <br />
          <textarea
            rows={3}
            value={form.projects}
            spellCheck={false}
            onChange={(event) => change({ ...form, projects: event.target.value })}
          />
        </label>
      </fieldset>

      <fieldset disabled={action.busy}>
        <legend>{t("chatApprovals.digest.title")}</legend>
        <p className="muted small">{t("chatApprovals.digest.intro")}</p>
        <label className="choice">
          <input
            type="checkbox"
            checked={form.digestEnabled}
            onChange={(event) => change({ ...form, digestEnabled: event.target.checked })}
          />
          {t("chatApprovals.digest.enabled")}
        </label>{" "}
        <label>
          {t("chatApprovals.digest.interval")}{" "}
          <input
            type="number"
            inputMode="numeric"
            min={MIN_DIGEST_MINUTES}
            max={MAX_DIGEST_MINUTES}
            step={1}
            value={form.digestMinutes}
            onChange={(event) => change({ ...form, digestMinutes: event.target.value })}
          />
        </label>
        <p className="muted small">
          {t("chatApprovals.digest.hint", { min: MIN_DIGEST_MINUTES, max: MAX_DIGEST_MINUTES })}
        </p>
      </fieldset>

      <button type="submit" className="btn btn-primary" disabled={action.busy}>
        {t("chatApprovals.save")}
      </button>
      <span className="small" role="status">
        {" "}
        {saved ? t("chatApprovals.saved") : null}
      </span>
    </form>
  );
}

function Switches({
  provider,
  value,
  onChange,
}: {
  provider: ChatProviderId;
  value: ChatProviderForm;
  onChange: (next: ChatProviderForm) => void;
}) {
  const t = useT();
  const name = t(`chatApprovals.provider.${provider}`);
  return (
    <div>
      <label className="choice">
        <input
          type="checkbox"
          checked={value.enabled}
          aria-label={t("chatApprovals.enabledNamed", { name })}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        {t("chatApprovals.enabledNamed", { name })}
      </label>{" "}
      <label className="choice">
        <input
          type="checkbox"
          checked={value.notify}
          aria-label={t("chatApprovals.notifyNamed", { name })}
          onChange={(event) => onChange({ ...value, notify: event.target.checked })}
        />
        {t("chatApprovals.notify")}
      </label>{" "}
      <label className="choice">
        <input
          type="checkbox"
          checked={value.digest}
          aria-label={t("chatApprovals.digestNamed", { name })}
          onChange={(event) => onChange({ ...value, digest: event.target.checked })}
        />
        {t("chatApprovals.digest.send")}
      </label>
    </div>
  );
}

function IdProvider({
  id,
  form,
  onChange,
  busy,
}: {
  id: "slack" | "discord";
  form: ChatApprovalsForm;
  onChange: (next: ChatIdProviderForm) => void;
  busy: boolean;
}) {
  const t = useT();
  const value = form[id];
  const name = t(`chatApprovals.provider.${id}`);
  return (
    <fieldset disabled={busy}>
      <legend>{name}</legend>
      <Switches provider={id} value={value} onChange={(next) => onChange({ ...value, ...next })} />
      <p>
        <label>
          {t(id === "slack" ? "chatApprovals.workspace.slack" : "chatApprovals.workspace.discord")}{" "}
          <input
            type="text"
            value={value.workspace}
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            onChange={(event) => onChange({ ...value, workspace: event.target.value })}
          />
        </label>{" "}
        <label>
          {t(id === "slack" ? "chatApprovals.channel.slack" : "chatApprovals.channel.discord")}{" "}
          <input
            type="text"
            value={value.channel}
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            onChange={(event) => onChange({ ...value, channel: event.target.value })}
          />
        </label>
      </p>
      <label>
        {t("chatApprovals.approvers.label", { name })}
        <br />
        <textarea
          rows={2}
          value={value.approvers}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange({ ...value, approvers: event.target.value })}
        />
      </label>
      <p className="muted small">{t("chatApprovals.approvers.hint")}</p>
      <p className="muted small" role="status">
        {providerReady(form, id) ? t("chatApprovals.ready") : t("chatApprovals.notReady")}
      </p>
    </fieldset>
  );
}

function Secrets({
  capability,
  action,
  onChanged,
}: {
  capability: CapabilityView;
  action: ChatAction;
  onChanged: () => void;
}) {
  const t = useT();
  const stored = storedSecrets(capability.secrets);
  return (
    <>
      <h3 className="h3">{t("chatApprovals.cred.title")}</h3>
      <p className="small">{t("chatApprovals.cred.writeOnly")}</p>
      <ul className="card-list">
        {CHAT_SECRETS.map((spec) => (
          <li key={spec.name}>
            <SecretField
              spec={spec}
              stored={stored.has(spec.name)}
              action={action}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * One write-only secret. The typed value is cleared from state before the request is made, so it is
 * gone from the page whether Core accepts it or not; the field never receives a stored value.
 */
function SecretField({
  spec,
  stored,
  action,
  onChanged,
}: {
  spec: ChatSecretSpec;
  stored: boolean;
  action: ChatAction;
  onChanged: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const label = t(spec.label);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const sent = value;
    setValue("");
    if (sent === "") return;
    if (!secretShapeOk(spec, sent)) {
      action.fail("chatApprovals.error.credShape");
      return;
    }
    const done = await action.run(
      "POST",
      chatSecretPath(spec.name),
      { value: sent },
      "chatApprovals.error.cred",
    );
    if (done !== undefined) onChanged();
  };

  const remove = async () => {
    const done = await action.run(
      "DELETE",
      chatSecretPath(spec.name),
      undefined,
      "chatApprovals.error.cred",
    );
    if (done !== undefined) onChanged();
  };

  return (
    <form onSubmit={(event) => void send(event)} className="small">
      <label>
        {label}{" "}
        <input
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>{" "}
      <button type="submit" className="btn" disabled={action.busy || value === ""}>
        {t("chatApprovals.cred.save")}
      </button>{" "}
      <span className="muted" role="status" data-secret={spec.name}>
        {stored ? t("chatApprovals.cred.stored") : t("chatApprovals.cred.notStored")}
      </span>{" "}
      {stored && (
        <button
          type="button"
          className="btn"
          disabled={action.busy}
          aria-label={t("chatApprovals.cred.removeNamed", { name: label })}
          onClick={() => void remove()}
        >
          {t("chatApprovals.cred.remove")}
        </button>
      )}
    </form>
  );
}
