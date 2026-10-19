// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState } from "react";
import {
  DECISION_TEXT,
  isTerminalRun,
  RISK_LABEL,
  RUN_STATE_TEXT,
  STEP_STATUS_TEXT,
} from "../core/agent";
import { formatNumber, formatSince, translated } from "../core/format";
import { useAction, useAgentTask, useAgentTasks } from "../core/hooks";
import type { AgentEvidence, AgentStep, AgentTaskDetail, AgentTaskSummary } from "../core/types";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

const EVIDENCE_KIND_TEXT = translated({
  tool_output: "agents.task.evidenceKind.tool_output",
  memory: "agents.task.evidenceKind.memory",
  commit: "agents.task.evidenceKind.commit",
  log: "agents.task.evidenceKind.log",
  model: "agents.task.evidenceKind.model",
});

/** Evidence ids as links that open and highlight the evidence; unknown ids stay plain text. */
function EvidenceLinks({
  ids,
  known,
  onShow,
}: {
  ids: readonly string[];
  known: Record<string, boolean>;
  onShow: (id: string) => void;
}) {
  const t = useT();
  if (ids.length === 0) return <span className="muted">{t("agents.task.noEvidenceCited")}</span>;
  return (
    <>
      {ids.map((id, i) => (
        <span key={`${id}:${i}`}>
          {i > 0 && ", "}
          {known[id] ? (
            <button
              type="button"
              className="link-button small"
              aria-label={t("agents.task.showEvidenceLabel", { id })}
              onClick={() => onShow(id)}
            >
              {id}
            </button>
          ) : (
            <span title={t("agents.task.unknownEvidence")}>{id}</span>
          )}
        </span>
      ))}
    </>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  const t = useT();
  const status = STEP_STATUS_TEXT[step.status] ?? step.status;
  return (
    <li className="task-step">
      <strong>{step.name}</strong>
      <span className="muted">
        {" "}
        ·{" "}
        {step.kind === "tool_call"
          ? t("agents.task.stepKind.toolCall")
          : t("agents.task.stepKind.stage")}{" "}
        · {status}
      </span>
      {step.kind === "tool_call" && (
        <span className="small">
          {" "}
          ·{" "}
          {t(
            step.policy_audit_id !== null
              ? "agents.task.step.toolDetailAudit"
              : "agents.task.step.toolDetail",
            {
              risk: step.risk
                ? (RISK_LABEL[step.risk] ?? step.risk)
                : t("agents.task.step.riskNotRecorded"),
              policy: step.decision
                ? (DECISION_TEXT[step.decision] ?? step.decision)
                : t("agents.task.step.noDecision"),
              id: step.policy_audit_id ?? "",
            },
          )}
        </span>
      )}
    </li>
  );
}

function EvidenceItem({
  evidence: e,
  open,
  highlighted,
  onToggle,
  register,
}: {
  evidence: AgentEvidence;
  open: boolean;
  highlighted: boolean;
  onToggle: (open: boolean) => void;
  register: (el: HTMLElement | null) => void;
}) {
  const t = useT();
  return (
    <li
      ref={register}
      tabIndex={-1}
      className={highlighted ? "task-evidence is-cited" : "task-evidence"}
      aria-label={t("agents.task.evidenceLabel", { id: e.id })}
    >
      <details open={open} onToggle={(ev) => onToggle(ev.currentTarget.open)}>
        <summary>
          <strong>{e.id}</strong> · {EVIDENCE_KIND_TEXT[e.kind] ?? e.kind} · {e.source}
          {highlighted && <span className="task-cited"> · {t("agents.task.selected")}</span>}
        </summary>
        <pre className="task-excerpt">{e.excerpt}</pre>
        {e.truncated && <p className="small warning-text">{t("agents.task.truncated")}</p>}
        <p className="muted small task-hash">{t("agents.task.hash", { hash: e.excerpt_hash })}</p>
      </details>
    </li>
  );
}

/** A finished or running agent task, in words. Nothing here is computed by the page. */
function TaskBody({ detail, onChanged }: { detail: AgentTaskDetail; onChanged: () => void }) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [note, setNote] = useState<string | null>(null);
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});
  const [cited, setCited] = useState<string | null>(null);
  const evidenceEls = useRef<Record<string, HTMLElement | null>>({});
  const state = detail.run.state;
  const known: Record<string, boolean> = {};
  for (const e of detail.evidence) known[e.id] = true;

  const show = (id: string) => {
    setOpenEvidence((o) => ({ ...o, [id]: true }));
    setCited(id);
  };
  useEffect(() => {
    if (!cited) return;
    const el = evidenceEls.current[cited];
    el?.scrollIntoView?.({ block: "nearest" });
    el?.focus({ preventScroll: true });
  }, [cited]);

  const cancel = async () => {
    const res = (await run(
      "POST",
      `/api/agent/tasks/${encodeURIComponent(detail.task.id)}/cancel`,
      {},
    )) as { cancelled: boolean; state: string } | undefined;
    if (res) {
      setNote(
        res.cancelled
          ? t("agents.task.cancelled")
          : t("agents.task.alreadyFinished", { state: res.state.toLowerCase() }),
      );
    }
    onChanged();
  };

  const diagnosis = detail.diagnosis;
  return (
    <div className="task-body">
      <p className="task-state">
        <strong>{t("agents.task.state")}</strong> {RUN_STATE_TEXT[state]}
        <span className="muted small">
          {" "}
          · {t("agents.task.updated", { since: formatSince(detail.run.updated_at) })}
        </span>
      </p>
      {detail.run.failure_reason && (
        <p className="error-text small">
          {t("agents.task.whyFailed", { reason: detail.run.failure_reason })}
        </p>
      )}
      {!isTerminalRun(state) && (
        <div className="button-row">
          <button
            type="button"
            className="btn btn-danger-outline"
            disabled={busy}
            aria-label={t("agents.task.cancelLabel", { title: detail.task.title })}
            onClick={() => void cancel()}
          >
            {t("agents.task.cancel")}
          </button>
        </div>
      )}
      <Feedback error={error} saved={note} />

      {detail.summary && (
        <p className="task-summary">
          <strong>{t("agents.task.summary")}</strong> (
          {detail.ai_used
            ? t("agents.task.summaryAi", {
                model: detail.processed_by ?? t("agents.task.modelNotNamed"),
              })
            : t("agents.task.summaryRule")}
          ): {detail.summary}
        </p>
      )}

      <details open={!isTerminalRun(state)} className="task-section">
        <summary>{t("agents.task.steps", { count: formatNumber(detail.steps.length) })}</summary>
        {detail.steps.length === 0 ? (
          <p className="muted small">{t("agents.task.noSteps")}</p>
        ) : (
          <ol className="task-steps">
            {detail.steps.map((s) => (
              <StepRow key={s.seq} step={s} />
            ))}
          </ol>
        )}
      </details>

      {(detail.parent ||
        (detail.delegations?.length ?? 0) > 0 ||
        (detail.conflicts?.length ?? 0) > 0) && (
        <section className="task-section" aria-label={t("agents.task.delegation")}>
          <h5>{t("agents.task.delegation")}</h5>
          {detail.parent && (
            <p>
              {t.rich("agents.task.delegatedBy", {
                parent: <code>{detail.parent.task_id}</code>,
              })}
            </p>
          )}
          {(detail.delegations?.length ?? 0) > 0 && (
            <ul className="task-claims">
              {detail.delegations?.map((link) => (
                <li key={link.child_task_id}>
                  {t.rich("agents.task.delegationLink", {
                    kind: <strong>{link.kind}</strong>,
                    status: link.status,
                    child: <code>{link.child_task_id}</code>,
                  })}
                  <p className="muted small">
                    {t("agents.task.grant", {
                      tools: link.grant.tools.join(", ") || t("agents.task.none"),
                      scopes: link.grant.context.scopes.join(", ") || t("agents.task.none"),
                      ceiling: link.grant.context.max_sensitivity,
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {(detail.conflicts?.length ?? 0) > 0 && (
            <div role="status" aria-label={t("agents.task.conflictsLabel")}>
              <strong>{t("agents.task.conflictsTitle")}</strong>
              <ul className="task-claims">
                {detail.conflicts?.map((conflict, i) => (
                  <li key={`${conflict.subject}-${i}`}>
                    <p>{t("agents.task.conflictSubject", { subject: conflict.subject })}</p>
                    <p>
                      {t("agents.task.conflictConclusion", {
                        child: conflict.children[0],
                        conclusion: conflict.conclusions[0],
                        evidence: conflict.evidence[0].join(", ") || t("agents.task.none"),
                      })}
                    </p>
                    <p>
                      {t("agents.task.conflictConclusion", {
                        child: conflict.children[1],
                        conclusion: conflict.conclusions[1],
                        evidence: conflict.evidence[1].join(", ") || t("agents.task.none"),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="task-section" aria-label={t("agents.task.evidence")}>
        <h5>{t("agents.task.evidenceHeading", { count: formatNumber(detail.evidence.length) })}</h5>
        {detail.evidence.length === 0 ? (
          <p className="muted small">{t("agents.task.noEvidence")}</p>
        ) : (
          <ul className="task-evidence-list">
            {detail.evidence.map((e) => (
              <EvidenceItem
                key={e.id}
                evidence={e}
                open={openEvidence[e.id] === true}
                highlighted={cited === e.id}
                onToggle={(open) => setOpenEvidence((o) => ({ ...o, [e.id]: open }))}
                register={(el) => {
                  evidenceEls.current[e.id] = el;
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {diagnosis && (
        <section className="task-section" aria-label={t("agents.task.diagnosis")}>
          <h5>{t("agents.task.diagnosis")}</h5>
          <p>{diagnosis.summary}</p>
          <ul className="task-claims">
            {diagnosis.claims.map((c, i) => (
              <li key={i}>
                <p className="memory-text">{c.text}</p>
                <p className="small">
                  <span className={c.grounded ? "mem-badge" : "mem-badge badge-warn"}>
                    {c.grounded
                      ? t("agents.task.grounded")
                      : t("agents.task.notGroundedNoEvidence")}
                  </span>
                  <span className="mem-badge">
                    {c.origin === "model"
                      ? t("agents.task.originModel")
                      : t("agents.task.originRule")}
                  </span>{" "}
                  {t("agents.task.evidenceColon")}{" "}
                  <EvidenceLinks ids={c.evidence_ids} known={known} onShow={show} />
                </p>
                {c.note && <p className="muted small">{c.note}</p>}
              </li>
            ))}
          </ul>
          <p className="muted small">
            {t("agents.task.coverage", {
              percent: formatNumber(Math.round(diagnosis.evidence_coverage * 100)),
            })}
            {diagnosis.model_reported_confidence
              ? ` ${t("agents.task.modelConfidence", { confidence: diagnosis.model_reported_confidence })}`
              : ""}
          </p>
        </section>
      )}

      {detail.proposals.length > 0 && (
        <section className="task-section" aria-label={t("agents.task.proposals")}>
          <h5>{t("agents.task.proposals")}</h5>
          <ul className="task-claims">
            {detail.proposals.map((p, i) => (
              <li key={i}>
                <p className="small">
                  <span className="mem-badge">
                    {p.advisory ? t("agents.task.advisory") : t("agents.task.proposal")}
                  </span>
                  <span className={p.grounded ? "mem-badge" : "mem-badge badge-warn"}>
                    {p.grounded ? t("agents.task.grounded") : t("agents.task.notGrounded")}
                  </span>
                </p>
                <p className="memory-text">{p.text}</p>
                <p className="muted small memory-text">
                  {t("agents.task.why", { rationale: p.rationale })}
                </p>
                <p className="small">
                  {t("agents.task.evidenceColon")}{" "}
                  <EvidenceLinks ids={p.evidence_ids} known={known} onShow={show} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.verification && (
        <section className="task-section" aria-label={t("agents.task.verification")}>
          <h5>{t("agents.task.verification")}</h5>
          <p>
            <strong>
              {detail.verification.passed
                ? t("agents.task.checksPassed")
                : t("agents.task.checksFailed")}
            </strong>
          </p>
          <ul className="task-claims">
            {detail.verification.checks.map((c, i) => (
              <li key={i}>
                <span className="mem-badge">
                  {c.passed ? t("agents.task.checkPassed") : t("common.status.failed")}
                </span>
                <span className="mem-badge">
                  {c.required
                    ? t("agents.task.checkRequired")
                    : t("agents.task.checkInformational")}
                </span>{" "}
                {c.name}
                {c.detail ? <span className="muted small"> · {c.detail}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small">
        {t("agents.task.auditRecords", { count: detail.audit_ids.length })}
      </p>
    </div>
  );
}

/** One agent task, loaded by id and kept live by `agent_run.*` and approval events. */
export function TaskCard({ taskId, title }: { taskId: string; title?: string }) {
  const t = useT();
  const { data, error, reload } = useAgentTask(taskId);
  const heading = data?.task.title ?? title ?? t("agents.task.defaultTitle");
  return (
    <article className="card task-card" aria-label={t("agents.task.cardLabel", { title: heading })}>
      <h4 className="task-title">{heading}</h4>
      {data ? (
        <TaskBody detail={data} onChanged={() => void reload()} />
      ) : error ? (
        <p className="error-text small" role="alert">
          {t("agents.task.loadFailed", { error })}
        </p>
      ) : (
        <p className="muted small" role="status">
          {t("agents.task.loading")}
        </p>
      )}
    </article>
  );
}

function LastTask({ task }: { task: AgentTaskSummary }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p>
        {t.rich("agents.task.lastTask", { title: <strong>{task.title}</strong> })}
        <span className="muted"> · {RUN_STATE_TEXT[task.state]}</span>
      </p>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t("agents.task.hideDetails") : t("agents.task.showDetails")}
      </button>
      {open && <TaskCard taskId={task.id} title={task.title} />}
    </div>
  );
}

/**
 * The agent run in progress. `exclude` are tasks already on screen (as chat items), so one task
 * is never shown twice. Hidden while Core has no agent routes.
 */
export function CurrentTask({ exclude = [] }: { exclude?: readonly string[] }) {
  const t = useT();
  const { data: tasks } = useAgentTasks(5);
  if (tasks === null) return null;
  const active = tasks.filter((x) => !isTerminalRun(x.state) && !exclude.includes(x.id));
  const last = tasks.find((x) => isTerminalRun(x.state) && !exclude.includes(x.id));
  const anyActiveElsewhere = tasks.some((x) => !isTerminalRun(x.state) && exclude.includes(x.id));
  return (
    <section aria-labelledby="current-task-h" className="current-task">
      <h3 id="current-task-h">{t("agents.task.current")}</h3>
      {active.length === 0 ? (
        <p className="muted small">
          {anyActiveElsewhere
            ? t("agents.task.runningInConversation")
            : t("agents.task.noneRunning")}
        </p>
      ) : (
        active.map((x) => <TaskCard key={x.id} taskId={x.id} title={x.title} />)
      )}
      {active.length === 0 && last && <LastTask task={last} />}
    </section>
  );
}
