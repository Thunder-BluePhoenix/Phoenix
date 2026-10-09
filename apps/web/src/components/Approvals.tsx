// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { needsSecondStep, RISK_LABEL, SIDE_EFFECT_ACTION } from "../core/agent";
import { formatTime, SIDE_EFFECT_LABEL } from "../core/format";
import { useAction, useConfirmations } from "../core/hooks";
import type { Confirmation } from "../core/types";
import { TaskCard } from "./TaskView";

/**
 * Whether approving needs a second, explicit step. High and Critical risk always do. When Core
 * gave no risk at all, only an action that changes production does: an unknown risk is not treated
 * as a low one, but ordinary actions are not blocked behind a checkbox either.
 */
export function requiresUnderstanding(c: Confirmation): boolean {
  return c.risk ? needsSecondStep(c.risk) : c.sideEffect === "production";
}

const RISK_NOTE: Record<NonNullable<Confirmation["risk"]>, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk: check the details before approving",
  critical: "Critical risk: check the details before approving",
};

function Missing({ children }: { children: string }) {
  return <span className="approval-missing">{children}</span>;
}

/** One pending request, fully explained before the buttons. Missing facts are said to be missing. */
function ApprovalCard({
  confirmation: c,
  cardRef,
  onDecided,
}: {
  confirmation: Confirmation;
  cardRef: (el: HTMLLIElement | null) => void;
  onDecided: (approved: boolean) => void;
}) {
  const { run, busy, error } = useAction();
  const [understood, setUnderstood] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const id = useId();
  const second = requiresUnderstanding(c);
  const effect = SIDE_EFFECT_LABEL[c.sideEffect] ?? c.sideEffect;
  const action = SIDE_EFFECT_ACTION[c.sideEffect] ?? "carry out this action";
  const expires = c.expiresAt ? formatTime(c.expiresAt) : "";

  const decide = async (approve: boolean) => {
    const res = await run("POST", `/api/confirmations/${encodeURIComponent(c.id)}`, { approve });
    if (res !== undefined) onDecided(approve);
  };

  return (
    <li
      ref={cardRef}
      tabIndex={-1}
      className="card approval"
      aria-labelledby={`${id}-title`}
      data-confirmation={c.id}
    >
      <p id={`${id}-title`} className="approval-summary">
        {c.summary}
      </p>
      <dl className="approval-facts small">
        <dt>What will happen</dt>
        <dd>
          Capability “{c.capabilityId}” will run the command “{c.command}”. Effect: {effect}.
        </dd>
        <dt>Preview</dt>
        <dd>
          {c.preview ? (
            <span className="memory-text">{c.preview}</span>
          ) : (
            <Missing>No preview was provided by this capability.</Missing>
          )}
        </dd>
        <dt>Target</dt>
        <dd>
          {c.target ? c.target : <Missing>No target was provided by this capability.</Missing>}
        </dd>
        <dt>Risk</dt>
        <dd>
          {c.risk ? (
            <span className={`risk-badge risk-${c.risk}`}>
              {RISK_LABEL[c.risk]}
              <span className="sr-only">. {RISK_NOTE[c.risk]}</span>
            </span>
          ) : (
            <Missing>No risk level was provided.</Missing>
          )}
        </dd>
        <dt>Permissions used</dt>
        <dd>{c.permissions.length > 0 ? c.permissions.join(", ") : "None listed."}</dd>
        {(c.task_id || (c.evidence_ids && c.evidence_ids.length > 0)) && (
          <>
            <dt>Requested by</dt>
            <dd>
              {c.task_id ? (
                <>
                  an agent task{" "}
                  <button
                    type="button"
                    className="link-button small"
                    aria-expanded={showTask}
                    onClick={() => setShowTask(!showTask)}
                  >
                    {showTask ? "Hide the task" : "Show the task and its evidence"}
                  </button>
                </>
              ) : (
                "an agent run"
              )}
              {c.evidence_ids && c.evidence_ids.length > 0 && (
                <> · evidence held so far: {c.evidence_ids.join(", ")}</>
              )}
            </dd>
          </>
        )}
        {expires && (
          <>
            <dt>Expires</dt>
            <dd>at {expires}; if you do nothing it is declined</dd>
          </>
        )}
      </dl>
      {showTask && c.task_id && <TaskCard taskId={c.task_id} />}
      {second && (
        <label className="choice approval-understand">
          <input
            type="checkbox"
            checked={understood}
            disabled={busy}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          I understand this will {action}
        </label>
      )}
      <div className="button-row wrap">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (second && !understood)}
          aria-label={`Approve: ${c.summary}`}
          onClick={() => void decide(true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          aria-label={`Reject: ${c.summary}`}
          onClick={() => void decide(false)}
        >
          Reject
        </button>
      </div>
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

interface FocusPlan {
  /** The card that was just decided; focus moves once it has left the list. */
  decided: string;
  /** Where focus goes: the next card, else the previous one, else the section heading. */
  next: string | null;
}

/**
 * The approvals queue (Phase 32). Every request is an explanation card; Up/Down move between
 * cards; nothing is approved by a global shortcut. Results are announced in a polite live region.
 */
export function Approvals() {
  const { data: pending, error, reload } = useConfirmations();
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const cards = useRef<Record<string, HTMLLIElement | null>>({});
  const plan = useRef<FocusPlan | null>(null);

  useEffect(() => {
    const p = plan.current;
    if (!p || pending.some((c) => c.id === p.decided)) return;
    plan.current = null;
    (p.next ? cards.current[p.next] : heading.current)?.focus();
  }, [pending]);

  const decided = (c: Confirmation, approved: boolean) => {
    const i = pending.findIndex((x) => x.id === c.id);
    const neighbour = pending[i + 1] ?? pending[i - 1];
    plan.current = { decided: c.id, next: neighbour?.id ?? null };
    setAnnouncement(`${approved ? "Approved" : "Rejected"}: ${c.summary}.`);
    void reload();
  };

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const target = e.target as HTMLElement;
    if (target.closest("pre, textarea, input[type='text']")) return;
    const here = target.closest<HTMLElement>("[data-confirmation]")?.dataset.confirmation;
    const i = pending.findIndex((c) => c.id === here);
    if (i < 0) return;
    const next = pending[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    cards.current[next.id]?.focus();
  };

  // One live region at a fixed position, so a screen reader hears the result even when the last
  // card disappears with it.
  const live = (
    <p className="approval-live small" role="status" aria-live="polite">
      {announcement}
    </p>
  );
  if (error) return <p className="error-text">{error}</p>;
  if (pending.length === 0 && !announcement) return live;
  return (
    <>
      {live}
      <section aria-labelledby="approvals-h" className="approvals">
        <h3 id="approvals-h" ref={heading} tabIndex={-1}>
          {pending.length > 0 ? "Needs your approval" : "Approvals"}
        </h3>
        {pending.length === 0 ? (
          <p className="muted small">Nothing is waiting for your approval.</p>
        ) : (
          <>
            <p className="muted small">
              Read what each request will do before you decide. Use the Up and Down arrow keys to
              move between requests.
            </p>
            <ul className="card-list" aria-label="Pending approvals" onKeyDown={onKey}>
              {pending.map((c) => (
                <ApprovalCard
                  key={c.id}
                  confirmation={c}
                  cardRef={(el) => {
                    cards.current[c.id] = el;
                  }}
                  onDecided={(approved) => decided(c, approved)}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
