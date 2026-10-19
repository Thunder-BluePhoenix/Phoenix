// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState } from "react";
import { formatDate, formatTime } from "../core/format";
import { useAction, useAgentApprovalRules } from "../core/hooks";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";
import { RevealedBlock, revealNodes, revealPlain } from "./RevealedText";

/** Settings section: the "Always allow here" rules Phoenix made for coding agents, each revocable. */
export function ApprovalRulesSection() {
  const t = useT();
  const { data: rules, error: loadError, reload } = useAgentApprovalRules();
  const { run, busy, error } = useAction();
  const [revoked, setRevoked] = useState<string | null>(null);

  const revoke = async (id: string, label: string) => {
    setRevoked(null);
    const res = await run("DELETE", `/api/agent-approvals/rules/${encodeURIComponent(id)}`);
    if (res === undefined) return;
    setRevoked(t("agents.rules.revoked", { label }));
    void reload();
  };

  return (
    <section aria-labelledby="agent-rules-h" className="card">
      <h2 id="agent-rules-h" className="h3">
        {t("agents.rules.title")}
      </h2>
      <p className="muted small">{t("agents.rules.intro")}</p>
      <Feedback error={loadError ?? error} saved={revoked} />
      {rules.length === 0 ? (
        <p className="muted small">{t("agents.rules.empty")}</p>
      ) : (
        <ul className="card-list" aria-label={t("agents.rules.title")}>
          {rules.map((r) => {
            const label = t("agents.rules.summary", {
              tool: revealPlain(r.tool),
              pattern: revealPlain(r.pattern),
              project: revealPlain(r.project),
            });
            return (
              <li key={r.id} className="card" aria-label={label}>
                <dl className="approval-facts small">
                  <dt>{t("agents.rules.agent")}</dt>
                  <dd className="reveal-block">{revealNodes(r.agent)}</dd>
                  <dt>{t("agents.rules.project")}</dt>
                  <dd className="reveal-block">{revealNodes(r.project)}</dd>
                  <dt>{t("agents.rules.tool")}</dt>
                  <dd className="reveal-block">{revealNodes(r.tool)}</dd>
                  <dt>{t("agents.rules.pattern")}</dt>
                  <dd>
                    <RevealedBlock text={r.pattern} />
                  </dd>
                  <dt>{t("agents.rules.expires")}</dt>
                  <dd>
                    {formatDate(r.expires_at)} {formatTime(r.expires_at)}
                  </dd>
                  <dt>{t("agents.rules.used")}</dt>
                  <dd>{t("agents.rules.uses", { count: r.uses })}</dd>
                  <dt>{t("agents.rules.createdBy")}</dt>
                  <dd>{r.created_by}</dd>
                </dl>
                <div className="button-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    aria-label={t("agents.rules.revokeLabel", { label })}
                    onClick={() => void revoke(r.id, label)}
                  >
                    {t("agents.rules.revoke")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
