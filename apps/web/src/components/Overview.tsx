// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { useState } from "react";
import { formatSince } from "../core/format";
import { useAction, useKillSwitch } from "../core/hooks";
import type { ActiveTask, PetState } from "../core/types";
import { Approvals } from "./Approvals";
import { AgentsGlance, FrappeSites } from "./Integrations";
import { MeetingsGlance } from "./Meetings";
import { CurrentTask } from "./TaskView";

/** How many tasks the panel lists before "Show all": enough to see what is happening, few enough
 *  that the actions below (Pause Fawkes, Emergency stop) never end up thousands of pixels away. */
const TASKS_SHOWN = 10;

function TaskList({ tasks }: { tasks: ActiveTask[] }) {
  const [all, setAll] = useState(false);
  if (tasks.length === 0) return <p className="muted">Nothing running.</p>;
  const shown = all ? tasks : tasks.slice(0, TASKS_SHOWN);
  return (
    <>
      <ul className="task-list">
        {shown.map((t) => (
          <li key={t.key}>
            <span>{t.title}</span>
            <span className="muted"> · {t.source}</span>
            {t.progress !== undefined && (
              <progress max={1} value={t.progress} aria-label={`${t.title} progress`} />
            )}
          </li>
        ))}
      </ul>
      {tasks.length > TASKS_SHOWN && (
        <button type="button" className="btn" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${tasks.length} tasks`}
        </button>
      )}
    </>
  );
}

export function Overview({ state, tasks }: { state: PetState; tasks: ActiveTask[] }) {
  const visual = visualFor(state.state);
  return (
    <div className="overview">
      <div className={`pet-status tone-${visual.tone}`}>
        <strong>{visual.label}</strong>
        <span>{state.explanation}</span>
        {state.since && Date.parse(state.since) > 0 && (
          <span className="muted small">for {formatSince(state.since)}</span>
        )}
      </div>
      {state.recording && (
        <p className="pet-recording" role="note">
          <span className="rec-dot" aria-hidden="true" /> Recording is active.
        </p>
      )}
      <Approvals />
      <CurrentTask />
      <section aria-labelledby="tasks-h">
        <h3 id="tasks-h">Active tasks</h3>
        <TaskList tasks={tasks} />
      </section>
      <AgentsGlance />
      <FrappeSites />
      <MeetingsGlance />
      <QuickActions state={state} />
    </div>
  );
}

export function QuickActions({ state }: { state: PetState }) {
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
      <h3 id="actions-h">Quick actions</h3>
      <div className="button-row wrap">
        {state.state === "ERROR" && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void run("POST", "/api/pet/acknowledge", {})}
          >
            Dismiss errors
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run("POST", "/api/pet/sleep", { sleeping: !state.sleeping })}
        >
          {state.sleeping ? "Wake Fawkes" : "Pause Fawkes"}
        </button>
        {killEngaged ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void toggleKill(false)}
          >
            Release emergency stop
          </button>
        ) : confirmStop ? (
          <>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void toggleKill(true)}
            >
              Confirm: stop all capabilities
            </button>
            <button type="button" className="btn" onClick={() => setConfirmStop(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-danger-outline"
            onClick={() => setConfirmStop(true)}
          >
            Emergency stop
          </button>
        )}
      </div>
      {killEngaged && (
        <p className="warning-text" role="note">
          Emergency stop is on: every capability is disabled and actions are blocked.
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
