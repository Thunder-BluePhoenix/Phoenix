// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatAgo, formatNumber, formatSince } from "../core/format";
import { useCapabilities, useCommandResult } from "../core/hooks";
import type { AgentSession, FrappeSite } from "../core/types";
import { useT, type MessageKey } from "../i18n";

const AGENT_STATE_TEXT: Record<AgentSession["state"], MessageKey> = {
  started: "services.integrations.agents.state.started",
  working: "services.integrations.agents.state.working",
  waiting: "services.integrations.agents.state.waiting",
  idle: "services.integrations.agents.state.idle",
  completed: "services.integrations.agents.state.completed",
  failed: "services.integrations.agents.state.failed",
};

/** Coding agents that adapters have reported (Phase 25). Hidden until the capability is on. */
export function AgentsGlance() {
  const t = useT();
  const { data: caps } = useCapabilities();
  const on = caps.find((c) => c.id === "agents")?.status === "enabled";
  const { data, error } = useCommandResult<{ agents: AgentSession[] }>(
    "agents",
    "list",
    on,
    (type) => type.startsWith("agent."),
  );
  if (!on) return null;
  const agents = data?.agents ?? [];
  return (
    <section aria-labelledby="agents-h">
      <h3 id="agents-h">{t("services.integrations.agents.title")}</h3>
      {error && <p className="error-text small">{error}</p>}
      {agents.length === 0 ? (
        <p className="muted small">{t("services.integrations.agents.empty")}</p>
      ) : (
        <ul className="task-list">
          {agents.map((a) => (
            <li key={`${a.agent}:${a.agent_id}`}>
              <strong>{a.agent}</strong>
              <span className="muted"> · {a.repository}</span>
              <span className={a.state === "waiting" ? "agent-waiting" : "muted"}>
                {" "}
                ·{" "}
                {a.reason
                  ? t("services.integrations.agents.stateReason", {
                      state: t(AGENT_STATE_TEXT[a.state]),
                      reason: a.reason,
                    })
                  : t(AGENT_STATE_TEXT[a.state])}
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

const SITE_STATUS_TEXT: Record<FrappeSite["status"], MessageKey> = {
  checking: "services.integrations.frappe.status.checking",
  healthy: "services.integrations.frappe.status.healthy",
  unhealthy: "services.integrations.frappe.status.unhealthy",
};

/** Health of the Frappe sites in the benches the user selected (Phase 23). */
export function FrappeSites() {
  const t = useT();
  const { data: caps } = useCapabilities();
  const on = caps.find((c) => c.id === "frappe")?.status === "enabled";
  const { data, error } = useCommandResult<{ sites: FrappeSite[] }>("frappe", "sites", on, (type) =>
    type.startsWith("frappe."),
  );
  if (!on) return null;
  const sites = data?.sites ?? [];
  return (
    <section aria-labelledby="frappe-h">
      <h3 id="frappe-h">{t("services.integrations.frappe.title")}</h3>
      {error && <p className="error-text small">{error}</p>}
      {sites.length === 0 ? (
        <p className="muted small">{t("services.integrations.frappe.empty")}</p>
      ) : (
        <ul className="task-list">
          {sites.map((s) => (
            <li key={`${s.bench}:${s.site}`}>
              <strong>{s.site}</strong>{" "}
              <span className={s.status === "unhealthy" ? "error-text" : "muted"}>
                · {t(SITE_STATUS_TEXT[s.status])}
              </span>
              {s.status === "healthy" && s.response_ms !== undefined && (
                <span className="muted small">
                  {" "}
                  ·{" "}
                  {t("services.integrations.frappe.responseMs", {
                    ms: formatNumber(s.response_ms),
                  })}
                </span>
              )}
              {s.status === "unhealthy" && s.error && <p className="small">{s.error}</p>}
              {s.last_ok_at && s.status !== "healthy" && (
                <p className="muted small">
                  {t("services.integrations.frappe.lastHealthy", { ago: formatAgo(s.last_ok_at) })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
