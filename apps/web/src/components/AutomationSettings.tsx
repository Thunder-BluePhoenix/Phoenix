// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useAction, useAgentSettings } from "../core/hooks";
import { Feedback } from "./Feedback";

/** Settings: whether Fawkes may run agent tasks at all (`agents.enabled`, off by default). */
export function AutomationSettings() {
  const { data, error, reload } = useAgentSettings();
  const { run, busy, error: saveError } = useAction();
  const toggle = async (enabled: boolean) => {
    await run("POST", "/api/agent/settings", { enabled });
    await reload();
  };
  return (
    <section aria-labelledby="automation-h" className="card">
      <h2 id="automation-h" className="h3">
        Automation
      </h2>
      <p className="small">
        Automation is off until you turn it on. While it is off, Fawkes starts no tasks and runs
        nothing by itself. When it is on, Fawkes can only start a task when you ask for one, such as
        “Diagnose a CI failure” in the Chat tab. It reads data and proposes; anything that changes
        something waits for your approval, and you can cancel a task at any time. Turning automation
        off cancels every task that is running.
      </p>
      {data ? (
        <>
          <label className="choice">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Allow Fawkes to run tasks I start
          </label>
          <p className="muted small" role="status">
            Automation is {data.enabled ? "on" : "off"}. {data.active_runs}{" "}
            {data.active_runs === 1 ? "task is" : "tasks are"} running (at most{" "}
            {data.limits.max_active_runs} at once).
          </p>
        </>
      ) : (
        error && (
          <p className="muted small">
            Automation settings are not available from Phoenix Core ({error}).
          </p>
        )
      )}
      <Feedback error={saveError} />
    </section>
  );
}
