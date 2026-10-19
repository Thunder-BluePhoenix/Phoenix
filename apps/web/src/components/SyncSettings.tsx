// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useClient } from "../core/context";
import { formatNumber } from "../core/format";
import { useAction } from "../core/hooks";
import type { SyncDataClass, SyncStatus } from "../core/types";
import { useT } from "../i18n";
import type { Translate } from "../i18n/store";
import { Feedback } from "./Feedback";

type ConfigureResult = SyncStatus & { recovery_key?: string };
type Choice = { id: string; scope: string; choice: "local" | "remote"; remoteMissing: boolean };
type Delete = { id: string; scope: string };
const CLASSES: SyncDataClass[] = ["preference", "context", "project_profile"];
type AdapterKey = "pet.settings.reduced_motion" | "retrieval.settings.k";
type AdapterSource = {
  key: AdapterKey;
  selected: boolean;
  current: unknown;
  revision: string | null;
  available: boolean;
};
type AdapterStatus = SyncStatus & {
  adapter_keys?: AdapterKey[];
  adapter_sources?: AdapterSource[];
};

function relayDisplay(endpoint: string | null, t: Translate): string {
  if (!endpoint) return t("automation.sync.relayNone");
  try {
    const url = new URL(endpoint);
    return url.origin;
  } catch {
    return t("automation.sync.relayUnknown");
  }
}

/** Explicit opt-in only. Reading status cannot connect to a relay or send sync records. */
export function SyncSettingsSection() {
  const t = useT();
  const client = useClient();
  const { run, busy, error: actionError } = useAction();
  const [status, setStatus] = useState<AdapterStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [restoreKey, setRestoreKey] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [project, setProject] = useState("");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [deletion, setDeletion] = useState<Delete | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [applySource, setApplySource] = useState<AdapterSource | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await client.request<AdapterStatus>("GET", "/api/sync");
      setApplySource(null);
      setStatus(next);
      setLoadError(null);
    } catch {
      setStatus(null);
      setApplySource(null);
      setLoadError(t("automation.sync.unavailable"));
    }
  }, [client, t]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const configure = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setRecoveryKey(null);
    const result = await run<ConfigureResult>("POST", "/api/sync/configure", {
      endpoint,
      relay_token: token,
      ...(restoreKey ? { recovery_key: restoreKey } : {}),
    });
    // Keep neither credential in the form after a submission, including on failure.
    setToken("");
    setRestoreKey("");
    if (result) {
      const { recovery_key } = result;
      await reload();
      setEndpoint("");
      setRecoveryKey(recovery_key ?? null);
      setMessage(t("automation.sync.configured"));
    }
  };
  const change = async (path: string, body: object, success: string) => {
    setMessage(null);
    const next = await run<SyncStatus>("POST", path, body);
    if (next) {
      setStatus(next);
      setMessage(success);
    }
    return next !== undefined;
  };
  const exclude = (projects: string[], classes: SyncDataClass[]) =>
    change(
      "/api/sync/exclusions",
      { excluded_projects: projects, excluded_classes: classes },
      t("automation.sync.exclusionsSaved"),
    );
  const selectAdapter = async (keys: AdapterKey[]) => {
    setMessage(null);
    setApplySource(null);
    const result = await run("POST", "/api/sync/adapter", { keys });
    if (result) {
      await reload();
      setMessage(t("automation.sync.adapterSaved"));
    }
  };
  const applyAdapter = async () => {
    if (!applySource?.revision) return;
    const result = await run("POST", "/api/sync/adapter/apply", {
      key: applySource.key,
      revision: applySource.revision,
      current: applySource.current,
    });
    if (result) {
      await reload();
      setApplySource(null);
      setMessage(t("automation.sync.adapterApplied"));
    }
  };
  const publishAdapter = async (key: AdapterKey) => {
    setMessage(null);
    setApplySource(null);
    const result = await run("POST", "/api/sync/adapter", {
      keys: status?.adapter_keys ?? [],
      refresh: key,
    });
    if (result) {
      await reload();
      setMessage(t("automation.sync.adapterPublished"));
    }
  };
  const sync = async () => {
    setMessage(null);
    setApplySource(null);
    const next = await run<SyncStatus>("POST", "/api/sync/run");
    if (next) {
      await reload();
      setMessage(
        next.pending
          ? t("automation.sync.syncedPending", { pending: formatNumber(next.pending) })
          : t("automation.sync.syncedDone"),
      );
    }
  };
  const resolve = async () => {
    if (!choice) return;
    setApplySource(null);
    const result = await run("POST", "/api/sync/items/resolve", {
      id: choice.id,
      scope: choice.scope,
      choice: choice.choice,
    });
    if (result) {
      setChoice(null);
      setMessage(
        choice.remoteMissing && choice.choice === "remote"
          ? t("automation.sync.resolvedDeletion")
          : t("automation.sync.resolvedChoice"),
      );
      await reload();
    }
  };
  const remove = async () => {
    if (!deletion) return;
    const result = await run("POST", "/api/sync/items/delete", { ...deletion, confirm: true });
    if (result) {
      setDeletion(null);
      setMessage(t("automation.sync.deletionQueued"));
      await reload();
    }
  };

  return (
    <section aria-labelledby="sync-h" className="card">
      <h2 id="sync-h" className="h3">
        {t("automation.sync.title")}
      </h2>
      <p className="muted small">{t("automation.sync.intro")}</p>
      {loadError && <Feedback error={loadError} />}
      {status && (
        <>
          <p role="status">
            {t(status.enabled ? "automation.sync.statusOn" : "automation.sync.statusOff", {
              pending: formatNumber(status.pending),
              conflicts: status.conflicts,
            })}
          </p>
          <p className="muted small">{t("automation.sync.chooseExclusions")}</p>
          <fieldset disabled={busy}>
            <legend>{t("automation.sync.excludeClasses")}</legend>
            {CLASSES.map((dataClass) => (
              <label className="choice" key={dataClass}>
                <input
                  type="checkbox"
                  checked={status.excluded_classes.includes(dataClass)}
                  onChange={() =>
                    void exclude(
                      status.excluded_projects,
                      status.excluded_classes.includes(dataClass)
                        ? status.excluded_classes.filter((c) => c !== dataClass)
                        : [...status.excluded_classes, dataClass],
                    )
                  }
                />
                {t(`automation.sync.class.${dataClass}`)}
              </label>
            ))}
          </fieldset>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = project.trim();
              if (name && !status.excluded_projects.includes(name))
                void exclude([...status.excluded_projects, name], status.excluded_classes);
              setProject("");
            }}
          >
            <label className="field">
              {t("automation.sync.excludeProject")}
              <input value={project} onChange={(e) => setProject(e.target.value)} />
            </label>
            <button className="btn" type="submit" disabled={busy || !project.trim()}>
              {t("automation.sync.excludeProjectButton")}
            </button>
          </form>
          {status.excluded_projects.length > 0 && (
            <ul>
              {status.excluded_projects.map((name) => (
                <li key={name}>
                  {name}{" "}
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void exclude(
                        status.excluded_projects.filter((p) => p !== name),
                        status.excluded_classes,
                      )
                    }
                  >
                    {t("automation.sync.removeExclusion", { name })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <fieldset disabled={busy || !status.enabled}>
            <legend>{t("automation.sync.adapterLegend")}</legend>
            <p className="muted small">{t("automation.sync.adapterNote")}</p>
            {(["pet.settings.reduced_motion", "retrieval.settings.k"] as const).map((key) => (
              <label className="choice" key={key}>
                <input
                  type="checkbox"
                  checked={(status.adapter_keys ?? []).includes(key)}
                  onChange={() =>
                    void selectAdapter(
                      (status.adapter_keys ?? []).includes(key)
                        ? (status.adapter_keys ?? []).filter((selected) => selected !== key)
                        : [...(status.adapter_keys ?? []), key],
                    )
                  }
                />
                {key === "pet.settings.reduced_motion"
                  ? t("automation.sync.adapter.reducedMotion")
                  : t("automation.sync.adapter.searchCount")}
              </label>
            ))}
          </fieldset>
          {status.enabled &&
            (status.adapter_keys ?? []).map((key) => (
              <button
                className="btn"
                type="button"
                key={key}
                disabled={busy}
                onClick={() => void publishAdapter(key)}
              >
                {t("automation.sync.publish", { key })}
              </button>
            ))}
          {status.enabled &&
            (status.adapter_sources ?? [])
              .filter((source) => source.selected && source.available)
              .map((source) => (
                <div key={source.key}>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => setApplySource(source)}
                  >
                    {t("automation.sync.reviewApply", { key: source.key })}
                  </button>
                </div>
              ))}
          {applySource && (
            <div role="group" aria-label={t("automation.sync.applyPreview")}>
              <p>
                {t("automation.sync.applyText", {
                  key: applySource.key,
                  revision: applySource.revision ?? "",
                })}
              </p>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => void applyAdapter()}
              >
                {t("automation.sync.confirmApply")}
              </button>{" "}
              <button className="btn" type="button" onClick={() => setApplySource(null)}>
                {t("automation.sync.cancelApply")}
              </button>
            </div>
          )}
          {status.enabled ? (
            <>
              <p className="small">
                {t("automation.sync.relayLine", {
                  relay: relayDisplay(status.endpoint, t),
                  identity: status.identity ?? t("automation.sync.identityNone"),
                })}
              </p>
              <p className="muted small">{t("automation.sync.identityNote")}</p>
              <div className="button-row wrap">
                <button className="btn" type="button" disabled={busy} onClick={() => void sync()}>
                  {t("automation.sync.syncNow")}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void change("/api/sync/disable", {}, t("automation.sync.turnedOff"))
                  }
                >
                  {t("automation.sync.turnOff")}
                </button>
              </div>
              <p className="muted small">{t("automation.sync.offlineNote")}</p>
              <h3 className="h3">{t("automation.sync.items")}</h3>
              <p className="muted small">{t("automation.sync.itemsNote")}</p>
              {status.items.length === 0 ? (
                <p>{t("automation.sync.noItems")}</p>
              ) : (
                <ul>
                  {status.items.map((item) => (
                    <li key={`${item.scope}:${item.id}`}>
                      {t.rich("automation.sync.itemLine", {
                        id: <strong>{item.id}</strong>,
                        dataClass: item.data_class,
                        owner: item.owner,
                        scope: item.scope,
                        project: item.project ?? t("automation.sync.projectNone"),
                        revision: item.revision,
                        updated: item.updated_at || t("automation.sync.updatedUnknown"),
                        state: item.deleted
                          ? item.pending
                            ? t("automation.sync.state.deletionQueued")
                            : t("automation.sync.state.deleted")
                          : item.pending
                            ? t("automation.sync.state.queued")
                            : t("automation.sync.state.synced"),
                      })}
                      {item.conflict && (
                        <div>
                          <p role="alert">
                            {item.conflict === "remote_missing"
                              ? t("automation.sync.conflictMissing")
                              : t("automation.sync.conflictRemote", {
                                  revision: item.conflict.revision,
                                  updated:
                                    item.conflict.updated_at || t("automation.sync.updatedUnknown"),
                                })}
                          </p>
                          <button
                            className="btn"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setChoice({
                                id: item.id,
                                scope: item.scope,
                                choice: "local",
                                remoteMissing: item.conflict === "remote_missing",
                              })
                            }
                          >
                            {t("automation.sync.reviewKeepLocal", { id: item.id })}
                          </button>{" "}
                          <button
                            className="btn"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setChoice({
                                id: item.id,
                                scope: item.scope,
                                choice: "remote",
                                remoteMissing: item.conflict === "remote_missing",
                              })
                            }
                          >
                            {item.conflict === "remote_missing"
                              ? t("automation.sync.reviewAcceptDeletion", { id: item.id })
                              : t("automation.sync.reviewKeepRemote", { id: item.id })}
                          </button>
                        </div>
                      )}
                      {!item.deleted && (
                        <div>
                          <button
                            className="btn"
                            type="button"
                            disabled={busy}
                            onClick={() => setDeletion({ id: item.id, scope: item.scope })}
                          >
                            {t("automation.sync.reviewDeletion", { id: item.id })}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {choice && (
                <div role="group" aria-label={t("automation.sync.resolutionPreview")}>
                  <p>
                    {t("automation.sync.previewFor", { id: choice.id, scope: choice.scope })}{" "}
                    {choice.remoteMissing
                      ? choice.choice === "remote"
                        ? t("automation.sync.previewAcceptDeletion")
                        : t("automation.sync.previewRestore")
                      : choice.choice === "remote"
                        ? t("automation.sync.previewKeepRemote")
                        : t("automation.sync.previewKeepLocal")}{" "}
                    {t("automation.sync.previewTail")}
                  </p>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve()}
                  >
                    {choice.remoteMissing && choice.choice === "remote"
                      ? t("automation.sync.confirmAcceptDeletion")
                      : choice.remoteMissing
                        ? t("automation.sync.confirmRestore")
                        : choice.choice === "remote"
                          ? t("automation.sync.confirmKeepRemote")
                          : t("automation.sync.confirmKeepLocal")}
                  </button>{" "}
                  <button className="btn" type="button" onClick={() => setChoice(null)}>
                    {t("automation.sync.cancelResolution")}
                  </button>
                </div>
              )}
              {deletion && (
                <div role="group" aria-label={t("automation.sync.deletionConfirmation")}>
                  <p>
                    {t("automation.sync.deletionText", { id: deletion.id, scope: deletion.scope })}
                  </p>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    {t("automation.sync.confirmDeletion")}
                  </button>{" "}
                  <button className="btn" type="button" onClick={() => setDeletion(null)}>
                    {t("automation.sync.cancelDeletion")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <form className="settings-form" onSubmit={(e) => void configure(e)}>
              <label className="field">
                {t("automation.sync.relayUrl")}
                <input
                  type="url"
                  required
                  pattern="https://.*"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://relay.example"
                />
              </label>
              <label className="field">
                {t("automation.sync.relayToken")}
                <input
                  type="password"
                  required
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <label className="field">
                {t("automation.sync.restoreKey")}
                <input
                  type="password"
                  autoComplete="off"
                  value={restoreKey}
                  onChange={(e) => setRestoreKey(e.target.value)}
                />
              </label>
              <p className="warning-text small">{t("automation.sync.optInNote")}</p>
              <button className="btn" type="submit" disabled={busy}>
                {t("automation.sync.configure")}
              </button>
            </form>
          )}
          {recoveryKey && (
            <div role="group" aria-label={t("automation.sync.recoveryGroup")}>
              <p className="warning-text">{t("automation.sync.recoveryText")}</p>
              <code>{recoveryKey}</code>{" "}
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(recoveryKey);
                }}
              >
                {t("automation.sync.copyKey")}
              </button>{" "}
              <button className="btn" type="button" onClick={() => setRecoveryKey(null)}>
                {t("automation.sync.savedKey")}
              </button>
            </div>
          )}
          <button className="btn" type="button" disabled={busy} onClick={() => void reload()}>
            {t("automation.sync.refresh")}
          </button>
        </>
      )}
      <Feedback error={actionError} saved={message} />
    </section>
  );
}
