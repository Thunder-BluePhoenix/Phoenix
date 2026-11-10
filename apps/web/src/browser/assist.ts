// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 95: the chrome's half of the Fawkes browsing assistant. The goal goes to
// `POST /api/browser/assist`; the answer is a PROPOSED list of steps (data). This module never runs
// anything by itself: a step runs only when the person presses its own button, and then only through
// `POST /api/capabilities/browser/commands/<kind>`, which raises the approval card. Core re-reads the
// page and re-checks the action after approval (a second, independent check); the page check here is
// for feedback and a fast refusal.
import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "../core/context";
import { useCommandAction } from "../core/hooks";
import type { TabInfo } from "./shell";
import { CONTROL, BIDI } from "./unsafe-text";

export const ASSIST_PATH = "/api/browser/assist";
/** Same limit as the route (`MAX_GOAL_CHARS`). */
export const ASSIST_MAX_GOAL = 500;
/** The route proposes at most this many steps; a longer list is not an answer we trust. */
export const ASSIST_MAX_STEPS = 5;
const MAX_TYPED_CHARS = 4096;
const MAX_SELECTOR_CHARS = 512;
/** The same grammar the browser capability's manifest accepts for a control. */
const SELECTOR = /^[a-z]+(?:#[A-Za-z0-9_:.-]{1,80}|\[name="[A-Za-z0-9_:.-]{1,80}"\])$/;
/** Zero-width characters and BOM: the route rejects them in a goal along with control and bidi marks. */
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/;

export type GoalProblem = "too_long" | "control" | "hidden";

/** `null` when the goal may be sent. Mirrors the route's rules; the route checks again. */
export function goalProblem(goal: string): GoalProblem | null {
  if (CONTROL.test(goal)) return "control";
  if (BIDI.test(goal) || ZERO_WIDTH.test(goal)) return "hidden";
  if (goal.trim().length > ASSIST_MAX_GOAL) return "too_long";
  return null;
}

export type StepKind = "click" | "type" | "submit";
export const STEP_KINDS: readonly StepKind[] = ["click", "type", "submit"];

export interface AssistStep {
  kind: StepKind;
  selector: string;
  /** Only for `type`. */
  text?: string;
  /** Only for `type`: Core marked the text as written by the local model, not by the person. */
  modelWritten?: true;
}

export type FailureStatus = "no_local_model" | "local_model_failed" | "no_browser";

export type AssistAnswer =
  | {
      status: "ok";
      pageUrl: string;
      steps: readonly AssistStep[];
      dropped: number;
      processedBy: string;
    }
  | { status: FailureStatus };

/** One property of an untrusted value, `undefined` when it is not an object. */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

/** Reads one step; anything off-grammar makes the whole answer unusable (`null`). */
function parseStep(value: unknown): AssistStep | null {
  if (value === null || typeof value !== "object") return null;
  const kind = field(value, "kind");
  const selector = field(value, "selector");
  const text = field(value, "text");
  if (kind !== "click" && kind !== "type" && kind !== "submit") return null;
  if (
    typeof selector !== "string" ||
    selector.length > MAX_SELECTOR_CHARS ||
    !SELECTOR.test(selector)
  )
    return null;
  if (kind === "type") {
    // Core marks every typed text as model-written; an answer without the mark is not trusted.
    if (typeof text !== "string" || text.length > MAX_TYPED_CHARS) return null;
    if (field(value, "model_written") !== true) return null;
    return { kind, selector, text, modelWritten: true };
  }
  return text === undefined ? { kind, selector } : null;
}

/** A page address the commands accept: credential-free http(s). */
function isPageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

/** Strict parse of the route's answer. `null` means "not an answer": the panel shows a fixed error. */
export function parseAssistAnswer(value: unknown): AssistAnswer | null {
  const status = field(value, "status");
  if (status === "no_local_model" || status === "local_model_failed" || status === "no_browser")
    return { status };
  const plan = field(value, "plan");
  if (status !== "ok" || plan === null || typeof plan !== "object") return null;
  const pageUrl = field(plan, "page_url");
  const actions = field(plan, "actions");
  if (!isPageUrl(pageUrl) || !Array.isArray(actions) || actions.length > ASSIST_MAX_STEPS)
    return null;
  const steps: AssistStep[] = [];
  for (const raw of actions) {
    const step = parseStep(raw);
    if (!step) return null;
    steps.push(step);
  }
  const dropped = field(value, "dropped");
  const processedBy = field(value, "processed_by");
  if (typeof dropped !== "number" || !Number.isInteger(dropped) || dropped < 0) return null;
  if (typeof processedBy !== "string") return null;
  return { status: "ok", pageUrl, steps, dropped, processedBy };
}

/** The page as the commands key it: no fragment. Anything that does not parse never matches. */
export function pageKey(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export type StepRefusal = "no_tab" | "moved";

/**
 * Whether a step of a proposal may be put to the person now: the tab the plan was proposed for must
 * still be the active one AND still on `plan.page_url` (fragment ignored). Pure, so a test can pin it.
 */
export function stepRefusal(
  plan: { tabId: string; pageUrl: string },
  tab: Pick<TabInfo, "tabId" | "url"> | null,
): StepRefusal | null {
  if (tab === null) return "no_tab";
  const wanted = pageKey(plan.pageUrl);
  const current = pageKey(tab.url);
  if (tab.tabId !== plan.tabId || wanted === null || current === null || wanted !== current)
    return "moved";
  return null;
}

export type StepFailure = "denied" | "blocked" | "unavailable" | "timeout" | "failed";

/** Core's closed error code → a fixed message key; Core's own text is never shown. */
export function stepFailure(code: string | null): StepFailure {
  switch (code) {
    case "PERMISSION_DENIED":
      return "denied";
    case "SECURITY_POLICY_BLOCKED":
      return "blocked";
    case "CAPABILITY_UNAVAILABLE":
      return "unavailable";
    case "OPERATION_TIMEOUT":
      return "timeout";
    default:
      return "failed";
  }
}

export type StepStatus =
  | { phase: "running" }
  | { phase: "done" }
  | { phase: "failed"; reason: StepFailure }
  | { phase: "refused"; reason: StepRefusal };

export interface Proposal {
  /** The tab that was active when the goal was sent. */
  tabId: string;
  answer: AssistAnswer;
}

export interface BrowserAssist {
  goal: string;
  setGoal(goal: string): void;
  problem: GoalProblem | null;
  /** The request to the route is in flight. */
  proposing: boolean;
  /** The route could not be reached or answered something that is not an answer. */
  requestFailed: boolean;
  proposal: Proposal | null;
  statuses: Readonly<Record<number, StepStatus>>;
  /** A step is waiting for approval or running. */
  stepBusy: boolean;
  canPropose: boolean;
  propose(): void;
  /** Runs ONE step, never the next one. */
  runStep(index: number): void;
}

/**
 * State of the assistant panel for the ACTIVE tab. `runStep` sends exactly one command; there is no
 * "run all" and nothing advances after a step ends.
 */
export function useBrowserAssist(tab: TabInfo | null): BrowserAssist {
  const client = useClient();
  const [goal, setGoalText] = useState("");
  const [proposing, setProposing] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [statuses, setStatuses] = useState<Readonly<Record<number, StepStatus>>>({});
  const seq = useRef(0);
  const active = useRef<{ index: number; kind: StepKind } | null>(null);
  const lock = useRef(false);

  const click = useCommandAction("browser", "click");
  const type = useCommandAction("browser", "type");
  const submit = useCommandAction("browser", "submit");
  const runs = { click, type, submit };
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const stepBusy = click.busy || type.busy || submit.busy;

  const setStatus = useCallback(
    (index: number, status: StepStatus) => setStatuses((s) => ({ ...s, [index]: status })),
    [],
  );

  // The end of the one step that is running: record it and stop. Nothing else starts.
  useEffect(() => {
    const current = active.current;
    if (!current) return;
    const run = runsRef.current[current.kind];
    if (run.state === "succeeded") {
      active.current = null;
      lock.current = false;
      setStatus(current.index, { phase: "done" });
      run.reset();
    } else if (run.state === "failed") {
      active.current = null;
      lock.current = false;
      setStatus(current.index, { phase: "failed", reason: stepFailure(run.code) });
      run.reset();
    }
  }, [click.state, type.state, submit.state, setStatus]);

  const problem = goalProblem(goal);
  const trimmed = goal.trim();
  const canPropose = tab !== null && trimmed !== "" && problem === null && !proposing && !stepBusy;

  const propose = useCallback(() => {
    if (!tab || trimmed === "" || goalProblem(goal) !== null || lock.current) return;
    const n = ++seq.current;
    const tabId = tab.tabId;
    setProposing(true);
    setRequestFailed(false);
    setProposal(null);
    setStatuses({});
    client
      .request<unknown>("POST", ASSIST_PATH, { goal: trimmed })
      .then((raw) => {
        if (n !== seq.current) return;
        const answer = parseAssistAnswer(raw);
        if (answer) setProposal({ tabId, answer });
        else setRequestFailed(true);
      })
      .catch(() => {
        if (n !== seq.current) return;
        setRequestFailed(true);
      })
      .finally(() => {
        if (n === seq.current) setProposing(false);
      });
  }, [client, tab, trimmed, goal]);

  const runStep = useCallback(
    (index: number) => {
      if (lock.current || !proposal || proposal.answer.status !== "ok") return;
      const step = proposal.answer.steps[index];
      if (!step || statuses[index]?.phase === "done") return;
      const refusal = stepRefusal({ tabId: proposal.tabId, pageUrl: proposal.answer.pageUrl }, tab);
      if (refusal) {
        setStatus(index, { phase: "refused", reason: refusal });
        return;
      }
      lock.current = true;
      active.current = { index, kind: step.kind };
      setStatus(index, { phase: "running" });
      const input =
        step.kind === "type"
          ? { pageUrl: proposal.answer.pageUrl, selector: step.selector, text: step.text }
          : { pageUrl: proposal.answer.pageUrl, selector: step.selector };
      void runsRef.current[step.kind].submit(input);
    },
    [proposal, statuses, tab, setStatus],
  );

  return {
    goal,
    setGoal: setGoalText,
    problem,
    proposing,
    requestFailed,
    proposal,
    statuses,
    stepBusy,
    canPropose,
    propose,
    runStep,
  };
}
