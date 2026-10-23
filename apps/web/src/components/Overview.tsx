// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { useState } from "react";
import { formatSince } from "../core/format";
import { useAction, useKillSwitch } from "../core/hooks";
import type { ActiveTask, PetState } from "../core/types";
import { isMessageKey, useT } from "../i18n";
import { AgentApprovals } from "./AgentApprovals";
import { AwakeGlance } from "./Awake";
import { ContinuityGlance } from "./Continuity";
import { LidActionsGlance } from "./LidActions";
import { FawkesDropTarget } from "./Attachments";
import { Approvals } from "./Approvals";
import { AgentsGlance, FrappeSites } from "./Integrations";
import { MeetingsGlance } from "./Meetings";
import { NowPlayingGlance } from "./NowPlaying";
import { PortfolioGlance } from "./Portfolio";
import { PowerRecoveryGlance } from "./PowerRecovery";
import { ServiceGlances } from "./ServiceGlances";
import { CurrentTask } from "./TaskView";

/** How many tasks the panel lists before "Show all": enough to see what is happening, few enough
 *  that the actions below (Pause Fawkes, Emergency stop) never end up thousands of pixels away. */
const TASKS_SHOWN = 10;

function TaskList({ tasks }: { tasks: ActiveTask[] }) {
  const t = useT();
  const [all, setAll] = useState(false);
  if (tasks.length === 0) return <p className="muted">{t("services.overview.nothingRunning")}</p>;
  const shown = all ? tasks : tasks.slice(0, TASKS_SHOWN);
  return (
    <>
      <ul className="task-list">
        {shown.map((task) => (
          <li key={task.key}>
            <span>{task.title}</span>
            <span className="muted"> · {task.source}</span>
            {task.progress !== undefined && (
              <progress
                max={1}
                value={task.progress}
                aria-label={t("services.overview.taskProgress", { title: task.title })}
              />
            )}
          </li>
        ))}
      </ul>
      {tasks.length > TASKS_SHOWN && (
        <button type="button" className="btn" aria-expanded={all} onClick={() => setAll(!all)}>
          {all
            ? t("services.overview.showFewer")
            : t("services.overview.showAll", { count: tasks.length })}
        </button>
      )}
    </>
  );
}

export function Overview({ state, tasks }: { state: PetState; tasks: ActiveTask[] }) {
  const t = useT();
  const visual = visualFor(state.state);
  const stateKey = `common.petState.${state.state}`;
  return (
    <div className="overview">
      <div className={`pet-status tone-${visual.tone}`}>
        <strong>{isMessageKey(stateKey) ? t(stateKey) : visual.label}</strong>
        <span>{state.explanation}</span>
        {state.since && Date.parse(state.since) > 0 && (
          <span className="muted small">
            {t("services.overview.stateFor", { since: formatSince(state.since) })}
          </span>
        )}
      </div>
      {state.recording && (
        <p className="pet-recording" role="note">
          <span className="rec-dot" aria-hidden="true" /> {t("services.overview.recordingActive")}
        </p>
      )}
      <FawkesDropTarget />
      <AgentApprovals />
      <Approvals />
      <CurrentTask />
      <section aria-labelledby="tasks-h">
        <h3 id="tasks-h">{t("services.overview.activeTasks")}</h3>
        <TaskList tasks={tasks} />
      </section>
      <AgentsGlance />
      <FrappeSites />
      <NowPlayingGlance />
      <ServiceGlances />
      <PortfolioGlance />
      <MeetingsGlance />
      <AwakeGlance />
      <PowerRecoveryGlance />
      <LidActionsGlance />
      <ContinuityGlance />
      <QuickActions state={state} />
    </div>
  );
}

export function QuickActions({ state }: { state: PetState }) {
  const t = useT();
  const { run, busy, error } = useAction();
  const { data: killEngaged, reload } = useKillSwitch();
  const [confirmStop, setConfirmStop] = useState(false);

  const toggleKill = async (engaged: boolean) => {
    await run("POST", "/api/security/kill-switch", { engaged });
    setConfirmStop(false);
    await reload();
  };

  return (
    <section aria-labelledby="actions-h">
      <h3 id="actions-h">{t("services.overview.quickActions")}</h3>
      <div className="button-row wrap">
        {state.state === "ERROR" && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void run("POST", "/api/pet/acknowledge", {})}
          >
            {t("services.overview.dismissErrors")}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run("POST", "/api/pet/sleep", { sleeping: !state.sleeping })}
        >
          {state.sleeping ? t("services.overview.wake") : t("services.overview.pause")}
        </button>
        {killEngaged ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void toggleKill(false)}
          >
            {t("services.overview.releaseStop")}
          </button>
        ) : confirmStop ? (
          <>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void toggleKill(true)}
            >
              {t("services.overview.confirmStop")}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmStop(false)}>
              {t("common.button.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-danger-outline"
            onClick={() => setConfirmStop(true)}
          >
            {t("services.overview.emergencyStop")}
          </button>
        )}
      </div>
      {killEngaged && (
        <p className="warning-text" role="note">
          {t("services.overview.stopOn")}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
