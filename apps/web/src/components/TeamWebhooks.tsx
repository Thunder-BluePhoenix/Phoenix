// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { useAction } from "../core/hooks";
import {
  cleanLabel,
  eventTypesProblem,
  MAX_WEBHOOK_EVENT_TYPES,
  MAX_WEBHOOK_SOURCES,
  sourceIdProblem,
  splitEventTypes,
  TEAM_WEBHOOK_SOURCES_PATH,
  TEAM_WEBHOOKS_PATH,
  useTeamWebhooks,
  WEBHOOK_NAMESPACES,
  type WebhookSource,
  type WebhookSourceSecret,
  type WebhookStatus,
} from "../core/team-webhooks";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

/** What the one-time panel holds. It lives only in this component's state and is dropped on "done". */
interface OneTimeSecret {
  id: string;
  path: string;
  secret: string;
}

/**
 * Phase 92: incoming webhook sources. Core signs nothing here and returns a source's secret exactly
 * once, when it is created; this section shows it once, in a panel that can be dismissed, and keeps it
 * nowhere else (not in the list, not in storage, not in a log). Names come from Core and are untrusted
 * text: they are cleaned and rendered as text.
 */
export function TeamWebhooksSection() {
  const t = useT();
  const { load, reload, applyStatus } = useTeamWebhooks();
  return (
    <section className="card" aria-labelledby="team-webhooks-h">
      <h2 id="team-webhooks-h">{t("teamWebhooks.title")}</h2>
      {load.phase === "loading" && <p className="small">{t("common.status.loading")}</p>}
      {load.phase === "absent" && <p className="small">{t("teamWebhooks.notAvailable")}</p>}
      {load.phase === "failed" && <Feedback error={load.message ?? t("teamWebhooks.loadFailed")} />}
      {load.phase === "ready" && (
        <Sources status={load.status} onStatus={applyStatus} onChanged={reload} />
      )}
    </section>
  );
}

function Sources({
  status,
  onStatus,
  onChanged,
}: {
  status: WebhookStatus;
  onStatus: (status: WebhookStatus) => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const ids = useId();
  const { run, busy, error } = useAction();
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const setMaster = async (enabled: boolean) => {
    const next = await run<WebhookStatus>("PUT", TEAM_WEBHOOKS_PATH, { enabled });
    if (next) onStatus(next);
  };

  const remove = async (source: WebhookSource) => {
    const next = await run<WebhookStatus>(
      "DELETE",
      `${TEAM_WEBHOOK_SOURCES_PATH}/${encodeURIComponent(source.id)}`,
    );
    if (next) {
      setConfirming(null);
      // A deleted source's secret is useless; do not keep showing it.
      if (secret?.id === source.id) setSecret(null);
      onStatus(next);
    }
  };

  const created = (made: WebhookSourceSecret) => {
    setCopyNote(null);
    setSecret({ id: made.source.id, path: made.source.path, secret: made.secret });
    void onChanged();
  };

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.secret);
      setCopyNote(t("teamWebhooks.secret.copied"));
    } catch {
      setCopyNote(t("teamWebhooks.secret.copyFailed"));
    }
  };

  const dismiss = () => {
    setSecret(null);
    setCopyNote(null);
  };

  return (
    <div>
      <p>{t("teamWebhooks.intro")}</p>
      <label className="choice">
        <input
          type="checkbox"
          checked={status.enabled}
          disabled={busy}
          onChange={(event) => void setMaster(event.target.checked)}
        />
        {t("teamWebhooks.master")}
      </label>

      {secret && (
        <div role="dialog" aria-modal="false" aria-labelledby={`${ids}-secret-h`}>
          <h3 id={`${ids}-secret-h`}>
            {t("teamWebhooks.secret.title", { id: cleanLabel(secret.id) })}
          </h3>
          <p className="error-text small">{t("teamWebhooks.secret.warning")}</p>
          <label className="field" htmlFor={`${ids}-secret-path`}>
            {t("teamWebhooks.secret.path")}
            <input id={`${ids}-secret-path`} type="text" readOnly value={secret.path} />
          </label>
          <label className="field" htmlFor={`${ids}-secret-value`}>
            {t("teamWebhooks.secret.label")}
            <input
              id={`${ids}-secret-value`}
              type="text"
              readOnly
              autoComplete="off"
              spellCheck={false}
              value={secret.secret}
            />
          </label>
          <div className="button-row wrap">
            <button type="button" className="btn" onClick={() => void copy()}>
              {t("teamWebhooks.secret.copy")}
            </button>
            <button type="button" className="btn btn-primary" onClick={dismiss}>
              {t("teamWebhooks.secret.done")}
            </button>
          </div>
          {copyNote && (
            <p className="small" role="status">
              {copyNote}
            </p>
          )}
        </div>
      )}

      <h3>{t("teamWebhooks.sources.title")}</h3>
      {status.sources.length === 0 ? (
        <p className="small">{t("teamWebhooks.sources.none")}</p>
      ) : (
        <ul>
          {status.sources.map((source) => {
            const name = cleanLabel(source.id);
            return (
              <li key={source.id}>
                <div>
                  <code>{name}</code>{" "}
                  <span className="small">
                    {t(source.enabled ? "common.status.enabled" : "common.status.disabled")}
                  </span>
                </div>
                <div className="small">
                  {t("teamWebhooks.row.path", { path: cleanLabel(source.path) })}
                </div>
                <div className="small">
                  {t("teamWebhooks.row.types", {
                    types: source.eventTypes.map(cleanLabel).join(t("teamStatus.listSeparator")),
                  })}
                </div>
                <div className="small">
                  {source.lastAcceptedAt === null
                    ? t("teamWebhooks.row.never")
                    : t("teamWebhooks.row.last", { time: cleanLabel(source.lastAcceptedAt) })}
                </div>
                {confirming === source.id ? (
                  <div className="button-row wrap">
                    <span className="small">{t("teamWebhooks.delete.ask", { id: name })}</span>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => void remove(source)}
                    >
                      {t("common.button.confirm")}
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirming(null)}>
                      {t("common.button.cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger-outline"
                    disabled={busy}
                    aria-label={t("teamWebhooks.delete.label", { id: name })}
                    onClick={() => setConfirming(source.id)}
                  >
                    {t("common.button.delete")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CreateForm
        count={status.sources.length}
        // One secret at a time: the panel above must be dismissed before another source is made.
        locked={secret !== null}
        onCreated={created}
      />
      <Feedback error={error} />
    </div>
  );
}

function CreateForm({
  count,
  locked,
  onCreated,
}: {
  count: number;
  locked: boolean;
  onCreated: (made: WebhookSourceSecret) => void;
}) {
  const t = useT();
  const ids = useId();
  const { run, busy, error } = useAction();
  const [id, setId] = useState("");
  const [typesText, setTypesText] = useState("");

  const name = id.trim();
  const types = splitEventTypes(typesText);
  const idProblem = sourceIdProblem(name);
  const typesProblem = eventTypesProblem(types);
  const full = count >= MAX_WEBHOOK_SOURCES;
  const namespaces = WEBHOOK_NAMESPACES.join(t("teamStatus.listSeparator"));

  const typesMessage =
    typesProblem === "tooMany"
      ? t("teamWebhooks.create.typesTooMany", { max: MAX_WEBHOOK_EVENT_TYPES })
      : typesProblem === "invalid"
        ? t("teamWebhooks.create.typesInvalid")
        : typesProblem === "namespace"
          ? t("teamWebhooks.create.typesNamespace", { namespaces })
          : null;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (idProblem !== null || typesProblem !== null || full || locked) return;
    const made = await run<WebhookSourceSecret>("POST", TEAM_WEBHOOK_SOURCES_PATH, {
      id: name,
      eventTypes: types,
    });
    if (made) {
      setId("");
      setTypesText("");
      onCreated(made);
    }
  };

  return (
    <form className="settings-form" onSubmit={(event) => void create(event)}>
      <h3>{t("teamWebhooks.create.title")}</h3>
      <label className="field" htmlFor={`${ids}-id`}>
        {t("teamWebhooks.create.id")}
        <input
          id={`${ids}-id`}
          type="text"
          maxLength={32}
          autoComplete="off"
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
      </label>
      <p className={idProblem === "invalid" ? "error-text small" : "small"}>
        {t("teamWebhooks.create.idHint")}
      </p>
      <label className="field" htmlFor={`${ids}-types`}>
        {t("teamWebhooks.create.types")}
        <input
          id={`${ids}-types`}
          type="text"
          autoComplete="off"
          value={typesText}
          onChange={(event) => setTypesText(event.target.value)}
        />
      </label>
      <p className="small">{t("teamWebhooks.create.typesHint", { namespaces })}</p>
      {typesText.trim() !== "" && typesMessage && (
        <p className="error-text small" role="alert">
          {typesMessage}
        </p>
      )}
      {full && (
        <p className="small">{t("teamWebhooks.create.limit", { max: MAX_WEBHOOK_SOURCES })}</p>
      )}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={busy || locked || full || idProblem !== null || typesProblem !== null}
      >
        {t("teamWebhooks.create.submit")}
      </button>
      <Feedback error={error} />
    </form>
  );
}
