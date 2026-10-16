// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState } from "react";
import { formatDate, formatTime } from "../core/format";
import { useAction, useAgentApprovalRules } from "../core/hooks";
import { Feedback } from "./Feedback";
import { RevealedBlock, revealNodes, revealPlain } from "./RevealedText";

/** Settings section: the "Always allow here" rules Phoenix made for coding agents, each revocable. */
export function ApprovalRulesSection() {
  const { data: rules, error: loadError, reload } = useAgentApprovalRules();
  const { run, busy, error } = useAction();
  const [revoked, setRevoked] = useState<string | null>(null);

  const revoke = async (id: string, label: string) => {
    setRevoked(null);
    const res = await run("DELETE", `/api/agent-approvals/rules/${encodeURIComponent(id)}`);
    if (res === undefined) return;
    setRevoked(`Revoked: ${label}.`);
    void reload();
  };

  return (
    <section aria-labelledby="agent-rules-h" className="card">
      <h2 id="agent-rules-h" className="h3">
        Agent approval rules
      </h2>
      <p className="muted small">
        Rules you created with “Always allow here”. Each applies to one agent, one project and one
        tool, expires on its own within 24 hours, and never matches a command that chains or
        redirects. Revoke one to be asked again.
      </p>
      <Feedback error={loadError ?? error} saved={revoked} />
      {rules.length === 0 ? (
        <p className="muted small">No agent approval rules are active.</p>
      ) : (
        <ul className="card-list" aria-label="Agent approval rules">
          {rules.map((r) => {
            const label = `${revealPlain(r.tool)} ${revealPlain(r.pattern)} in ${revealPlain(r.project)}`;
            return (
              <li key={r.id} className="card" aria-label={label}>
                <dl className="approval-facts small">
                  <dt>Agent</dt>
                  <dd className="reveal-block">{revealNodes(r.agent)}</dd>
                  <dt>Project</dt>
                  <dd className="reveal-block">{revealNodes(r.project)}</dd>
                  <dt>Tool</dt>
                  <dd className="reveal-block">{revealNodes(r.tool)}</dd>
                  <dt>Pattern</dt>
                  <dd>
                    <RevealedBlock text={r.pattern} />
                  </dd>
                  <dt>Expires</dt>
                  <dd>
                    {formatDate(r.expires_at)} {formatTime(r.expires_at)}
                  </dd>
                  <dt>Used</dt>
                  <dd>
                    {r.uses} {r.uses === 1 ? "time" : "times"}
                  </dd>
                  <dt>Created by</dt>
                  <dd>{r.created_by}</dd>
                </dl>
                <div className="button-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    aria-label={`Revoke rule: ${label}`}
                    onClick={() => void revoke(r.id, label)}
                  >
                    Revoke
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
