// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useClient } from "../core/context";
import { useAction } from "../core/hooks";
import type { SyncDataClass, SyncStatus } from "../core/types";
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

function relayDisplay(endpoint: string | null): string {
  if (!endpoint) return "not configured";
  try {
    const url = new URL(endpoint);
    return url.origin;
  } catch {
    return "configured relay (URL unavailable)";
  }
}

/** Explicit opt-in only. Reading status cannot connect to a relay or send sync records. */
export function SyncSettingsSection() {
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
      setLoadError(
        "Sync settings are unavailable from Phoenix Core. This status request did not contact the relay.",
      );
    }
  }, [client]);
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
      setMessage(
        "Sync is configured. Queued records sync automatically while online; Sync now starts an immediate attempt.",
      );
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
      "Exclusions saved.",
    );
  const selectAdapter = async (keys: AdapterKey[]) => {
    setMessage(null);
    setApplySource(null);
    const result = await run("POST", "/api/sync/adapter", { keys });
    if (result) {
      await reload();
      setMessage(
        "Adapter selection saved. Newly selected current settings are staged; no other sources are included.",
      );
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
      setMessage("Selected synced setting applied locally.");
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
      setMessage("Current local setting staged for encrypted sync.");
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
          ? `${next.pending} item(s) still queued. Review status and conflicts below.`
          : "Sync finished. Review items and conflicts below.",
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
          ? "Remote deletion accepted. Local staged sync record is now deleted; nothing is queued for upload."
          : "Conflict choice saved. Pending changes sync automatically while online; Sync now starts an immediate attempt.",
      );
      await reload();
    }
  };
  const remove = async () => {
    if (!deletion) return;
    const result = await run("POST", "/api/sync/items/delete", { ...deletion, confirm: true });
    if (result) {
      setDeletion(null);
      setMessage("Deletion queued. The remote copy is not deleted until a successful sync.");
      await reload();
    }
  };

  return (
    <section aria-labelledby="sync-h" className="card">
      <h2 id="sync-h" className="h3">
        Encrypted sync
      </h2>
      <p className="muted small">
        Optional and off by default. Sync requires your own available HTTPS relay and relay
        authentication; Phoenix does not provide a hosted relay. Configuring is explicit opt-in: it
        sends nothing during setup, but queued records sync automatically while online afterward.
        Sync now starts an immediate attempt. The adapter stages only the two explicitly selected
        non-content settings; later local changes require Publish current. Meeting, person and
        memory text is never included by this adapter.
      </p>
      {loadError && <Feedback error={loadError} />}
      {status && (
        <>
          <p role="status">
            Sync is {status.enabled ? "on" : "off"}. {status.pending} queued; {status.conflicts}{" "}
            conflict(s).
          </p>
          <p className="muted small">
            Choose exclusions before opting in; excluded classes and projects are not uploaded.
          </p>
          <fieldset disabled={busy}>
            <legend>Exclude data classes</legend>
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
                {dataClass.replaceAll("_", " ")}
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
              Exclude project by name
              <input value={project} onChange={(e) => setProject(e.target.value)} />
            </label>
            <button className="btn" type="submit" disabled={busy || !project.trim()}>
              Exclude project
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
                    Remove exclusion for {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <fieldset disabled={busy || !status.enabled}>
            <legend>Opt in existing settings individually</legend>
            <p className="muted small">
              Only account-owner-scoped reduced motion (preference) and search result count (context
              configuration) are eligible; there are no project-scoped sources. Selecting stages the
              current value. Publish a later local change explicitly. Incoming values remain staged
              until you review and confirm applying them locally. Excluding a class also removes its
              adapter selection when allowed; already published records must first be deleted and
              synced. Deselecting does not erase uploaded ciphertext; delete its synced item
              separately if needed.
            </p>
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
                  ? "Reduced motion preference"
                  : "Search result count metadata"}
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
                Publish current {key}
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
                    Review applying {source.key}
                  </button>
                </div>
              ))}
          {applySource && (
            <div role="group" aria-label="Setting apply preview">
              <p>
                Apply decrypted staged {applySource.key} revision {applySource.revision} to the
                existing local setting? It will replace the current value only after confirmation.
                Current and incoming values are hidden; identify the versions by source and
                revision, or cancel. A changed local value or staged revision invalidates this
                preview.
              </p>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => void applyAdapter()}
              >
                Confirm apply setting
              </button>{" "}
              <button className="btn" type="button" onClick={() => setApplySource(null)}>
                Cancel apply
              </button>
            </div>
          )}
          {status.enabled ? (
            <>
              <p className="small">
                Relay: {relayDisplay(status.endpoint)}. Identity:{" "}
                {status.identity ?? "not available"}. A reachable relay is required; this status
                does not prove the relay is available.
              </p>
              <p className="muted small">
                This identity represents the shared recovery-key account, not a distinct device.
                Devices with the same key and relay token cannot be individually revoked, and relay
                replay protection is not established.
              </p>
              <div className="button-row wrap">
                <button className="btn" type="button" disabled={busy} onClick={() => void sync()}>
                  Sync now
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void change(
                      "/api/sync/disable",
                      {},
                      "Sync is off. Queued records remain local.",
                    )
                  }
                >
                  Turn sync off
                </button>
              </div>
              <p className="muted small">
                If the relay is offline, a manual sync reports an error and pending items remain
                queued for later retry. No silent overwrite occurs on conflicts.
              </p>
              <h3 className="h3">Synced items</h3>
              <p className="muted small">
                Metadata only; item contents and conflicting values are not displayed.
              </p>
              {status.items.length === 0 ? (
                <p>No sync records staged.</p>
              ) : (
                <ul>
                  {status.items.map((item) => (
                    <li key={`${item.scope}:${item.id}`}>
                      <strong>{item.id}</strong> · {item.data_class} · owner {item.owner} · scope{" "}
                      {item.scope} · project {item.project ?? "none"} · revision {item.revision} ·
                      updated {item.updated_at || "unknown"} ·{" "}
                      {item.deleted
                        ? item.pending
                          ? "deletion queued"
                          : "deleted"
                        : item.pending
                          ? "queued"
                          : "synced"}
                      {item.conflict && (
                        <div>
                          <p role="alert">
                            {item.conflict === "remote_missing"
                              ? "Conflict: this record is missing on the relay. Keep local to restore it on the relay, or accept remote deletion to delete the local staged sync record. Nothing is overwritten automatically."
                              : `Conflict: remote revision ${item.conflict.revision}, updated ${item.conflict.updated_at || "unknown"}. Nothing is overwritten until you choose a side.`}
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
                            Review keeping local for {item.id}
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
                              ? `Review accepting remote deletion for ${item.id}`
                              : `Review keeping remote for ${item.id}`}
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
                            Review remote deletion for {item.id}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {choice && (
                <div role="group" aria-label="Conflict resolution preview">
                  <p>
                    Preview for {choice.id} ({choice.scope}):{" "}
                    {choice.remoteMissing
                      ? choice.choice === "remote"
                        ? "Accept remote deletion: delete the local staged sync record now; nothing is uploaded."
                        : "Restore missing remote: queue the local version for upload on the next successful sync."
                      : choice.choice === "remote"
                        ? "Keep remote: replace the local staged sync record with the remote version now."
                        : "Keep local: queue this version for upload on the next successful sync. A newer remote change will still require resolution."}{" "}
                    Item contents are hidden here; if you cannot identify the versions from
                    metadata, cancel. This cannot be undone here.
                  </p>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve()}
                  >
                    {choice.remoteMissing && choice.choice === "remote"
                      ? "Confirm accept remote deletion"
                      : choice.remoteMissing
                        ? "Confirm restore missing remote"
                        : `Confirm keep ${choice.choice}`}
                  </button>{" "}
                  <button className="btn" type="button" onClick={() => setChoice(null)}>
                    Cancel resolution
                  </button>
                </div>
              )}
              {deletion && (
                <div role="group" aria-label="Remote deletion confirmation">
                  <p>
                    Delete {deletion.id} ({deletion.scope}) from the relay? This queues a tombstone
                    locally; the remote copy is removed only after successful sync. This cannot be
                    undone here.
                  </p>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    Confirm remote deletion
                  </button>{" "}
                  <button className="btn" type="button" onClick={() => setDeletion(null)}>
                    Cancel deletion
                  </button>
                </div>
              )}
            </>
          ) : (
            <form className="settings-form" onSubmit={(e) => void configure(e)}>
              <label className="field">
                Relay HTTPS URL
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
                Relay authentication token
                <input
                  type="password"
                  required
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <label className="field">
                Existing recovery key (optional, for restoring an identity)
                <input
                  type="password"
                  autoComplete="off"
                  value={restoreKey}
                  onChange={(e) => setRestoreKey(e.target.value)}
                />
              </label>
              <p className="warning-text small">
                Explicit opt-in: configuring stores relay credentials locally and enables automatic
                sync of queued records while online. A new identity shows a recovery key once: save
                it immediately; it cannot be retrieved later. Reconfiguring after turning sync off
                reuses the locally stored identity when available. Never share your key with the
                relay operator.
              </p>
              <button className="btn" type="submit" disabled={busy}>
                Configure encrypted sync
              </button>
            </form>
          )}
          {recoveryKey && (
            <div role="group" aria-label="One-time recovery key">
              <p className="warning-text">
                Copy and store this recovery key in a safe place now. It is shown only once and
                cannot be retrieved later. Do not share it.
              </p>
              <code>{recoveryKey}</code>{" "}
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(recoveryKey);
                }}
              >
                Copy recovery key
              </button>{" "}
              <button className="btn" type="button" onClick={() => setRecoveryKey(null)}>
                I saved the key — dismiss
              </button>
            </div>
          )}
          <button className="btn" type="button" disabled={busy} onClick={() => void reload()}>
            Refresh sync status
          </button>
        </>
      )}
      <Feedback error={actionError} saved={message} />
    </section>
  );
}
