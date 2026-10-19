// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { needsSecondStep, RISK_LABEL, SIDE_EFFECT_ACTION } from "../core/agent";
import { formatTime, SIDE_EFFECT_LABEL } from "../core/format";
import { useAction, useConfirmations } from "../core/hooks";
import type { Confirmation } from "../core/types";
import { useT, type MessageKey } from "../i18n";
import { TaskCard } from "./TaskView";

/**
 * Whether approving needs a second, explicit step. High and Critical risk always do. When Core
 * gave no risk at all, only an action that changes production does: an unknown risk is not treated
 * as a low one, but ordinary actions are not blocked behind a checkbox either.
 */
export function requiresUnderstanding(c: Confirmation): boolean {
  return c.risk ? needsSecondStep(c.risk) : c.sideEffect === "production";
}

const RISK_NOTE: Record<NonNullable<Confirmation["risk"]>, MessageKey> = {
  low: "agents.approvals.riskNote.low",
  medium: "agents.approvals.riskNote.medium",
  high: "agents.approvals.riskNote.high",
  critical: "agents.approvals.riskNote.critical",
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
  const t = useT();
  const { run, busy, error } = useAction();
  const [understood, setUnderstood] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const id = useId();
  const second = requiresUnderstanding(c);
  const effect = SIDE_EFFECT_LABEL[c.sideEffect] ?? c.sideEffect;
  const action = SIDE_EFFECT_ACTION[c.sideEffect] ?? t("agents.sideEffectAction.fallback");
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
        <dt>{t("agents.approvals.whatWillHappen")}</dt>
        <dd>
          {t("agents.approvals.whatText", {
            capability: c.capabilityId,
            command: c.command,
            effect,
          })}
        </dd>
        <dt>{t("agents.approvals.preview")}</dt>
        <dd>
          {c.preview ? (
            <span className="memory-text">{c.preview}</span>
          ) : (
            <Missing>{t("agents.approvals.noPreview")}</Missing>
          )}
        </dd>
        <dt>{t("agents.approvals.target")}</dt>
        <dd>{c.target ? c.target : <Missing>{t("agents.approvals.noTarget")}</Missing>}</dd>
        <dt>{t("agents.approvals.risk")}</dt>
        <dd>
          {c.risk ? (
            <span className={`risk-badge risk-${c.risk}`}>
              {RISK_LABEL[c.risk]}
              <span className="sr-only">. {t(RISK_NOTE[c.risk])}</span>
            </span>
          ) : (
            <Missing>{t("agents.approvals.noRisk")}</Missing>
          )}
        </dd>
        <dt>{t("agents.approvals.permissions")}</dt>
        <dd>
          {c.permissions.length > 0
            ? c.permissions.join(", ")
            : t("agents.approvals.noPermissions")}
        </dd>
        {c.details?.run && c.details.step && (
          <>
            <dt>{t("agents.approvals.workflowStep")}</dt>
            <dd>
              {c.details.step} ·{" "}
              {c.capabilityId === "workflows"
                ? t("agents.approvals.workflowApproval")
                : t("agents.approvals.toolPolicyApproval")}
            </dd>
          </>
        )}
        {(c.task_id || (c.evidence_ids && c.evidence_ids.length > 0)) && (
          <>
            <dt>{t("agents.approvals.requestedBy")}</dt>
            <dd>
              {c.task_id ? (
                <>
                  {t("agents.approvals.byAgentTask")}{" "}
                  <button
                    type="button"
                    className="link-button small"
                    aria-expanded={showTask}
                    onClick={() => setShowTask(!showTask)}
                  >
                    {showTask ? t("agents.approvals.hideTask") : t("agents.approvals.showTask")}
                  </button>
                </>
              ) : (
                t("agents.approvals.byAgentRun")
              )}
              {c.evidence_ids && c.evidence_ids.length > 0 && (
                <> · {t("agents.approvals.evidenceHeld", { ids: c.evidence_ids.join(", ") })}</>
              )}
            </dd>
          </>
        )}
        {expires && (
          <>
            <dt>{t("agents.approvals.expires")}</dt>
            <dd>{t("agents.approvals.expiresAt", { time: expires })}</dd>
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
          {t("agents.approvals.understand", { action })}
        </label>
      )}
      <div className="button-row wrap">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (second && !understood)}
          aria-label={t("agents.approvals.approveLabel", { summary: c.summary })}
          onClick={() => void decide(true)}
        >
          {t("agents.approvals.approve")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          aria-label={t("agents.approvals.rejectLabel", { summary: c.summary })}
          onClick={() => void decide(false)}
        >
          {t("agents.approvals.reject")}
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
export function Approvals({ filter }: { filter?: (confirmation: Confirmation) => boolean }) {
  const t = useT();
  const { data: confirmations, error, reload } = useConfirmations();
  const pending = filter ? confirmations.filter(filter) : confirmations;
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
    setAnnouncement(
      t(approved ? "agents.approvals.announceApproved" : "agents.approvals.announceRejected", {
        summary: c.summary,
      }),
    );
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
          {pending.length > 0
            ? t("agents.approvals.headingPending")
            : t("agents.approvals.headingIdle")}
        </h3>
        {pending.length === 0 ? (
          <p className="muted small">{t("agents.approvals.nothing")}</p>
        ) : (
          <>
            <p className="muted small">{t("agents.approvals.intro")}</p>
            <ul
              className="card-list"
              aria-label={t("agents.approvals.listLabel")}
              onKeyDown={onKey}
            >
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
