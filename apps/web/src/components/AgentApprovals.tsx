// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { formatNumber } from "../core/format";
import { useAgentApprovals } from "../core/hooks";
import type { AgentApproval } from "../core/types";
import { useT, type MessageKey, type Translate } from "../i18n";
import { hasHiddenChars, RevealedBlock, revealNodes, revealPlain } from "./RevealedText";
import "./agent-approvals-compact.css";

const MAX_QUESTIONS = 4;
const ALWAYS_TTL_MINUTES = 60;

/** "1:59", or "0:07": whole seconds left, never negative. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const digits = { useGrouping: false };
  const seconds = formatNumber(total % 60, undefined, { ...digits, minimumIntegerDigits: 2 });
  return `${formatNumber(Math.floor(total / 60), undefined, digits)}:${seconds}`;
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

const titleOf = (t: Translate, a: AgentApproval) =>
  a.kind === "question"
    ? t("agents.agentApprovals.titleQuestion", { agent: revealPlain(a.agent) })
    : t("agents.agentApprovals.titleTool", {
        agent: revealPlain(a.agent),
        tool: revealPlain(a.tool),
      });

type Outcome = "allowed" | "denied" | "always" | "answered" | "terminal" | "stale";

const OUTCOME_TEXT: Record<Outcome, MessageKey> = {
  allowed: "agents.agentApprovals.outcome.allowed",
  denied: "agents.agentApprovals.outcome.denied",
  always: "agents.agentApprovals.outcome.always",
  answered: "agents.agentApprovals.outcome.answered",
  terminal: "agents.agentApprovals.outcome.terminal",
  stale: "agents.agentApprovals.outcome.stale",
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
  const t = useT();
  const client = useClient();
  const id = useId();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = (a.questions ?? []).slice(0, MAX_QUESTIONS);
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
  const title = titleOf(t, a);
  const remaining = Date.parse(a.expires_at) - now;
  const isQuestion = a.kind === "question";
  const answered = questions.length > 0 && questions.every((_, i) => (picks[i]?.length ?? 0) > 0);
  const { command, path, description, detail } = a.input_summary;
  const hidden = [a.agent, a.project, a.tool, command, path, description, detail].some(
    (text) => text !== undefined && hasHiddenChars(text),
  );

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
      else setError(err instanceof ApiError ? err.message : t("common.error.requestFailed"));
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
      {hidden && (
        <p className="approval-missing small" role="note">
          {t("agents.agentApprovals.hiddenWarning", { example: "\\u{202e}" })}
        </p>
      )}
      <dl className="approval-facts small">
        <dt>{t("agents.agentApprovals.agent")}</dt>
        <dd className="reveal-block">{revealNodes(a.agent)}</dd>
        <dt>{t("agents.agentApprovals.project")}</dt>
        <dd className="reveal-block">{revealNodes(a.project)}</dd>
        <dt>{t("agents.agentApprovals.tool")}</dt>
        <dd className="reveal-block">{revealNodes(a.tool)}</dd>
        {command && (
          <>
            <dt>{t("agents.agentApprovals.command")}</dt>
            <dd>
              <RevealedBlock text={command} />
            </dd>
          </>
        )}
        {path && (
          <>
            <dt>{t("agents.agentApprovals.path")}</dt>
            <dd>
              <RevealedBlock text={path} />
            </dd>
          </>
        )}
        {description && (
          <>
            <dt>{t("common.label.description")}</dt>
            <dd>
              <RevealedBlock text={description} />
            </dd>
          </>
        )}
        {detail && (
          <>
            <dt>{t("agents.agentApprovals.otherArguments")}</dt>
            <dd>
              <RevealedBlock text={detail} />
            </dd>
          </>
        )}
        {a.via === "relay" && (
          <>
            <dt>{t("agents.agentApprovals.sentThrough")}</dt>
            <dd>{t("agents.agentApprovals.localRelay")}</dd>
          </>
        )}
        {Number.isFinite(remaining) && (
          <>
            <dt>{t("agents.agentApprovals.timeLeft")}</dt>
            <dd>
              {t.rich("agents.agentApprovals.countdown", {
                countdown: <span className="agent-countdown">{formatRemaining(remaining)}</span>,
              })}
            </dd>
          </>
        )}
      </dl>
      {isQuestion && questions.length > 0 && (
        <Questions approval={a} picks={picks} disabled={busy} onPick={pick} />
      )}
      {isQuestion && questions.length === 0 && (
        <p className="muted small">{t("agents.agentApprovals.noQuestions")}</p>
      )}
      <div className="button-row wrap">
        {isQuestion ? (
          questions.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !answered}
              aria-label={t("agents.agentApprovals.sendAnswersLabel", { title })}
              onClick={() => void decide({ behavior: "allow", answers: answers() }, "answered")}
            >
              {t("agents.agentApprovals.sendAnswers")}
            </button>
          )
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            aria-label={t("agents.agentApprovals.allowLabel", { title })}
            onClick={() => void decide({ behavior: "allow" }, "allowed")}
          >
            {t("agents.agentApprovals.allow")}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          aria-label={t("agents.agentApprovals.denyLabel", { title })}
          onClick={() => void decide({ behavior: "deny" }, "denied")}
        >
          {t("agents.agentApprovals.deny")}
        </button>
        {!isQuestion && a.always_ok === true && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            aria-label={t("agents.agentApprovals.alwaysLabel", { title })}
            onClick={() =>
              void decide(
                { behavior: "allow", always: { ttl_minutes: ALWAYS_TTL_MINUTES } },
                "always",
              )
            }
          >
            {t("agents.agentApprovals.always")}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          aria-label={t("agents.agentApprovals.terminalLabel", { title })}
          onClick={() => void decide({ behavior: "deny", terminal: true }, "terminal")}
        >
          {t("agents.agentApprovals.terminal")}
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
 *
 * `compact` is the same cards, hook and decision handling for the small floating window and the
 * island: no intro text, no "nothing waiting" panel, and the outcome is spoken rather than drawn.
 */
export function AgentApprovals({ compact = false }: { compact?: boolean } = {}) {
  const t = useT();
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
    setAnnouncement(
      t("agents.agentApprovals.expired", { titles: lapsed.map((a) => titleOf(t, a)).join("; ") }),
    );
    void reload();
  }, [live, now, reload, t]);

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
    setAnnouncement(
      t("agents.agentApprovals.outcomeAnnounce", {
        outcome: t(OUTCOME_TEXT[outcome]),
        title: titleOf(t, a),
      }),
    );
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
  const status = (
    <p
      className={`approval-live small${compact ? " agent-approvals-live-compact" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={t("agents.agentApprovals.resultsLabel")}
    >
      {announcement}
    </p>
  );
  if (compact && pending.length === 0) return status;
  return (
    <>
      {status}
      <section
        aria-labelledby="agent-approvals-h"
        className={`approvals agent-approvals${compact ? " agent-approvals-compact" : ""}`}
      >
        <h3 id="agent-approvals-h" ref={heading} tabIndex={-1}>
          {pending.length > 0
            ? t("agents.agentApprovals.headingPending")
            : t("agents.agentApprovals.headingIdle")}
        </h3>
        {pending.length === 0 ? (
          <p className="muted small">{t("agents.agentApprovals.nothing")}</p>
        ) : (
          <>
            {!compact && <p className="muted small">{t("agents.agentApprovals.intro")}</p>}
            <ul
              className="card-list"
              aria-label={t("agents.agentApprovals.listLabel")}
              onKeyDown={onKey}
            >
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
