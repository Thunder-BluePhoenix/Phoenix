// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useState } from "react";
import {
  LIST_RULES,
  MAX_NUDGE_SECONDS,
  MIN_NUDGE_SECONDS,
  checkEntry,
  configFromDraft,
  draftFromConfig,
  draftProblems,
  readContinuityStatus,
  readOutcome,
  readThrottleStatus,
  type ContinuityDraft,
  type ListKind,
  type OutageView,
} from "../core/continuity";
import { formatTime } from "../core/format";
import { useAction, useCapabilities, useCommandAction, useCommandResult } from "../core/hooks";
import { useLocale, useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const NETWORK_EVENTS = (type: string) =>
  type.startsWith("awake.network.") ||
  type.startsWith("awake.hotspot.") ||
  type.startsWith("awake.nudge.") ||
  type.startsWith("awake.throttle.");

const PROBLEM_TEXT: Record<"duplicate" | "full", MessageKey> = {
  duplicate: "power.continuity.problem.duplicate",
  full: "power.continuity.problem.full",
};

const HOTSPOT_TEXT: Record<OutageView["hotspot"], MessageKey> = {
  joined: "power.continuity.outage.hotspot.joined",
  failed: "power.continuity.outage.hotspot.failed",
  skipped: "power.continuity.outage.hotspot.skipped",
  not_tried: "power.continuity.outage.hotspot.notTried",
};

/** One validated list (hosts, tmux panes, sessions, program names): add with a check, remove one. */
function ListEditor({
  kind,
  label,
  items,
  onChange,
}: {
  kind: ListKind;
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const checked = checkEntry(kind, text, items);
    if (!checked.ok) {
      setProblem(
        checked.problem === "invalid"
          ? t(LIST_RULES[kind].invalid)
          : t(PROBLEM_TEXT[checked.problem], { max: LIST_RULES[kind].max }),
      );
      return;
    }
    setProblem(null);
    setText("");
    onChange([...items, checked.value]);
  };
  return (
    <div className="continuity-list">
      <label className="field" htmlFor={`${id}-in`}>
        {label}
      </label>
      {items.length === 0 ? (
        <p className="muted small">{t("power.continuity.list.empty")}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>
              <code>{item}</code>{" "}
              <button
                type="button"
                className="btn"
                aria-label={t("power.continuity.list.remove", { item })}
                onClick={() => onChange(items.filter((x) => x !== item))}
              >
                {t("common.button.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="continuity-add">
        <input
          id={`${id}-in`}
          value={text}
          maxLength={260}
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn" onClick={add}>
          {t("common.button.add")}
        </button>
      </div>
      {problem && (
        <p id={`${id}-err`} className="error-text small" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  help: string;
}) {
  const id = useId();
  return (
    <>
      <label className="choice">
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={`${id}-help`}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      <p id={`${id}-help`} className="muted small">
        {help}
      </p>
    </>
  );
}

function OutageLine({ outage }: { outage: OutageView }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <>
      <p>
        {outage.endedAt === null
          ? t("power.continuity.outage.down", { time: formatTime(outage.startedAt, locale) })
          : t("power.continuity.outage.ended", {
              from: formatTime(outage.startedAt, locale),
              to: formatTime(outage.endedAt, locale),
            })}
      </p>
      <p className="muted small">
        {t(HOTSPOT_TEXT[outage.hotspot])} ·{" "}
        {t("power.continuity.outage.nudged", { count: outage.nudged })}
      </p>
    </>
  );
}

/** Settings: the four opt-in agent-continuity extras of the Keep awake capability. All off by default. */
export function ContinuitySettings() {
  const t = useT();
  const { data: caps, reload } = useCapabilities();
  const awake = caps.find((c) => c.id === "awake");
  const on = awake?.status === "enabled";
  const { run, busy, error } = useAction();
  const [draft, setDraft] = useState<ContinuityDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configKey = JSON.stringify(awake?.config ?? null);
  useEffect(() => {
    if (awake) setDraft(draftFromConfig(awake.config));
    // The saved config is the source; edits are kept until it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  const status = useCommandResult<unknown>("awake", "continuity.status", on, NETWORK_EVENTS);
  const persisted = draftFromConfig(awake?.config ?? {});
  const throttleOn = on && persisted.throttleOn;
  const savedHotspotOn = on && persisted.hotspotOn;
  const throttle = useCommandResult<unknown>(
    "awake",
    "throttle.status",
    throttleOn,
    NETWORK_EVENTS,
  );
  const join = useCommandAction("awake", "hotspot.join_now");
  const rejoin = useCommandAction("awake", "hotspot.rejoin_previous");
  const relaunch = useCommandAction("awake", "throttle.relaunch");

  if (!awake || !draft) return null;
  const view = readContinuityStatus(status.data);
  const browsers = readThrottleStatus(throttle.data);
  const problems = draftProblems(draft);
  const set = (patch: Partial<ContinuityDraft>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };

  const save = async () => {
    if (problems.length > 0) return;
    const result = await run("POST", "/api/capabilities/awake/config", {
      config: configFromDraft(awake.config, draft),
    });
    if (result !== undefined) {
      setSaved(true);
      reload();
    }
  };

  const outcome = (state: typeof join, field: "joined" | "relaunched") =>
    state.state === "succeeded"
      ? readOutcome(state.result, field)
      : state.state === "failed"
        ? { done: false as const, reason: "power.continuity.reason.other" as const }
        : null;
  const joinOutcome = outcome(join, "joined") ?? outcome(rejoin, "joined");
  const relaunchOutcome = outcome(relaunch, "relaunched");
  const relaunching = browsers?.browsers.find((b) => b.bundleId === confirming);

  return (
    <section aria-labelledby="continuity-h" className="card continuity">
      <h2 id="continuity-h" className="h3">
        {t("power.continuity.heading")}
      </h2>
      <p className="muted small">{t("power.continuity.intro")}</p>
      {!on && <p className="muted small">{t("power.continuity.needsAwake")}</p>}

      <fieldset className="settings-form">
        <legend>{t("power.continuity.network.title")}</legend>
        <Toggle
          checked={draft.networkOn}
          onChange={(networkOn) => set({ networkOn })}
          label={t("power.continuity.network.title")}
          help={t("power.continuity.network.help")}
        />
        <ListEditor
          kind="hosts"
          label={t("power.continuity.hosts.label")}
          items={draft.hosts}
          onChange={(hosts) => set({ hosts })}
        />
      </fieldset>

      <fieldset className="settings-form">
        <legend>{t("power.continuity.hotspot.title")}</legend>
        <Toggle
          checked={draft.hotspotOn}
          onChange={(hotspotOn) => set({ hotspotOn })}
          label={t("power.continuity.hotspot.title")}
          help={t("power.continuity.hotspot.help")}
        />
        <label className="field">
          {t("power.continuity.hotspot.ssid")}
          <input
            value={draft.ssid}
            maxLength={64}
            aria-invalid={problems.includes("ssid")}
            onChange={(e) => set({ ssid: e.target.value })}
          />
        </label>
        {problems.includes("ssid") && (
          <p className="error-text small" role="alert">
            {t("power.continuity.invalid.ssid")}
          </p>
        )}
        {(draft.hotspotOn || draft.allowPasswordArgv) && (
          <p className="continuity-disclosure" role="note">
            {t("power.continuity.hotspot.disclosure")}
          </p>
        )}
        <label className="choice">
          <input
            type="checkbox"
            checked={draft.allowPasswordArgv}
            onChange={(e) => set({ allowPasswordArgv: e.target.checked })}
          />
          {t("power.continuity.hotspot.allowPassword")}
        </label>
        {draft.allowPasswordArgv && (
          <p className="muted small">
            {view?.passwordSaved
              ? t("power.continuity.hotspot.passwordSaved")
              : t("power.continuity.hotspot.passwordMissing")}
          </p>
        )}
        <div className="continuity-actions">
          <button
            type="button"
            className="btn"
            disabled={!on || join.busy || !savedHotspotOn}
            onClick={() => void join.submit({})}
          >
            {t("power.continuity.hotspot.join")}
          </button>
          {view?.previousNetworkSaved && (
            <button
              type="button"
              className="btn"
              disabled={rejoin.busy}
              onClick={() => void rejoin.submit({})}
            >
              {t("power.continuity.hotspot.rejoin")}
            </button>
          )}
        </div>
        <p className="muted small">{t("power.continuity.hotspot.confirmNote")}</p>
        {joinOutcome?.done === true && (
          <p className="small" role="status">
            {t("power.continuity.hotspot.joined")}
          </p>
        )}
        {joinOutcome?.done === false && (
          <p className="error-text small" role="alert">
            {t(joinOutcome.reason)}
          </p>
        )}
      </fieldset>

      <fieldset className="settings-form">
        <legend>{t("power.continuity.nudge.title")}</legend>
        <Toggle
          checked={draft.nudgeOn}
          onChange={(nudgeOn) => set({ nudgeOn })}
          label={t("power.continuity.nudge.title")}
          help={t("power.continuity.nudge.help")}
        />
        <label className="field">
          {t("power.continuity.nudge.after")}
          <input
            inputMode="numeric"
            value={draft.afterSeconds}
            aria-invalid={problems.includes("seconds")}
            onChange={(e) => set({ afterSeconds: e.target.value })}
          />
        </label>
        {problems.includes("seconds") && (
          <p className="error-text small" role="alert">
            {t("power.continuity.invalid.seconds", {
              min: MIN_NUDGE_SECONDS,
              max: MAX_NUDGE_SECONDS,
            })}
          </p>
        )}
        <ListEditor
          kind="panes"
          label={t("power.continuity.nudge.panes")}
          items={draft.panes}
          onChange={(panes) => set({ panes })}
        />
        <ListEditor
          kind="sessions"
          label={t("power.continuity.nudge.sessions")}
          items={draft.sessions}
          onChange={(sessions) => set({ sessions })}
        />
        <p className="muted small">{t("power.continuity.nudge.sessionsNote")}</p>
        <ListEditor
          kind="commands"
          label={t("power.continuity.nudge.commands")}
          items={draft.commands}
          onChange={(commands) => set({ commands })}
        />
        <p className="muted small">{t("power.continuity.nudge.commandsNote")}</p>
        <Toggle
          checked={draft.enter}
          onChange={(enter) => set({ enter })}
          label={t("power.continuity.nudge.enter")}
          help={t("power.continuity.nudge.enterHelp")}
        />
      </fieldset>

      <fieldset className="settings-form">
        <legend>{t("power.continuity.throttle.title")}</legend>
        <Toggle
          checked={draft.throttleOn}
          onChange={(throttleOn) => set({ throttleOn })}
          label={t("power.continuity.throttle.title")}
          help={t("power.continuity.throttle.help")}
        />
        {throttleOn && browsers && !browsers.supported && (
          <p className="muted small">{t("power.continuity.throttle.unsupported")}</p>
        )}
        {throttleOn && browsers?.supported && (
          <ul className="continuity-browsers">
            {browsers.browsers.map((b) => (
              <li key={b.bundleId}>
                <strong>{b.name}</strong>{" "}
                {!b.running
                  ? t("power.continuity.throttle.notRunning")
                  : b.throttled
                    ? t("power.continuity.throttle.throttled")
                    : t("power.continuity.throttle.fine")}{" "}
                {b.running && b.throttled && (
                  <button
                    type="button"
                    className="btn"
                    disabled={relaunch.busy}
                    onClick={() => setConfirming(b.bundleId)}
                  >
                    {t("power.continuity.throttle.relaunch", { name: b.name })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {relaunching && (
          <div className="continuity-confirm" role="alertdialog" aria-label={relaunching.name}>
            <p>{t("power.continuity.throttle.confirm", { name: relaunching.name })}</p>
            <button
              type="button"
              className="btn btn-danger"
              disabled={relaunch.busy}
              onClick={() => {
                void relaunch.submit({ bundle_id: relaunching.bundleId });
                setConfirming(null);
                setNotice(t("power.continuity.throttle.relaunched", { name: relaunching.name }));
              }}
            >
              {t("power.continuity.throttle.confirmYes")}
            </button>{" "}
            <button type="button" className="btn" onClick={() => setConfirming(null)}>
              {t("common.button.cancel")}
            </button>
          </div>
        )}
        {relaunchOutcome?.done === true && notice && (
          <p className="small" role="status">
            {notice}
          </p>
        )}
        {relaunchOutcome?.done === false && (
          <p className="error-text small" role="alert">
            {t(relaunchOutcome.reason)}
          </p>
        )}
      </fieldset>

      <section aria-labelledby="continuity-outage-h">
        <h3 id="continuity-outage-h" className="h3">
          {t("power.continuity.outage.title")}
        </h3>
        {view?.lastOutage ? (
          <OutageLine outage={view.lastOutage} />
        ) : (
          <p className="muted small">{t("power.continuity.outage.none")}</p>
        )}
      </section>

      <p className="muted small">{t("power.continuity.applyNote")}</p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || problems.length > 0}
        onClick={() => void save()}
      >
        {t("common.button.save")}
      </button>
      <Feedback error={error} saved={saved ? t("power.continuity.saved") : null} />
    </section>
  );
}

/** Overview: only while the network is down, or the last outage is worth a line. Otherwise nothing. */
export function ContinuityGlance() {
  const t = useT();
  const { locale } = useLocale();
  const { data: caps } = useCapabilities();
  const on = caps.find((c) => c.id === "awake")?.status === "enabled";
  const status = useCommandResult<unknown>("awake", "continuity.status", on, NETWORK_EVENTS);
  const outage = readContinuityStatus(status.data)?.lastOutage;
  if (!on || !outage) return null;
  return (
    <section aria-labelledby="continuity-glance-h" className="continuity-glance">
      <h3 id="continuity-glance-h">{t("power.continuity.outage.title")}</h3>
      {outage.endedAt === null ? (
        <p className="continuity-warning" role="status">
          {t("power.continuity.outage.down", { time: formatTime(outage.startedAt, locale) })}
        </p>
      ) : (
        <OutageLine outage={outage} />
      )}
    </section>
  );
}
