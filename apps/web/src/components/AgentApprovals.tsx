// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { useAgentApprovals } from "../core/hooks";
import type { AgentApproval } from "../core/types";

/** Longest command or path shown on a card; the full text is never needed to decide. */
const SHOWN_CHARS = 300;
const MAX_QUESTIONS = 4;
const ALWAYS_TTL_MINUTES = 60;

const truncate = (text: string) =>
  text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS)}…` : text;

/** "1:59", or "0:07": whole seconds left, never negative. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  return `${Math.floor(total / 60)}:${seconds}`;
}

/** Wall-clock now, re-read every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const titleOf = (a: AgentApproval) =>
  a.kind === "question" ? `${a.agent} has a question` : `${a.agent} wants to use ${a.tool}`;

type Outcome = "allowed" | "denied" | "always" | "answered" | "terminal" | "stale";

const OUTCOME_TEXT: Record<Outcome, string> = {
  allowed: "Allowed",
  denied: "Denied",
  always: "Allowed here for 1 hour",
  answered: "Answers sent",
  terminal: "Left for the terminal",
  stale: "Already answered",
};

/** What Core is sent. `answers` is keyed by question text; a multi-select answer joins labels with ",". */
type DecisionBody =
  | { behavior: "allow" | "deny" }
  | { behavior: "allow"; always: { ttl_minutes: number } }
  | { behavior: "allow"; answers: Record<string, string> }
  | { behavior: "deny"; terminal: true };

function Questions({
  approval: a,
  picks,
  disabled,
  onPick,
}: {
  approval: AgentApproval;
  picks: string[][];
  disabled: boolean;
  onPick: (index: number, label: string, multi: boolean, on: boolean) => void;
}) {
  const id = useId();
  const questions = (a.questions ?? []).slice(0, MAX_QUESTIONS);
  return (
    <div className="agent-questions">
      {questions.map((q, i) => (
        <fieldset key={`${i}:${q.question}`} className="agent-question">
          <legend>
            <span className="muted small">{q.header}</span> {q.question}
          </legend>
          {q.options.map((o) => {
            const multi = q.multiSelect === true;
            return (
              <label key={o.label} className="choice">
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={`${id}-q${i}`}
                  checked={picks[i]?.includes(o.label) ?? false}
                  disabled={disabled}
                  onChange={(e) => onPick(i, o.label, multi, e.target.checked)}
                />
                <span>
                  {o.label}
                  {o.description && <span className="muted small"> · {o.description}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

/** One pending coding-agent request. Everything from the agent is rendered as text, never as HTML. */
function AgentApprovalCard({
  approval: a,
  now,
  cardRef,
  onDecided,
}: {
  approval: AgentApproval;
  now: number;
  cardRef: (el: HTMLLIElement | null) => void;
  onDecided: (outcome: Outcome) => void;
}) {
  const client = useClient();
  const id = useId();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = (a.questions ?? []).slice(0, MAX_QUESTIONS);
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
  const title = titleOf(a);
  const remaining = Date.parse(a.expires_at) - now;
  const isQuestion = a.kind === "question";
  const answered = questions.length > 0 && questions.every((_, i) => (picks[i]?.length ?? 0) > 0);
  const { command, path, description } = a.input_summary;

  const pick = (index: number, label: string, multi: boolean, on: boolean) =>
    setPicks((prev) =>
      prev.map((labels, i) => {
        if (i !== index) return labels;
        if (!multi) return [label];
        return on ? [...labels, label] : labels.filter((l) => l !== label);
      }),
    );

  const answers = (): Record<string, string> => {
    const out: Record<string, string> = {};
    questions.forEach((q, i) => {
      out[q.question] = q.options
        .map((o) => o.label)
        .filter((l) => picks[i]?.includes(l))
        .join(",");
    });
    return out;
  };

  const decide = async (body: DecisionBody, outcome: Outcome) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await client.request(
        "POST",
        `/api/agent-approvals/${encodeURIComponent(a.id)}/decision`,
        body,
      );
      onDecided(outcome);
    } catch (err) {
      // 409: someone else (another window, the terminal, the clock) answered first. Not a failure.
      if (err instanceof ApiError && err.status === 409) onDecided("stale");
      else setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <li
      ref={cardRef}
      tabIndex={-1}
      className="card approval agent-approval"
      aria-labelledby={`${id}-title`}
      data-agent-approval={a.id}
    >
      <p id={`${id}-title`} className="approval-summary">
        {title}
      </p>
      <dl className="approval-facts small">
        <dt>Agent</dt>
        <dd>{a.agent}</dd>
        <dt>Project</dt>
        <dd className="memory-text">{a.project}</dd>
        <dt>Tool</dt>
        <dd>{a.tool}</dd>
        {command && (
          <>
            <dt>Command</dt>
            <dd>
              <code className="memory-text">{truncate(command)}</code>
            </dd>
          </>
        )}
        {path && (
          <>
            <dt>Path</dt>
            <dd>
              <code className="memory-text">{truncate(path)}</code>
            </dd>
          </>
        )}
        {description && (
          <>
            <dt>Description</dt>
            <dd className="memory-text">{truncate(description)}</dd>
          </>
        )}
        {Number.isFinite(remaining) && (
          <>
            <dt>Time left</dt>
            <dd>
              <span className="agent-countdown">{formatRemaining(remaining)}</span>; after that the
              agent asks you in its terminal
            </dd>
          </>
        )}
      </dl>
      {isQuestion && questions.length > 0 && (
        <Questions approval={a} picks={picks} disabled={busy} onPick={pick} />
      )}
      {isQuestion && questions.length === 0 && (
        <p className="muted small">The agent sent no questions. Reply in its terminal.</p>
      )}
      <div className="button-row wrap">
        {isQuestion ? (
          questions.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !answered}
              aria-label={`Send answers: ${title}`}
              onClick={() => void decide({ behavior: "allow", answers: answers() }, "answered")}
            >
              Send answers
            </button>
          )
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            aria-label={`Allow: ${title}`}
            onClick={() => void decide({ behavior: "allow" }, "allowed")}
          >
            Allow
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          aria-label={`Deny: ${title}`}
          onClick={() => void decide({ behavior: "deny" }, "denied")}
        >
          Deny
        </button>
        {!isQuestion && a.always_ok === true && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            aria-label={`Always allow here (1 h): ${title}`}
            onClick={() =>
              void decide(
                { behavior: "allow", always: { ttl_minutes: ALWAYS_TTL_MINUTES } },
                "always",
              )
            }
          >
            Always allow here (1 h)
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          aria-label={`Reply in terminal: ${title}`}
          onClick={() => void decide({ behavior: "deny", terminal: true }, "terminal")}
        >
          Reply in terminal
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
  /** The card that was just answered; focus moves once it has left the list. */
  decided: string;
  /** The next card, else the previous one, else the section heading. */
  next: string | null;
}

/**
 * Requests from coding agents (Phase 56). Kept live by the `agent.approval.*` events, so answering
 * in one window clears the card in the others. Shows nothing while none is waiting, and nothing if
 * the list cannot be read: the ordinary approvals queue already reports an unreachable Core.
 */
export function AgentApprovals() {
  const { data, error, reload } = useAgentApprovals();
  const [gone, setGone] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const now = useNow(data.length > 0);
  const heading = useRef<HTMLHeadingElement>(null);
  const cards = useRef<Record<string, HTMLLIElement | null>>({});
  const plan = useRef<FocusPlan | null>(null);
  const expiredSeen = useRef<string[]>([]);

  const live = data.filter((a) => !gone.includes(a.id));
  const pending = live.filter((a) => !(Date.parse(a.expires_at) <= now));

  useEffect(() => {
    const lapsed = live.filter(
      (a) => Date.parse(a.expires_at) <= now && !expiredSeen.current.includes(a.id),
    );
    if (lapsed.length === 0) return;
    expiredSeen.current.push(...lapsed.map((a) => a.id));
    setAnnouncement(`Expired: ${lapsed.map(titleOf).join("; ")}.`);
    void reload();
  }, [live, now, reload]);

  useEffect(() => {
    const p = plan.current;
    if (!p || pending.some((a) => a.id === p.decided)) return;
    plan.current = null;
    (p.next ? cards.current[p.next] : heading.current)?.focus();
  }, [pending]);

  const decided = (a: AgentApproval, outcome: Outcome) => {
    const i = pending.findIndex((x) => x.id === a.id);
    const neighbour = pending[i + 1] ?? pending[i - 1];
    plan.current = { decided: a.id, next: neighbour?.id ?? null };
    setGone((ids) => [...ids, a.id]);
    setAnnouncement(`${OUTCOME_TEXT[outcome]}: ${titleOf(a)}.`);
    void reload();
  };

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const target = e.target as HTMLElement;
    if (target.closest("pre, textarea, input[type='text'], input[type='radio']")) return;
    const here = target.closest<HTMLElement>("[data-agent-approval]")?.dataset.agentApproval;
    const i = pending.findIndex((a) => a.id === here);
    if (i < 0) return;
    const next = pending[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    cards.current[next.id]?.focus();
  };

  if (error || (pending.length === 0 && !announcement)) return null;
  return (
    <>
      <p
        className="approval-live small"
        role="status"
        aria-live="polite"
        aria-label="Agent approval results"
      >
        {announcement}
      </p>
      <section aria-labelledby="agent-approvals-h" className="approvals agent-approvals">
        <h3 id="agent-approvals-h" ref={heading} tabIndex={-1}>
          {pending.length > 0 ? "Coding agents are asking" : "Coding agent requests"}
        </h3>
        {pending.length === 0 ? (
          <p className="muted small">No coding agent is waiting for you.</p>
        ) : (
          <>
            <p className="muted small">
              Each request stays here until you answer it or it expires. Use the Up and Down arrow
              keys to move between requests.
            </p>
            <ul className="card-list" aria-label="Pending agent requests" onKeyDown={onKey}>
              {pending.map((a) => (
                <AgentApprovalCard
                  key={a.id}
                  approval={a}
                  now={now}
                  cardRef={(el) => {
                    cards.current[a.id] = el;
                  }}
                  onDecided={(outcome) => decided(a, outcome)}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
