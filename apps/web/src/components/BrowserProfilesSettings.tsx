// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import {
  PROFILES_PATH,
  PULL_PATH,
  useLoaded,
  type BrowserExtension,
  type BrowserProfile,
  type RemoteProfile,
} from "../core/browser-profiles";
import { useAction } from "../core/hooks";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

const profilePath = (id: string) => `${PROFILES_PATH}/${encodeURIComponent(id)}`;

/** The profiles on this device (Phase 96). Nothing here opens a page: a profile is a record. */
export function BrowserProfilesSection() {
  const t = useT();
  const { state, reload } = useLoaded<{ profiles: BrowserProfile[] }>(PROFILES_PATH);
  const [purged, setPurged] = useState<string | null>(null);

  const removed = async (partition: string) => {
    setPurged(partition);
    await reload();
  };

  return (
    <section className="card" aria-labelledby="browser-profiles-h">
      <h2 id="browser-profiles-h">{t("browserProfiles.title")}</h2>
      <p>{t("browserProfiles.intro")}</p>
      {state.phase === "loading" && (
        <p className="muted" role="status">
          {t("common.status.loading")}
        </p>
      )}
      {state.phase === "unavailable" && <p role="status">{t("browserProfiles.unavailable")}</p>}
      {state.phase === "failed" && (
        <p className="error-text small" role="alert">
          {t("browserProfiles.loadFailed")}
        </p>
      )}
      {state.phase === "ready" && (
        <>
          <CreateProfile onCreated={reload} />
          <Feedback
            error={null}
            saved={purged === null ? null : t("browserProfiles.remove.done", { partition: purged })}
          />
          {state.data.profiles.length === 0 ? (
            <p className="muted">{t("browserProfiles.empty")}</p>
          ) : (
            <ul className="card-list" aria-label={t("browserProfiles.list")}>
              {state.data.profiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  onChanged={reload}
                  onRemoved={removed}
                />
              ))}
            </ul>
          )}
          <OtherDevices onAdopted={reload} />
          <p className="muted small">{t("browserProfiles.ext.admin")}</p>
        </>
      )}
    </section>
  );
}

function CreateProfile({ onCreated }: { onCreated: () => Promise<void> }) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    if (await run("POST", PROFILES_PATH, { name: trimmed })) {
      setName("");
      await onCreated();
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label className="field">
        {t("browserProfiles.create.name")}
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="button-row">
        <button type="submit" className="btn" disabled={busy || !trimmed}>
          {t("browserProfiles.create.submit")}
        </button>
      </div>
      <Feedback error={error} />
    </form>
  );
}

function ProfileCard({
  profile,
  onChanged,
  onRemoved,
}: {
  profile: BrowserProfile;
  onChanged: () => Promise<void>;
  onRemoved: (partition: string) => Promise<void>;
}) {
  const t = useT();
  const ids = useId();
  const { run, busy, error } = useAction();
  const [html, setHtml] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const path = profilePath(profile.id);

  const setSync = async (enabled: boolean) => {
    setNote(null);
    if (await run("PUT", `${path}/sync`, { enabled })) await onChanged();
  };

  const importBookmarks = async () => {
    setNote(null);
    const result = await run<{ imported: number; skipped: number }>(
      "POST",
      `${path}/bookmarks/import`,
      { html },
    );
    if (!result) return;
    setNote(
      t("browserProfiles.import.result", { imported: result.imported, skipped: result.skipped }),
    );
    setHtml("");
    await onChanged();
  };

  const publish = async () => {
    setNote(null);
    if (await run("POST", `${path}/publish`)) setNote(t("browserProfiles.publish.done"));
  };

  const remove = async () => {
    setNote(null);
    const result = await run<{ purge_partition: string }>("DELETE", path);
    setConfirming(false);
    if (result) await onRemoved(result.purge_partition);
  };

  return (
    <li className="card" aria-labelledby={`${ids}-h`}>
      <h3 id={`${ids}-h`} className="memory-text">
        {profile.name}
      </h3>
      <p className="muted small">
        {t("browserProfiles.counts", {
          bookmarks: profile.bookmarks,
          history: profile.history,
          extensions: profile.extensions,
        })}
      </p>
      <label>
        <input
          type="checkbox"
          checked={profile.syncEnabled}
          disabled={busy}
          onChange={(event) => void setSync(event.target.checked)}
        />{" "}
        {t("browserProfiles.sync.label")}
      </label>
      <p className="muted small">{t("browserProfiles.sync.hint")}</p>
      <div className="button-row wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || !profile.syncEnabled}
          onClick={() => void publish()}
        >
          {t("browserProfiles.publish.submit")}
        </button>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-html`}>{t("browserProfiles.import.label")}</label>
        <textarea
          id={`${ids}-html`}
          rows={4}
          value={html}
          aria-describedby={`${ids}-import-hint`}
          onChange={(event) => setHtml(event.target.value)}
        />
      </div>
      <p id={`${ids}-import-hint`} className="muted small">
        {t("browserProfiles.import.hint")}
      </p>
      <div className="button-row wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || html.trim() === ""}
          onClick={() => void importBookmarks()}
        >
          {t("browserProfiles.import.submit")}
        </button>
      </div>
      <ExtensionsPanel profileId={profile.id} onChanged={onChanged} />
      {confirming ? (
        <div role="group" aria-label={t("browserProfiles.remove.start")}>
          <p className="warning-text small memory-text">
            {t("browserProfiles.remove.ask", { name: profile.name })}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {t("common.button.confirm")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              {t("common.button.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="button-row">
          <button
            type="button"
            className="btn btn-danger-outline"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t("browserProfiles.remove.start")}
          </button>
        </div>
      )}
      <Feedback error={error} saved={note} />
    </li>
  );
}

function ExtensionsPanel({
  profileId,
  onChanged,
}: {
  profileId: string;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const path = `${profilePath(profileId)}/extensions`;
  const { state, replace } = useLoaded<{ extensions: BrowserExtension[] }>(path);
  const { run, busy, error } = useAction();
  const [asking, setAsking] = useState<string | null>(null);

  const approve = async (extension: string, approved: boolean) => {
    setAsking(approved ? extension : null);
    const result = await run<{ extensions: BrowserExtension[] }>(
      "PUT",
      `${path}/${encodeURIComponent(extension)}/approval`,
      { approved },
    );
    setAsking(null);
    if (result) replace(result);
  };

  const remove = async (extension: string) => {
    const result = await run<{ extensions: BrowserExtension[] }>(
      "DELETE",
      `${path}/${encodeURIComponent(extension)}`,
    );
    if (!result) return;
    replace(result);
    await onChanged();
  };

  return (
    <div>
      <h4 className="h5">{t("browserProfiles.ext.heading")}</h4>
      {state.phase === "failed" || state.phase === "unavailable" ? (
        <p className="error-text small" role="alert">
          {t("browserProfiles.ext.loadFailed")}
        </p>
      ) : state.phase === "ready" && state.data.extensions.length === 0 ? (
        <p className="muted small">{t("browserProfiles.ext.none")}</p>
      ) : state.phase === "ready" ? (
        <ul className="card-list">
          {state.data.extensions.map(({ manifest, approved }) => {
            const none = t("browserProfiles.ext.noneListed");
            return (
              <li key={manifest.id} className="card">
                <strong className="memory-text">{manifest.id}</strong>{" "}
                <span className="muted small">
                  {t("browserProfiles.ext.version", { version: manifest.version })}
                </span>{" "}
                <span className="small">
                  {t(approved ? "browserProfiles.ext.approved" : "browserProfiles.ext.notApproved")}
                </span>
                <p className="muted small memory-text">
                  {t("browserProfiles.ext.origins", {
                    origins: manifest.origins.length ? manifest.origins.join(", ") : none,
                  })}
                </p>
                <p className="muted small memory-text">
                  {t("browserProfiles.ext.permissions", {
                    permissions: manifest.permissions.length
                      ? manifest.permissions.join(", ")
                      : none,
                  })}
                </p>
                <div className="button-row wrap">
                  {approved ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={t("browserProfiles.ext.withdrawLabel", { id: manifest.id })}
                      onClick={() => void approve(manifest.id, false)}
                    >
                      {t("browserProfiles.ext.withdraw")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={t("browserProfiles.ext.approveLabel", { id: manifest.id })}
                      onClick={() => void approve(manifest.id, true)}
                    >
                      {t("browserProfiles.ext.approve")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    aria-label={t("browserProfiles.ext.removeLabel", { id: manifest.id })}
                    onClick={() => void remove(manifest.id)}
                  >
                    {t("browserProfiles.ext.remove")}
                  </button>
                </div>
                {asking === manifest.id && (
                  <p className="small" role="status">
                    {t("browserProfiles.ext.waiting")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <Feedback error={error} />
    </div>
  );
}

function OtherDevices({ onAdopted }: { onAdopted: () => Promise<void> }) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [remote, setRemote] = useState<RemoteProfile[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const check = async () => {
    setNote(null);
    const result = await run<{ remote: RemoteProfile[] }>("POST", PULL_PATH);
    if (result) setRemote(result.remote);
  };

  const adopt = async (item: RemoteProfile) => {
    setNote(null);
    const result = await run("POST", `${profilePath(item.id)}/adopt`, { revision: item.revision });
    if (!result) return;
    setRemote((current) => current?.filter((r) => r.id !== item.id) ?? null);
    setNote(t("browserProfiles.devices.adopted"));
    await onAdopted();
  };

  return (
    <div>
      <h3 className="h4">{t("browserProfiles.devices.heading")}</h3>
      <div className="button-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void check()}>
          {t("browserProfiles.devices.check")}
        </button>
      </div>
      {remote !== null &&
        (remote.length === 0 ? (
          <p className="muted small">{t("browserProfiles.devices.none")}</p>
        ) : (
          <ul className="card-list" aria-label={t("browserProfiles.devices.found")}>
            {remote.map((item) => (
              <li key={item.id} className="card-head">
                <span className="memory-text">{item.name}</span>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  aria-label={t("browserProfiles.devices.adoptLabel", { name: item.name })}
                  onClick={() => void adopt(item)}
                >
                  {t("browserProfiles.devices.adopt")}
                </button>
              </li>
            ))}
          </ul>
        ))}
      <Feedback error={error} saved={note} />
    </div>
  );
}
