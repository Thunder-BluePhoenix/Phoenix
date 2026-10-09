// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatSince } from "../core/format";
import { useCapabilities, useCommandResult } from "../core/hooks";
import type { AgentSession, FrappeSite } from "../core/types";

const AGENT_STATE_TEXT: Record<AgentSession["state"], string> = {
  started: "Started",
  working: "Working",
  waiting: "Needs your input",
  idle: "Idle",
  completed: "Finished",
  failed: "Failed",
};

/** Coding agents that adapters have reported (Phase 25). Hidden until the capability is on. */
export function AgentsGlance() {
  const { data: caps } = useCapabilities();
  const on = caps.find((c) => c.id === "agents")?.status === "enabled";
  const { data, error } = useCommandResult<{ agents: AgentSession[] }>("agents", "list", on, (t) =>
    t.startsWith("agent."),
  );
  if (!on) return null;
  const agents = data?.agents ?? [];
  return (
    <section aria-labelledby="agents-h">
      <h3 id="agents-h">Coding agents</h3>
      {error && <p className="error-text small">{error}</p>}
      {agents.length === 0 ? (
        <p className="muted small">No coding agent has reported yet.</p>
      ) : (
        <ul className="task-list">
          {agents.map((a) => (
            <li key={`${a.agent}:${a.agent_id}`}>
              <strong>{a.agent}</strong>
              <span className="muted"> · {a.repository}</span>
              <span className={a.state === "waiting" ? "agent-waiting" : "muted"}>
                {" "}
                · {AGENT_STATE_TEXT[a.state]}
                {a.reason ? ` (${a.reason})` : ""}
              </span>
              <span className="muted small"> · {formatSince(a.updated_at)}</span>
              {a.task && <p className="small">{a.task}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SITE_STATUS_TEXT: Record<FrappeSite["status"], string> = {
  checking: "Checking",
  healthy: "Healthy",
  unhealthy: "Not responding",
};

/** Health of the Frappe sites in the benches the user selected (Phase 23). */
export function FrappeSites() {
  const { data: caps } = useCapabilities();
  const on = caps.find((c) => c.id === "frappe")?.status === "enabled";
  const { data, error } = useCommandResult<{ sites: FrappeSite[] }>("frappe", "sites", on, (t) =>
    t.startsWith("frappe."),
  );
  if (!on) return null;
  const sites = data?.sites ?? [];
  return (
    <section aria-labelledby="frappe-h">
      <h3 id="frappe-h">Frappe sites</h3>
      {error && <p className="error-text small">{error}</p>}
      {sites.length === 0 ? (
        <p className="muted small">No sites found. Select a bench under Capabilities.</p>
      ) : (
        <ul className="task-list">
          {sites.map((s) => (
            <li key={`${s.bench}:${s.site}`}>
              <strong>{s.site}</strong>{" "}
              <span className={s.status === "unhealthy" ? "error-text" : "muted"}>
                · {SITE_STATUS_TEXT[s.status]}
              </span>
              {s.status === "healthy" && s.response_ms !== undefined && (
                <span className="muted small"> · {s.response_ms} ms</span>
              )}
              {s.status === "unhealthy" && s.error && <p className="small">{s.error}</p>}
              {s.last_ok_at && s.status !== "healthy" && (
                <p className="muted small">Last healthy {formatSince(s.last_ok_at)} ago</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
