// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { useAction } from "../core/hooks";
import {
  isTeamKind,
  TEAM_KINDS,
  TEAM_LINK_PATH,
  TEAM_MEMBERS_PATH,
  TEAM_SHARING_PATH,
  useTeam,
  type TeamItem,
  type TeamKind,
  type TeamLink,
  type TeamStatus,
} from "../core/team";
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const KIND_NAME: Record<TeamKind, MessageKey> = {
  deploying: "teamStatus.kind.deploying",
  agent_run: "teamStatus.kind.agentRun",
  meeting: "teamStatus.kind.meeting",
};

const KIND_CONSENT: Record<TeamKind, MessageKey> = {
  deploying: "teamStatus.sharing.deploying",
  agent_run: "teamStatus.sharing.agentRun",
  meeting: "teamStatus.sharing.meeting",
};

/** The kinds in a list of items, as words; kinds this version does not know are left out. */
function useKindNames(items: readonly TeamItem[]): string {
  const t = useT();
  const kinds = items.map((item) => item.kind).filter(isTeamKind);
  return [...new Set(kinds)].map((kind) => t(KIND_NAME[kind])).join(t("teamStatus.listSeparator"));
}

/** Phase 92: share a coarse status (deploying, agent run, meeting) with teammates you added. Off by default. */
export function TeamSettingsSection() {
  const t = useT();
  const { load, reload, applyStatus } = useTeam();
  return (
    <section className="card" aria-labelledby="team-status-h">
      <h2 id="team-status-h">{t("teamStatus.title")}</h2>
      {load.phase === "loading" && <p className="small">{t("common.status.loading")}</p>}
      {load.phase === "absent" && <p className="small">{t("teamStatus.notAvailable")}</p>}
      {load.phase === "failed" && <Feedback error={load.message ?? t("teamStatus.loadFailed")} />}
      {load.phase === "ready" && (
        <>
          <LinkPanel link={load.link} onChanged={reload} />
          {load.status && <SharingPanel status={load.status} onStatus={applyStatus} />}
          {load.status && <MembersPanel status={load.status} onStatus={applyStatus} />}
          {load.status && <PresencePanel status={load.status} />}
        </>
      )}
    </section>
  );
}

function LinkPanel({ link, onChanged }: { link: TeamLink; onChanged: () => Promise<void> }) {
  const t = useT();
  const ids = useId();
  const { run, busy, error } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const shownUrl = url ?? link.url ?? "";
  const shownRoute = route ?? link.route ?? "";

  const turnOn = async (event: FormEvent) => {
    event.preventDefault();
    const address = shownUrl.trim();
    const wanted = shownRoute.trim();
    const body = wanted === "" ? { url: address } : { url: address, route: wanted };
    if (await run("POST", TEAM_LINK_PATH, body)) await onChanged();
  };

  const pause = async () => {
    if (await run("POST", `${TEAM_LINK_PATH}/pause`)) await onChanged();
  };

  const leave = async () => {
    setConfirmingLeave(false);
    if (await run("DELETE", TEAM_LINK_PATH)) {
      setUrl(null);
      setRoute(null);
      await onChanged();
    }
  };

  const state = link.enabled
    ? link.connected
      ? "teamStatus.state.connected"
      : "teamStatus.state.connecting"
    : "teamStatus.state.paused";

  return (
    <div>
      {link.self === null && !link.enabled && <p>{t("teamStatus.intro")}</p>}
      {(link.self !== null || link.enabled) && (
        <>
          <p>{t("teamStatus.state.line", { state: t(state) })}</p>
          {link.last_error && (
            <p className="error-text small" role="alert">
              {t("teamStatus.lastError", { error: link.last_error })}
            </p>
          )}
        </>
      )}
      {link.self !== null && (
        <>
          <label className="field" htmlFor={`${ids}-id`}>
            {t("teamStatus.self.id")}
            <input id={`${ids}-id`} type="text" readOnly value={link.self.id} />
          </label>
          <label className="field" htmlFor={`${ids}-key`}>
            {t("teamStatus.self.publicKey")}
            <input id={`${ids}-key`} type="text" readOnly value={link.self.public_key} />
          </label>
          <p className="small">{t("teamStatus.self.hint")}</p>
        </>
      )}
      {link.enabled && link.route && (
        <label className="field" htmlFor={`${ids}-route-shown`}>
          {t("teamStatus.route.shown")}
          <input id={`${ids}-route-shown`} type="text" readOnly value={link.route} />
        </label>
      )}
      {!link.enabled && (
        <form className="settings-form" onSubmit={(event) => void turnOn(event)}>
          <label className="field" htmlFor={`${ids}-url`}>
            {t("teamStatus.relay.label")}
            <input
              id={`${ids}-url`}
              type="text"
              value={shownUrl}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="field" htmlFor={`${ids}-route`}>
            {t("teamStatus.route.label")}
            <input
              id={`${ids}-route`}
              type="text"
              value={shownRoute}
              onChange={(event) => setRoute(event.target.value)}
            />
          </label>
          <p className="small">{t("teamStatus.route.hint")}</p>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || shownUrl.trim() === ""}
          >
            {t(link.self === null ? "teamStatus.turnOn" : "teamStatus.resume")}
          </button>
        </form>
      )}
      {(link.enabled || link.self !== null) &&
        (confirmingLeave ? (
          <div className="button-row wrap">
            <span className="small">{t("teamStatus.leave.ask")}</span>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void leave()}
            >
              {t("common.button.confirm")}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmingLeave(false)}>
              {t("common.button.cancel")}
            </button>
          </div>
        ) : (
          <div className="button-row wrap">
            {link.enabled && (
              <button type="button" className="btn" disabled={busy} onClick={() => void pause()}>
                {t("teamStatus.pause")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={busy}
              onClick={() => setConfirmingLeave(true)}
            >
              {t("teamStatus.leave")}
            </button>
          </div>
        ))}
      <Feedback error={error} />
    </div>
  );
}

function SharingPanel({
  status,
  onStatus,
}: {
  status: TeamStatus;
  onStatus: (status: TeamStatus) => void;
}) {
  const t = useT();
  const { run, busy, error } = useAction();
  const { sharing } = status;
  const seen = useKindNames(sharing.outgoing.items);

  const change = async (
    body: { enabled: boolean } | { consent: Partial<Record<TeamKind, boolean>> },
  ) => {
    const next = await run<TeamStatus>("PUT", TEAM_SHARING_PATH, body);
    if (next) onStatus(next);
  };

  return (
    <div>
      <h3>{t("teamStatus.sharing.title")}</h3>
      <label>
        <input
          type="checkbox"
          checked={sharing.enabled}
          disabled={busy}
          onChange={(event) => void change({ enabled: event.target.checked })}
        />{" "}
        {t("teamStatus.sharing.master")}
      </label>
      {TEAM_KINDS.map((kind) => (
        <div key={kind}>
          <label>
            <input
              type="checkbox"
              checked={sharing.consent[kind]}
              disabled={busy || !sharing.enabled}
              onChange={(event) => void change({ consent: { [kind]: event.target.checked } })}
            />{" "}
            {t(KIND_CONSENT[kind])}
          </label>
        </div>
      ))}
      <p className="small">
        {sharing.outgoing.sharing && seen !== ""
          ? t("teamStatus.outgoing.now", { kinds: seen })
          : t("teamStatus.outgoing.none")}
      </p>
      <Feedback error={error} />
    </div>
  );
}

function MembersPanel({
  status,
  onStatus,
}: {
  status: TeamStatus;
  onStatus: (status: TeamStatus) => void;
}) {
  const t = useT();
  const ids = useId();
  const { run, busy, error } = useAction();
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [publicKey, setPublicKey] = useState("");

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const next = await run<TeamStatus>("POST", TEAM_MEMBERS_PATH, {
      id: id.trim(),
      label: label.trim(),
      public_key: publicKey.trim(),
    });
    if (next) {
      onStatus(next);
      setId("");
      setLabel("");
      setPublicKey("");
    }
  };

  const remove = async (memberId: string) => {
    const next = await run<TeamStatus>(
      "DELETE",
      `${TEAM_MEMBERS_PATH}/${encodeURIComponent(memberId)}`,
    );
    if (next) onStatus(next);
  };

  return (
    <div>
      <h3>{t("teamStatus.members.title")}</h3>
      {status.members.length === 0 ? (
        <p className="small">{t("teamStatus.members.none")}</p>
      ) : (
        <ul>
          {status.members.map((member) => (
            <li key={member.id}>
              <span>{member.label}</span> <span className="small">{member.id}</span>{" "}
              <button
                type="button"
                className="btn"
                disabled={busy}
                aria-label={t("teamStatus.members.removeLabel", { label: member.label })}
                onClick={() => void remove(member.id)}
              >
                {t("common.button.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="settings-form" onSubmit={(event) => void add(event)}>
        <label className="field" htmlFor={`${ids}-id`}>
          {t("teamStatus.members.id")}
          <input
            id={`${ids}-id`}
            type="text"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </label>
        <label className="field" htmlFor={`${ids}-label`}>
          {t("teamStatus.members.label")}
          <input
            id={`${ids}-label`}
            type="text"
            maxLength={40}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="field" htmlFor={`${ids}-key`}>
          {t("teamStatus.members.publicKey")}
          <input
            id={`${ids}-key`}
            type="text"
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="btn"
          disabled={busy || id.trim() === "" || label.trim() === "" || publicKey.trim() === ""}
        >
          {t("teamStatus.members.add")}
        </button>
      </form>
      <Feedback error={error} />
    </div>
  );
}

function PresenceRow({ label, items }: { label: string; items: readonly TeamItem[] }) {
  const t = useT();
  const kinds = useKindNames(items);
  return (
    <li>
      <span>{label}</span>{" "}
      <span className="small">{kinds === "" ? t("teamStatus.presence.nothing") : kinds}</span>
    </li>
  );
}

function PresencePanel({ status }: { status: TeamStatus }) {
  const t = useT();
  return (
    <div>
      <h3>{t("teamStatus.presence.title")}</h3>
      {status.presence.members.length === 0 ? (
        <p className="small">{t("teamStatus.presence.none")}</p>
      ) : (
        <ul>
          {status.presence.members.map((member) => (
            <PresenceRow key={member.id} label={member.label} items={member.items} />
          ))}
        </ul>
      )}
    </div>
  );
}
