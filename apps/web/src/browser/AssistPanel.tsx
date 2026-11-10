// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef } from "react";
import { useT, type MessageKey } from "../i18n";
import {
  ASSIST_MAX_GOAL,
  type AssistStep,
  type BrowserAssist,
  type FailureStatus,
  type GoalProblem,
  type StepFailure,
  type StepRefusal,
  type StepStatus,
} from "./assist";
import { displayText } from "./unsafe-text";

const PROBLEM: Record<GoalProblem, MessageKey> = {
  too_long: "browser.assist.goalTooLong",
  control: "browser.assist.goalControl",
  hidden: "browser.assist.goalHidden",
};

const FAILURE: Record<FailureStatus, MessageKey> = {
  no_local_model: "browser.assist.noLocalModel",
  local_model_failed: "browser.assist.localModelFailed",
  no_browser: "browser.assist.noBrowser",
};

const KIND: Record<AssistStep["kind"], MessageKey> = {
  click: "browser.assist.kind.click",
  type: "browser.assist.kind.type",
  submit: "browser.assist.kind.submit",
};

const REFUSAL: Record<StepRefusal, MessageKey> = {
  no_tab: "browser.assist.refused.noTab",
  moved: "browser.assist.refused.moved",
};

const STEP_FAILURE: Record<StepFailure, MessageKey> = {
  denied: "browser.assist.failed.denied",
  blocked: "browser.assist.failed.blocked",
  unavailable: "browser.assist.failed.unavailable",
  timeout: "browser.assist.failed.timeout",
  failed: "browser.assist.failed.failed",
};

function statusKey(status: StepStatus | undefined): MessageKey | null {
  if (!status) return null;
  switch (status.phase) {
    case "running":
      return "browser.assist.step.running";
    case "done":
      return "browser.assist.step.done";
    case "failed":
      return STEP_FAILURE[status.reason];
    case "refused":
      return REFUSAL[status.reason];
  }
}

/**
 * "Ask Fawkes to help with this page", in the browser CHROME (never inside a page). The proposed steps
 * are INERT text written by a local model that read the page: nothing is a link, nothing runs on
 * its own, and each step has its own button that goes through the approval card.
 */
export function AssistPanel({
  assist,
  focusToken,
  onClose,
}: {
  assist: BrowserAssist;
  focusToken: number;
  onClose: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [focusToken]);

  const { proposal } = assist;
  const answer = proposal?.answer;
  return (
    <section className="browser-panel browser-assist" aria-labelledby={titleId}>
      <h2 id={titleId}>{t("browser.assist.title")}</h2>
      <form
        className="browser-assist-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (assist.canPropose) assist.propose();
        }}
      >
        <input
          ref={input}
          className="browser-address browser-assist-input"
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={t("browser.assist.goalLabel")}
          placeholder={t("browser.assist.goalPlaceholder")}
          aria-invalid={assist.problem !== null}
          value={assist.goal}
          onChange={(e) => assist.setGoal(e.target.value)}
        />
        <button type="submit" className="browser-button" disabled={!assist.canPropose}>
          {assist.proposing ? t("browser.assist.proposing") : t("browser.assist.propose")}
        </button>
        <button
          type="button"
          className="browser-button"
          aria-label={t("browser.assist.close")}
          onClick={onClose}
        >
          ×
        </button>
      </form>
      {assist.problem !== null && (
        <p className="browser-error" role="alert">
          {t(PROBLEM[assist.problem], { max: ASSIST_MAX_GOAL })}
        </p>
      )}
      {assist.requestFailed && (
        <p className="browser-error" role="alert">
          {t("browser.assist.requestFailed")}
        </p>
      )}
      {assist.busy && (
        <p className="browser-error" role="alert">
          {t("browser.assist.busy")}
        </p>
      )}
      {answer && answer.status !== "ok" && (
        <p className="browser-error" role="alert">
          {t(FAILURE[answer.status])}
        </p>
      )}
      {answer && answer.status === "ok" && (
        <div className="browser-assist-plan">
          <p className="browser-hint">{t("browser.assist.inert")}</p>
          <p className="browser-panel-url">
            {t("browser.assist.forPage", { url: displayText(answer.pageUrl, 300) })}
          </p>
          {answer.dropped > 0 && (
            <p className="browser-hint">{t("browser.assist.dropped", { count: answer.dropped })}</p>
          )}
          {answer.steps.length === 0 ? (
            <p className="browser-hint">{t("browser.assist.noSteps")}</p>
          ) : (
            <ol className="browser-assist-steps">
              {answer.steps.map((step, index) => {
                const key = statusKey(assist.statuses[index]);
                const done = assist.statuses[index]?.phase === "done";
                return (
                  <li key={index} className="browser-assist-step">
                    <span className="browser-assist-what">
                      {t(KIND[step.kind])} <code>{displayText(step.selector, 120)}</code>
                      {step.kind === "type" && (
                        <>
                          {" "}
                          {t("browser.assist.typeText", {
                            text: displayText(step.text ?? "", 300),
                          })}
                          {step.modelWritten && (
                            <>
                              {" "}
                              <strong className="browser-assist-written">
                                ({t("browser.assist.modelWritten")})
                              </strong>
                            </>
                          )}
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      className="browser-button"
                      disabled={assist.stepBusy || assist.proposing || done}
                      onClick={() => assist.runStep(index)}
                    >
                      {t("browser.assist.run")}
                    </button>
                    {key && (
                      <span
                        className={
                          assist.statuses[index]?.phase === "failed" ||
                          assist.statuses[index]?.phase === "refused"
                            ? "browser-error"
                            : "browser-hint"
                        }
                        role="status"
                      >
                        {t(key)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
