// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useState } from "react";
import {
  ACTION_IDS,
  ACTION_KEYS,
  FREEZABLE,
  FREEZABLE_NAMES,
  LID_LIST_RULES,
  checkLidEntry,
  lidConfigFromDraft,
  lidDraftFromConfig,
  reasonKey,
  WARNING_NOTES,
  readLidStatus,
  type LidActionId,
  type LidDraft,
  type LidListKind,
  type LidOutcome,
} from "../core/lid";
import { formatTime } from "../core/format";
import { useAction, useCapabilities, useCommandResult } from "../core/hooks";
import { useLocale, useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const LID_EVENTS = (type: string) =>
  type.startsWith("awake.lid_action.") ||
  type === "awake.lid.closed" ||
  type === "awake.lid.opened";

const PROBLEM_TEXT: Record<"duplicate" | "full", MessageKey> = {
  duplicate: "power.lid.list.duplicate",
  full: "power.lid.list.full",
};

const OUTCOME_TEXT: Record<LidOutcome, MessageKey> = {
  applied: "power.lid.outcome.applied",
  skipped: "power.lid.outcome.skipped",
  failed: "power.lid.outcome.failed",
  undone: "power.lid.outcome.undone",
  undo_failed: "power.lid.outcome.undo_failed",
};

function Toggle({
  checked,
  onChange,
  label,
  help,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  help: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <>
      <label className="choice">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
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

/** A validated list: add with a check, remove one. */
function ListEditor({
  kind,
  label,
  items,
  onChange,
}: {
  kind: LidListKind;
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const checked = checkLidEntry(kind, text, items);
    if (!checked.ok) {
      setProblem(
        checked.problem === "invalid"
          ? t(LID_LIST_RULES[kind].invalid)
          : t(PROBLEM_TEXT[checked.problem], { max: LID_LIST_RULES[kind].max }),
      );
      return;
    }
    setProblem(null);
    setText("");
    onChange([...items, checked.value]);
  };
  return (
    <div className="lid-list">
      <label className="field" htmlFor={`${id}-in`}>
        {label}
      </label>
      {items.length === 0 ? (
        <p className="muted small">{t("power.lid.list.empty")}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>
              <code>{item}</code>{" "}
              <button
                type="button"
                className="btn"
                aria-label={t("power.lid.list.remove", { item })}
                onClick={() => onChange(items.filter((x) => x !== item))}
              >
                {t("common.button.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="lid-add">
        <input
          id={`${id}-in`}
          value={text}
          maxLength={160}
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

/** Settings: what Phoenix does while the lid is closed during a keep-awake session. */
export function LidActionsSettings() {
  const t = useT();
  const { locale } = useLocale();
  const { data: caps, reload } = useCapabilities();
  const awake = caps.find((c) => c.id === "awake");
  const on = awake?.status === "enabled";
  const { run, busy, error } = useAction();
  const [draft, setDraft] = useState<LidDraft | null>(null);
  const [saved, setSaved] = useState(false);

  const configKey = JSON.stringify(awake?.config ?? null);
  useEffect(() => {
    if (awake) setDraft(lidDraftFromConfig(awake.config));
    // The saved config is the source; edits are kept until it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  const status = useCommandResult<unknown>("awake", "lid_actions.status", on, LID_EVENTS);
  if (!awake || !draft) return null;
  const view = readLidStatus(status.data);
  const set = (patch: Partial<LidDraft>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };

  const save = async () => {
    const result = await run("POST", "/api/capabilities/awake/config", {
      config: lidConfigFromDraft(awake.config, draft),
    });
    if (result !== undefined) {
      setSaved(true);
      reload();
    }
  };

  const switches: Record<LidActionId, { on: boolean; set: (on: boolean) => void }> = {
    display: { on: draft.display, set: (display) => set({ display }) },
    freeze_apps: { on: draft.freezeApps, set: (freezeApps) => set({ freezeApps }) },
    mute: { on: draft.mute, set: (mute) => set({ mute }) },
    low_power: { on: draft.lowPower, set: (lowPower) => set({ lowPower }) },
    docker_freeze: { on: draft.dockerFreeze, set: (dockerFreeze) => set({ dockerFreeze }) },
    app_nap: { on: draft.appNap, set: (appNap) => set({ appNap }) },
  };
  const unsupported = view?.actions.filter((a) => a.enabled && a.supported === false) ?? [];
  const limited =
    view?.actions.filter((a) => a.enabled && a.supported === true && a.limits.length > 0) ?? [];
  const builtIn = view?.builtIn ?? [];
  const extra = draft.protectedExtra;

  return (
    <section aria-labelledby="lid-h" className="card lid-actions">
      <h2 id="lid-h" className="h3">
        {t("power.lid.heading")}
      </h2>
      <p className="muted small">{t("power.lid.intro")}</p>
      {!on && <p className="muted small">{t("power.lid.needsAwake")}</p>}

      <Toggle
        checked={draft.enabled}
        onChange={(enabled) => set({ enabled })}
        label={t("power.lid.master.title")}
        help={t("power.lid.master.help")}
      />

      {ACTION_IDS.map((id) => {
        const keys = ACTION_KEYS[id];
        const s = switches[id];
        const problem = view?.actions.find((a) => a.id === id);
        return (
          <fieldset key={id} className="settings-form" disabled={!draft.enabled}>
            <legend>{t(keys.title)}</legend>
            <Toggle checked={s.on} onChange={s.set} label={t(keys.title)} help={t(keys.help)} />
            {s.on && problem?.supported === false && (
              <p className="lid-notice small" role="note">
                {t("power.lid.unsupported", { reason: t(reasonKey(problem.reason)) })}
              </p>
            )}
            {s.on && problem?.supported === true && problem.limits.length > 0 && (
              <p className="muted small">
                {problem.limits.map((code) => t(reasonKey(code))).join(" ")}
              </p>
            )}
            {id === "freeze_apps" && s.on && (
              <div className="lid-apps" role="group" aria-label={t("power.lid.freeze.apps")}>
                {FREEZABLE.map((key) => (
                  <label key={key} className="choice">
                    <input
                      type="checkbox"
                      checked={draft.freezeList.includes(key)}
                      onChange={(e) =>
                        set({
                          freezeList: e.target.checked
                            ? [...draft.freezeList, key]
                            : draft.freezeList.filter((k) => k !== key),
                        })
                      }
                    />
                    {FREEZABLE_NAMES[key] ?? key}
                  </label>
                ))}
              </div>
            )}
            {id === "app_nap" && s.on && (
              <ListEditor
                kind="napApps"
                label={t("power.lid.nap.apps")}
                items={draft.appNapList}
                onChange={(appNapList) => set({ appNapList })}
              />
            )}
          </fieldset>
        );
      })}

      <fieldset className="settings-form">
        <legend>{t("power.lid.protected.title")}</legend>
        <p className="muted small">{t("power.lid.protected.help")}</p>
        {builtIn.length > 0 && (
          <>
            <p className="small">{t("power.lid.protected.builtIn")}</p>
            <ul className="lid-protected" aria-label={t("power.lid.protected.builtIn")}>
              {builtIn.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </>
        )}
        <ListEditor
          kind="protectedExtra"
          label={t("power.lid.protected.extra")}
          items={extra}
          onChange={(protectedExtra) => set({ protectedExtra })}
        />
      </fieldset>

      {(unsupported.length > 0 || limited.length > 0) && (
        <p className="muted small">{t("power.lid.gapNote")}</p>
      )}

      <section aria-labelledby="lid-last-h">
        <h3 id="lid-last-h" className="h3">
          {t("power.lid.last.title")}
        </h3>
        {view?.last ? (
          <>
            <p>
              {t(view.last.event === "closed" ? "power.lid.last.closed" : "power.lid.last.opened", {
                time: formatTime(new Date(view.last.at).toISOString(), locale),
              })}
            </p>
            <ul className="lid-results">
              {view.last.results.map((r) => (
                <li key={r.action}>
                  <strong>{t(ACTION_KEYS[r.action].title)}</strong>: {t(OUTCOME_TEXT[r.outcome])}
                  {r.reason !== undefined && r.outcome !== "applied" && r.outcome !== "undone" && (
                    <> ({t(reasonKey(r.reason))})</>
                  )}
                  {r.mismatched > 0 && (
                    <> {t("power.lid.last.mismatched", { count: r.mismatched })}</>
                  )}
                  {r.notOurs > 0 && <> {t(reasonKey("not_ours"))}</>}
                  {r.notes
                    .filter((note) => WARNING_NOTES.includes(note))
                    .map((note) => (
                      <span key={note}> {t(reasonKey(note))}</span>
                    ))}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted small">{t("power.lid.last.none")}</p>
        )}
        {view?.closed && (
          <p className="lid-notice small" role="status">
            {t("power.lid.last.stillClosed")}
          </p>
        )}
      </section>

      <p className="muted small">{t("power.lid.applyNote")}</p>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
        {t("common.button.save")}
      </button>
      <Feedback error={error} saved={saved ? t("power.lid.saved") : null} />
    </section>
  );
}

/** Overview: a line only while the lid actions are applied (or an undo failed). Otherwise nothing. */
export function LidActionsGlance() {
  const t = useT();
  const { data: caps } = useCapabilities();
  const on = caps.find((c) => c.id === "awake")?.status === "enabled";
  const status = useCommandResult<unknown>("awake", "lid_actions.status", on, LID_EVENTS);
  const view = readLidStatus(status.data);
  const failed =
    view?.last?.results.some((r) => r.outcome === "undo_failed" || r.outcome === "failed") ?? false;
  if (!on || !view || (!view.closed && !failed)) return null;
  return (
    <section aria-labelledby="lid-glance-h" className="lid-glance">
      <h3 id="lid-glance-h">{t("power.lid.last.title")}</h3>
      <p className="lid-notice" role="status">
        {t(view.closed ? "power.lid.glance.closed" : "power.lid.glance.failed")}
      </p>
    </section>
  );
}
