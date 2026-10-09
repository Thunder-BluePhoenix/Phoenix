// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState } from "react";
import {
  DECISION_TEXT,
  isTerminalRun,
  RISK_LABEL,
  RUN_STATE_TEXT,
  STEP_STATUS_TEXT,
  taskTitle,
} from "../core/agent";
import { formatSince } from "../core/format";
import { useAction, useAgentTask, useAgentTasks } from "../core/hooks";
import type { AgentEvidence, AgentStep, AgentTaskDetail, AgentTaskSummary } from "../core/types";
import { Feedback } from "./Feedback";

const EVIDENCE_KIND_TEXT: Record<string, string> = {
  tool_output: "Tool output",
  memory: "Stored memory",
  commit: "Git commit",
  log: "Log",
  model: "AI model output (cannot back a claim)",
};

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
  if (ids.length === 0) return <span className="muted">no evidence cited</span>;
  return (
    <>
      {ids.map((id, i) => (
        <span key={`${id}:${i}`}>
          {i > 0 && ", "}
          {known[id] ? (
            <button
              type="button"
              className="link-button small"
              aria-label={`Show evidence ${id}`}
              onClick={() => onShow(id)}
            >
              {id}
            </button>
          ) : (
            <span title="This run holds no evidence with this id">{id}</span>
          )}
        </span>
      ))}
    </>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  const status = STEP_STATUS_TEXT[step.status] ?? step.status;
  return (
    <li className="task-step">
      <strong>{step.name}</strong>
      <span className="muted">
        {" "}
        · {step.kind === "tool_call" ? "tool call" : "stage"} · {status}
      </span>
      {step.kind === "tool_call" && (
        <span className="small">
          {" "}
          · Risk: {step.risk ? RISK_LABEL[step.risk] : "not recorded"} · Policy:{" "}
          {step.decision ? DECISION_TEXT[step.decision] : "no decision recorded"}
          {step.policy_audit_id !== null ? ` (audit record ${step.policy_audit_id})` : ""}
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
  return (
    <li
      ref={register}
      tabIndex={-1}
      className={highlighted ? "task-evidence is-cited" : "task-evidence"}
      aria-label={`Evidence ${e.id}`}
    >
      <details open={open} onToggle={(ev) => onToggle(ev.currentTarget.open)}>
        <summary>
          <strong>{e.id}</strong> · {EVIDENCE_KIND_TEXT[e.kind] ?? e.kind} · {e.source}
          {highlighted && <span className="task-cited"> · selected</span>}
        </summary>
        <pre className="task-excerpt">{e.excerpt}</pre>
        {e.truncated && (
          <p className="small warning-text">
            Truncated: this is only the start of the original text.
          </p>
        )}
        <p className="muted small task-hash">SHA-256 of the full text: {e.excerpt_hash}</p>
      </details>
    </li>
  );
}

/** A finished or running agent task, in words. Nothing here is computed by the page. */
function TaskBody({ detail, onChanged }: { detail: AgentTaskDetail; onChanged: () => void }) {
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
          ? "The task was cancelled."
          : `The task had already finished (${res.state.toLowerCase()}), so nothing was cancelled.`,
      );
    }
    onChanged();
  };

  const diagnosis = detail.diagnosis;
  return (
    <div className="task-body">
      <p className="task-state">
        <strong>State:</strong> {RUN_STATE_TEXT[state]}
        <span className="muted small"> · updated {formatSince(detail.run.updated_at)}</span>
      </p>
      {detail.run.failure_reason && (
        <p className="error-text small">Why it failed: {detail.run.failure_reason}</p>
      )}
      {!isTerminalRun(state) && (
        <div className="button-row">
          <button
            type="button"
            className="btn btn-danger-outline"
            disabled={busy}
            aria-label={`Cancel task: ${taskTitle(detail)}`}
            onClick={() => void cancel()}
          >
            Cancel task
          </button>
        </div>
      )}
      <Feedback error={error} saved={note} />

      {detail.summary && (
        <p className="task-summary">
          <strong>Summary</strong> (
          {detail.ai_used
            ? `written with AI: ${detail.processed_by ?? "model not named"}`
            : "rule-based, no AI was used"}
          ): {detail.summary}
        </p>
      )}

      <details open={!isTerminalRun(state)} className="task-section">
        <summary>Steps ({detail.steps.length})</summary>
        {detail.steps.length === 0 ? (
          <p className="muted small">No steps have run yet.</p>
        ) : (
          <ol className="task-steps">
            {detail.steps.map((s) => (
              <StepRow key={s.seq} step={s} />
            ))}
          </ol>
        )}
      </details>

      <section className="task-section" aria-label="Evidence">
        <h5>Evidence ({detail.evidence.length})</h5>
        {detail.evidence.length === 0 ? (
          <p className="muted small">No evidence has been collected yet.</p>
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
        <section className="task-section" aria-label="Diagnosis">
          <h5>Diagnosis</h5>
          <p>{diagnosis.summary}</p>
          <ul className="task-claims">
            {diagnosis.claims.map((c, i) => (
              <li key={i}>
                <p className="memory-text">{c.text}</p>
                <p className="small">
                  <span className={c.grounded ? "mem-badge" : "mem-badge badge-warn"}>
                    {c.grounded ? "Grounded in evidence" : "Not grounded: no valid evidence"}
                  </span>
                  <span className="mem-badge">
                    {c.origin === "model" ? "Written by an AI model" : "Written by a rule"}
                  </span>{" "}
                  Evidence: <EvidenceLinks ids={c.evidence_ids} known={known} onShow={show} />
                </p>
                {c.note && <p className="muted small">{c.note}</p>}
              </li>
            ))}
          </ul>
          <p className="muted small">
            Evidence coverage: {Math.round(diagnosis.evidence_coverage * 100)}% of claims are
            grounded (computed by Phoenix from the claims above).
            {diagnosis.model_reported_confidence
              ? ` The model said its own confidence was “${diagnosis.model_reported_confidence}”; Phoenix did not verify or use that.`
              : ""}
          </p>
        </section>
      )}

      {detail.proposals.length > 0 && (
        <section className="task-section" aria-label="Proposals">
          <h5>Proposals</h5>
          <ul className="task-claims">
            {detail.proposals.map((p, i) => (
              <li key={i}>
                <p className="small">
                  <span className="mem-badge">
                    {p.advisory ? "Advisory: nothing was changed" : "Proposal"}
                  </span>
                  <span className={p.grounded ? "mem-badge" : "mem-badge badge-warn"}>
                    {p.grounded ? "Grounded in evidence" : "Not grounded"}
                  </span>
                </p>
                <p className="memory-text">{p.text}</p>
                <p className="muted small memory-text">Why: {p.rationale}</p>
                <p className="small">
                  Evidence: <EvidenceLinks ids={p.evidence_ids} known={known} onShow={show} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.verification && (
        <section className="task-section" aria-label="Verification">
          <h5>Verification</h5>
          <p>
            <strong>
              {detail.verification.passed ? "Checks passed." : "Checks did not pass."}
            </strong>
          </p>
          <ul className="task-claims">
            {detail.verification.checks.map((c, i) => (
              <li key={i}>
                <span className="mem-badge">{c.passed ? "Passed" : "Failed"}</span>
                <span className="mem-badge">{c.required ? "Required" : "Informational"}</span>{" "}
                {c.name}
                {c.detail ? <span className="muted small"> · {c.detail}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small">
        {detail.audit_ids.length} audit {detail.audit_ids.length === 1 ? "record" : "records"} for
        this task.
      </p>
    </div>
  );
}

/** One agent task, loaded by id and kept live by `agent_run.*` and approval events. */
export function TaskCard({ taskId, title }: { taskId: string; title?: string }) {
  const { data, error, reload } = useAgentTask(taskId);
  const heading = title ?? (data ? taskTitle(data) : "Agent task");
  return (
    <article className="card task-card" aria-label={`Agent task: ${heading}`}>
      <h4 className="task-title">{heading}</h4>
      {data ? (
        <TaskBody detail={data} onChanged={() => void reload()} />
      ) : error ? (
        <p className="error-text small" role="alert">
          Could not load this task: {error}
        </p>
      ) : (
        <p className="muted small" role="status">
          Loading the task…
        </p>
      )}
    </article>
  );
}

function LastTask({ task }: { task: AgentTaskSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p>
        Last task: <strong>{task.title}</strong>
        <span className="muted"> · {RUN_STATE_TEXT[task.state]}</span>
      </p>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide details" : "Show details"}
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
  const { data: tasks } = useAgentTasks(5);
  if (tasks === null) return null;
  const active = tasks.filter((t) => !isTerminalRun(t.state) && !exclude.includes(t.id));
  const last = tasks.find((t) => isTerminalRun(t.state) && !exclude.includes(t.id));
  const anyActiveElsewhere = tasks.some((t) => !isTerminalRun(t.state) && exclude.includes(t.id));
  return (
    <section aria-labelledby="current-task-h" className="current-task">
      <h3 id="current-task-h">Current task</h3>
      {active.length === 0 ? (
        <p className="muted small">
          {anyActiveElsewhere
            ? "The running task is in the conversation."
            : "No agent task is running."}
        </p>
      ) : (
        active.map((t) => <TaskCard key={t.id} taskId={t.id} title={t.title} />)
      )}
      {active.length === 0 && last && <LastTask task={last} />}
    </section>
  );
}
