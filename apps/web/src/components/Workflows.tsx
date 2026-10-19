// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatAgo, formatDate, formatNumber } from "../core/format";
import {
  useAction,
  useWorkflow,
  useWorkflowMetrics,
  useWorkflowRun,
  useWorkflowRuns,
  useWorkflows,
} from "../core/hooks";
import type {
  Workflow,
  WorkflowDetail,
  WorkflowMetrics,
  WorkflowRun,
  WorkflowRunSummary,
  WorkflowValidation,
} from "../core/types";
import {
  authorisationText,
  definitionText,
  environmentText,
  expiryOf,
  expiryProblem,
  MAX_EXPIRY_DAYS,
  NEEDS_ATTENTION,
  parsePayload,
  refusedStart,
  runStatusText,
  stepStatusText,
  toolSteps,
} from "../core/workflows";
import { Approvals } from "./Approvals";
import { Feedback } from "./Feedback";
import { useT } from "../i18n";

const workflowHref = (id: string) => `#/workflows/${encodeURIComponent(id)}`;
const runHref = (workflowId: string, runId: string) =>
  `#/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}`;

/** The state of a workflow in words: enabled or not, environment, authorised or not. */
function WorkflowState({ w }: { w: Workflow }) {
  const t = useT();
  return (
    <span className="small">
      <strong>{w.enabled ? t("common.status.enabled") : t("common.status.disabled")}</strong> ·{" "}
      <span className={w.environment === "production" ? "wf-production" : ""}>
        {w.environment === "production"
          ? t("automation.workflows.environment.productionLive")
          : environmentText(w.environment)}
      </span>{" "}
      · {authorisationText(w)}
    </span>
  );
}

export function WorkflowsPage() {
  const t = useT();
  const { data: workflows, error, reload } = useWorkflows();
  const { data: metrics } = useWorkflowMetrics();
  return (
    <div className="meetings workflows">
      <h1>{t("automation.workflows.title")}</h1>
      <p className="muted">{t("automation.workflows.intro")}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {workflows && workflows.length === 0 && (
        <p className="muted">{t("automation.workflows.empty")}</p>
      )}
      <WorkflowEditor onSaved={reload} />
      <ul className="card-list" aria-label={t("automation.workflows.title")}>
        {workflows?.map((w) => (
          <li key={w.id} className="card meeting-row">
            <a href={workflowHref(w.id)}>
              <strong className="memory-text">{w.name}</strong>
            </a>
            <WorkflowState w={w} />
            <span className="muted small memory-text">
              {t.rich("automation.workflows.row.runsWhen", {
                event: <code>{w.trigger.event}</code>,
                version: w.version,
              })}
            </span>
            {w.problems.length > 0 && (
              <span className="error-text small memory-text">
                {t("automation.workflows.row.cannotRun", { problems: w.problems.join(" ") })}
              </span>
            )}
            {metrics?.[w.id] && (
              <span className="muted small">
                {t("automation.workflows.row.metrics", {
                  started: metrics[w.id]?.runs_started ?? 0,
                  succeeded: formatNumber(metrics[w.id]?.runs_succeeded ?? 0),
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Plain-text metrics, only for numbers that exist. */
function Metrics({ m }: { m: WorkflowMetrics | undefined }) {
  const t = useT();
  if (!m) return <p className="muted small">{t("automation.workflows.metrics.none")}</p>;
  const rows: [string, string | number][] = [
    [t("automation.workflows.metrics.started"), formatNumber(m.runs_started)],
    [t("automation.workflows.metrics.succeeded"), formatNumber(m.runs_succeeded)],
    [t("automation.workflows.metrics.failed"), formatNumber(m.runs_failed)],
    [t("automation.workflows.metrics.attention"), formatNumber(m.runs_needing_attention)],
    [t("automation.workflows.metrics.cancelled"), formatNumber(m.runs_cancelled)],
    [t("automation.workflows.metrics.refused"), formatNumber(m.runs_refused)],
    [t("automation.workflows.metrics.interrupted"), formatNumber(m.runs_interrupted)],
    [
      t("automation.workflows.metrics.stepsFailed"),
      t("automation.workflows.metrics.stepsFailedValue", {
        count: formatNumber(m.steps_failed),
        percent: formatNumber(Math.round(m.step_failure_rate * 100)),
      }),
    ],
    [t("automation.workflows.metrics.approvalsWaiting"), formatNumber(m.approvals_waiting)],
    [
      t("automation.workflows.metrics.approvalsOutcome"),
      t("automation.workflows.metrics.approvalsOutcomeValue", {
        approved: formatNumber(m.approvals_approved),
        rejected: formatNumber(m.approvals_rejected),
        expired: formatNumber(m.approvals_expired),
      }),
    ],
    [
      t("automation.workflows.metrics.runTime"),
      m.duration
        ? t("automation.workflows.metrics.runTimeValue", {
            median: formatNumber(m.duration.p50),
            p90: formatNumber(m.duration.p90),
            samples: m.duration.samples,
          })
        : t("automation.workflows.metrics.noFinishedRuns"),
    ],
  ];
  return (
    <dl className="approval-facts small" aria-label={t("automation.workflows.metrics.label")}>
      {rows.map(([k, v]) => (
        <div key={k} className="metric-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A validation belongs to one immutable draft. Editing it, even during a request, ends review. */
function WorkflowEditor({
  initial,
  onSaved,
}: {
  initial?: WorkflowDetail;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState(() =>
    initial?.definition
      ? definitionText({ ...initial.definition, enabled: initial.workflow.enabled })
      : "",
  );
  const draftRef = useRef(draft);
  const revision = useRef(0);
  const saving = useRef(false);
  const checking = useRef(false);
  const [review, setReview] = useState<{
    text: string;
    definition: unknown;
    hash: string;
    authorisation: WorkflowValidation["authorisation"];
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const validation = useAction();
  const save = useAction();

  const change = (value: string) => {
    draftRef.current = value;
    revision.current++;
    setDraft(value);
    setReview(null);
    setProblem(null);
    setNote(null);
    setSavedId(null);
  };
  const check = async (e: FormEvent) => {
    e.preventDefault();
    if (saving.current || checking.current) return;
    const text = draftRef.current;
    const at = revision.current;
    setReview(null);
    setNote(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setProblem(t("automation.workflows.editor.enterJson"));
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setProblem(t("automation.workflows.editor.notObject"));
      return;
    }
    if (!("enabled" in parsed) || parsed.enabled !== (initial?.workflow.enabled ?? false)) {
      setProblem(
        initial
          ? t("automation.workflows.editor.keepEnabled", {
              enabled: String(initial.workflow.enabled),
            })
          : t("automation.workflows.editor.setDisabled"),
      );
      return;
    }
    if (initial && (!("id" in parsed) || parsed.id !== initial.workflow.id)) {
      setProblem(t("automation.workflows.editor.keepId"));
      return;
    }
    setProblem(null);
    checking.current = true;
    try {
      const result = await validation.run<WorkflowValidation>("POST", "/api/workflows/validate", {
        definition: parsed,
      });
      if (at !== revision.current || text !== draftRef.current) return;
      if (!result) return;
      if (!result.valid || !result.hash) {
        setProblem(
          result.problems.length
            ? t("automation.workflows.editor.notValid", { problems: result.problems.join("; ") })
            : t("automation.workflows.editor.noHash"),
        );
        return;
      }
      setReview({
        text,
        definition: parsed,
        hash: result.hash,
        authorisation: result.authorisation,
      });
    } finally {
      checking.current = false;
    }
  };
  const submit = async () => {
    if (saving.current || !review || review.text !== draftRef.current) return;
    saving.current = true;
    setProblem(null);
    setNote(null);
    try {
      const result = await save.run<{ workflow: Workflow }>("POST", "/api/workflows", {
        definition: review.definition,
        ...(initial ? { expected_hash: initial.workflow.hash } : { create_only: true }),
      });
      if (!result) {
        setReview(null);
        return;
      }
      setReview(null);
      if (result.workflow.hash !== review.hash) {
        setProblem(t("automation.workflows.editor.hashDiffers"));
      } else {
        setNote(
          initial
            ? t("automation.workflows.editor.savedExisting")
            : t("automation.workflows.editor.savedNew"),
        );
      }
      setSavedId(result.workflow.id);
      await onSaved();
    } finally {
      saving.current = false;
    }
  };

  return (
    <section className="card wf-editor" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="h3">
        {initial
          ? t("automation.workflows.editor.titleEdit")
          : t("automation.workflows.editor.titleCreate")}
      </h2>
      <p className="muted small">
        {initial
          ? t("automation.workflows.editor.introExisting", {
              enabled: String(initial.workflow.enabled),
            })
          : t("automation.workflows.editor.introNew")}
      </p>
      <form onSubmit={(e) => void check(e)}>
        <div className="field">
          <label htmlFor={`${id}-json`}>{t("automation.workflows.editor.label")}</label>
          <textarea
            id={`${id}-json`}
            className="wf-editor-input"
            value={draft}
            onChange={(e) => change(e.target.value)}
            spellCheck={false}
            rows={12}
            disabled={save.busy || saving.current}
          />
        </div>
        <button
          type="submit"
          className="btn"
          disabled={validation.busy || save.busy || checking.current || saving.current}
        >
          {t("automation.workflows.editor.check")}
        </button>
      </form>
      <Feedback error={validation.error || save.error} />
      {problem && (
        <p className="error-text memory-text" role="alert">
          {problem}
        </p>
      )}
      {review && review.text === draft && (
        <div className="review-edit" aria-label={t("automation.workflows.editor.reviewed")}>
          <p>
            {t.rich("automation.workflows.editor.valid", {
              lead: <strong>{t("automation.workflows.editor.validLead")}</strong>,
            })}
          </p>
          <pre
            className="agent-output wf-definition"
            tabIndex={0}
            aria-label={t("automation.workflows.editor.toSave")}
          >
            {definitionText(review.definition)}
          </pre>
          <p className="memory-text">
            {t.rich("automation.workflows.editor.hash", {
              hash: <code className="break">{review.hash}</code>,
            })}
          </p>
          <p>
            {review.authorisation?.required
              ? t("automation.workflows.editor.authRequired", {
                  reasons: review.authorisation.reasons.join("; "),
                })
              : t("automation.workflows.editor.authNotRequired")}{" "}
            {initial
              ? initial.workflow.enabled
                ? t("automation.workflows.editor.switchOn")
                : t("automation.workflows.editor.switchOff")
              : t("automation.workflows.editor.switchNew")}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={save.busy || saving.current}
            onClick={() => void submit()}
          >
            {t("automation.workflows.editor.confirm")}
          </button>
        </div>
      )}
      {note && <p role="status">{note}</p>}
      {savedId && (
        <p>
          <a href={workflowHref(savedId)}>{t("automation.workflows.editor.reviewStored")}</a>
        </p>
      )}
    </section>
  );
}

function Validate({ definition }: { definition: unknown }) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [result, setResult] = useState<WorkflowValidation | null>(null);
  const check = async () => {
    setResult(null);
    const res = await run<WorkflowValidation>("POST", "/api/workflows/validate", { definition });
    if (res) setResult(res);
  };
  return (
    <div>
      <button
        type="button"
        className="btn"
        disabled={busy || definition === null}
        onClick={() => void check()}
      >
        {t("automation.workflows.validate.button")}
      </button>
      <p className="muted small">{t("automation.workflows.validate.dryRun")}</p>
      <Feedback error={error} />
      {result && (
        <div role="status">
          {result.valid ? (
            <p>
              {t.rich("automation.workflows.validate.valid", {
                lead: <strong>{t("automation.workflows.validate.validLead")}</strong>,
                hash: <code className="break">{result.hash}</code>,
                authorisation: result.authorisation?.required
                  ? t("automation.workflows.validate.needsAuth", {
                      reasons: result.authorisation.reasons.join("; "),
                    })
                  : t("automation.workflows.validate.noAuth"),
              })}
            </p>
          ) : (
            <>
              <p className="error-text">
                {t.rich("automation.workflows.validate.invalid", {
                  lead: <strong>{t("automation.workflows.validate.invalidLead")}</strong>,
                  count: result.problems.length,
                })}
              </p>
              <ul aria-label={t("automation.workflows.validate.problems")}>
                {result.problems.map((p) => (
                  <li key={p} className="memory-text">
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Authorising lets a production workflow run. It shows what it lets run and sends the hash it showed. */
function Authorise({ detail, onDone }: { detail: WorkflowDetail; onDone: () => Promise<void> }) {
  const t = useT();
  const { workflow: w, definition } = detail;
  const { run, busy, error } = useAction();
  const [expires, setExpires] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const id = useId();
  const steps = toolSteps(definition);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = expiryProblem(expires);
    setProblem(found);
    if (found) return;
    const at = expiryOf(expires);
    const res = await run("POST", `/api/workflows/${encodeURIComponent(w.id)}/authorise`, {
      hash: w.hash,
      ...(at ? { expires_at: at } : {}),
    });
    setNote(res ? t("automation.workflows.authorise.done", { version: w.version }) : "");
    await onDone();
  };

  return (
    <section aria-labelledby="authorise-h" className="card">
      <h2 id="authorise-h" className="h3">
        {t("automation.workflows.authorise.title")}
      </h2>
      {w.authorisation_reasons.length === 0 ? (
        <p className="muted small">{t("automation.workflows.authorise.notNeeded")}</p>
      ) : (
        <>
          <p className="small">
            <strong>{t("automation.workflows.authorise.why")}</strong>
          </p>
          <ul aria-label={t("automation.workflows.authorise.reasons")} className="small">
            {w.authorisation_reasons.map((r) => (
              <li key={r} className="memory-text">
                {r}
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="review-edit" onSubmit={(e) => void submit(e)} noValidate>
        <p className="small">
          {t.rich("automation.workflows.authorise.intro", {
            name: <strong className="memory-text">{w.name}</strong>,
            event: <code>{w.trigger.event}</code>,
          })}
        </p>
        <ul aria-label={t("automation.workflows.authorise.allowed")}>
          {steps.length === 0 && (
            <li className="muted small">{t("automation.workflows.authorise.noTools")}</li>
          )}
          {steps.map((s) => (
            <li key={s.step} className="memory-text">
              {s.undo
                ? t.rich("automation.workflows.authorise.stepUndo", {
                    step: <code>{s.step}</code>,
                    tool: <code>{s.tool}</code>,
                    undo: <code>{s.undo}</code>,
                  })
                : t.rich("automation.workflows.authorise.step", {
                    step: <code>{s.step}</code>,
                    tool: <code>{s.tool}</code>,
                  })}
            </li>
          ))}
        </ul>
        <p className="small memory-text">
          {t.rich("automation.workflows.authorise.being", {
            version: w.version,
            hash: <code className="break">{w.hash}</code>,
          })}
        </p>
        <div className="field">
          <label htmlFor={id}>
            {t.rich("automation.workflows.authorise.expires", {
              hint: (
                <span className="muted small">
                  {t("automation.workflows.authorise.expiresHint", { days: MAX_EXPIRY_DAYS })}
                </span>
              ),
            })}
          </label>
          <input
            id={id}
            type="datetime-local"
            value={expires}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-err` : undefined}
            onChange={(e) => setExpires(e.target.value)}
          />
          {problem && (
            <p id={`${id}-err`} className="error-text small" role="alert">
              {problem}
            </p>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || w.problems.length > 0}>
          {t("automation.workflows.authorise.submit")}
        </button>
        <Feedback error={error} saved={note} />
      </form>
    </section>
  );
}

function RunNow({ workflow, onStarted }: { workflow: Workflow; onStarted: () => Promise<void> }) {
  const t = useT();
  const { run, busy, error, details } = useAction();
  const [payload, setPayload] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [started, setStarted] = useState<WorkflowRunSummary | null>(null);
  const id = useId();
  const refused = refusedStart(details);
  const blocked = !workflow.enabled || workflow.problems.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parsePayload(payload);
    if ("error" in parsed) return setProblem(parsed.error);
    setProblem(null);
    setStarted(null);
    const res = await run<{ run: WorkflowRunSummary }>(
      "POST",
      `/api/workflows/${encodeURIComponent(workflow.id)}/runs`,
      { payload: parsed.payload },
    );
    if (res) setStarted(res.run);
    await onStarted();
  };

  return (
    <section aria-labelledby="runnow-h" className="card">
      <h2 id="runnow-h" className="h3">
        {t("automation.workflows.runNow.title")}
      </h2>
      <form className="review-edit" onSubmit={(e) => void submit(e)} noValidate>
        <p className="muted small">{t("automation.workflows.runNow.intro")}</p>
        <div className="field">
          <label htmlFor={id}>
            {t.rich("automation.workflows.runNow.payload", {
              hint: (
                <span className="muted small">{t("automation.workflows.runNow.payloadHint")}</span>
              ),
            })}
          </label>
          <textarea
            id={id}
            rows={3}
            spellCheck={false}
            value={payload}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-err` : undefined}
            onChange={(e) => setPayload(e.target.value)}
          />
          {problem && (
            <p id={`${id}-err`} className="error-text small" role="alert">
              {problem}
            </p>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || blocked}>
          {t("automation.workflows.runNow.button")}
        </button>
        {blocked && (
          <p className="muted small memory-text">
            {workflow.enabled
              ? t("automation.workflows.runNow.cannotRun", {
                  problems: workflow.problems.join(" "),
                })
              : t("automation.workflows.runNow.enableFirst")}
          </p>
        )}
        {refused ? (
          <p className="error-text" role="alert">
            <strong>{t("automation.workflows.runNow.refusedLead")}</strong>{" "}
            <span className="memory-text">{refused.reason}</span>{" "}
            {refused.runId && (
              <a href={runHref(workflow.id, refused.runId)}>
                {t("automation.workflows.runNow.seeRefused")}
              </a>
            )}
          </p>
        ) : (
          <Feedback error={error} />
        )}
        {started && (
          <p className="small" role="status">
            {t.rich("automation.workflows.runNow.started", {
              link: (
                <a href={runHref(workflow.id, started.id)}>
                  {t("automation.workflows.runNow.follow")}
                </a>
              ),
            })}
          </p>
        )}
      </form>
    </section>
  );
}

function RunRow({ run }: { run: WorkflowRunSummary }) {
  const t = useT();
  return (
    <li className="card meeting-row">
      <a href={runHref(run.workflow_id, run.id)}>
        <strong>{runStatusText(run.status)}</strong>
        {NEEDS_ATTENTION[run.status] && <span> {t("automation.workflows.run.needsLook")}</span>}
      </a>
      <span className="muted small">
        {formatAgo(run.created_at)}
        {run.current_step &&
          !run.terminal &&
          ` · ${t("automation.workflows.run.nowAtStep", { step: run.current_step })}`}
      </span>
      {run.reason && <span className="small memory-text">{run.reason}</span>}
    </li>
  );
}

export function WorkflowDetailPage({ workflowId }: { workflowId: string }) {
  const t = useT();
  const { data, error, reload } = useWorkflow(workflowId);
  const { data: runs, reload: reloadRuns } = useWorkflowRuns(workflowId);
  const { data: metrics } = useWorkflowMetrics();
  const toggle = useAction();
  const revoke = useAction();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  if (error && !data) {
    return (
      <div className="meetings">
        <p role="alert">
          {error} <a href="#/workflows">{t("automation.workflows.detail.all")}</a>
        </p>
      </div>
    );
  }
  if (!data) return <p className="muted">{t("common.status.loading")}</p>;

  const { workflow: w, definition } = data;
  const path = `/api/workflows/${encodeURIComponent(w.id)}`;
  const both = async () => {
    await reload();
    await reloadRuns();
  };
  const setEnabled = async () => {
    await toggle.run("POST", `${path}/enabled`, { enabled: !w.enabled });
    await both();
  };
  const doRevoke = async () => {
    await revoke.run("POST", `${path}/revoke`, {});
    setConfirmRevoke(false);
    await both();
  };
  const live = data.authorisations.filter((a) => a.live);
  const flagged = w.authorisation_reasons;

  return (
    <div className="meetings workflows">
      <p>
        <a href="#/workflows">{t("automation.workflows.detail.backAll")}</a>
      </p>
      <h1 className="memory-text">{w.name}</h1>
      <p>
        <WorkflowState w={w} />
      </p>
      {w.environment === "production" && (
        <p className="wf-production-banner" role="note">
          {t.rich("automation.workflows.detail.production", {
            lead: <strong>{t("automation.workflows.detail.productionLead")}</strong>,
          })}
        </p>
      )}
      {w.problems.length > 0 && (
        <div className="error-text" role="alert">
          <strong>{t("automation.workflows.detail.cannotRunNow")}</strong>
          <ul>
            {w.problems.map((p) => (
              <li key={p} className="memory-text">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="def-h" className="card">
        <h2 id="def-h" className="h3">
          {t("automation.workflows.detail.definition")}
        </h2>
        <p className="small memory-text">
          {t.rich("automation.workflows.detail.versionHash", {
            version: w.version,
            hash: <code className="break">{w.hash}</code>,
          })}
        </p>
        <p className="small memory-text">
          {w.trigger.where
            ? t.rich("automation.workflows.detail.runsWhenAnd", {
                event: <code>{w.trigger.event}</code>,
                condition: <code>{w.trigger.where}</code>,
              })
            : t.rich("automation.workflows.detail.runsWhen", {
                event: <code>{w.trigger.event}</code>,
              })}
        </p>
        {definition ? (
          <>
            <h3 className="h4">{t("automation.workflows.detail.tools")}</h3>
            <ul aria-label={t("automation.workflows.detail.toolsLabel")} className="task-list">
              {toolSteps(definition).length === 0 && (
                <li className="muted small">{t("automation.workflows.detail.none")}</li>
              )}
              {toolSteps(definition).map((s) => {
                const risky = flagged.some((r) => r.includes(s.tool));
                return (
                  <li key={s.step} className="memory-text">
                    {t.rich("automation.workflows.detail.toolStep", {
                      step: <code>{s.step}</code>,
                      tool: <code>{s.tool}</code>,
                    })}
                    {risky && (
                      <>
                        {" "}
                        <strong className="wf-flag">
                          {t("automation.workflows.detail.flagged")}
                        </strong>
                      </>
                    )}
                    {s.undo && (
                      <span className="muted small">
                        {" "}
                        · {t("automation.workflows.detail.declaredUndo", { undo: s.undo })}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <pre
              className="agent-output wf-definition"
              tabIndex={0}
              aria-label={t("automation.workflows.detail.definitionText")}
            >
              {definitionText(definition)}
            </pre>
          </>
        ) : (
          <p className="error-text">{t("automation.workflows.detail.unreadable")}</p>
        )}
        <Validate definition={definition} />
      </section>
      {definition && <WorkflowEditor key={`${w.id}:${w.hash}`} initial={data} onSaved={reload} />}

      <section aria-labelledby="state-h" className="card">
        <h2 id="state-h" className="h3">
          {t("automation.workflows.detail.switch")}
        </h2>
        <button
          type="button"
          className="btn"
          disabled={toggle.busy}
          onClick={() => void setEnabled()}
        >
          {w.enabled
            ? t("automation.workflows.detail.disable")
            : t("automation.workflows.detail.enable")}
        </button>
        <p className="muted small">{t("automation.workflows.detail.switchNote")}</p>
        <Feedback error={toggle.error} />
      </section>

      <Authorise detail={data} onDone={both} />

      <section aria-labelledby="auths-h" className="card">
        <h2 id="auths-h" className="h3">
          {t("automation.workflows.detail.authorisations")}
        </h2>
        {data.authorisations.length === 0 ? (
          <p className="muted small">{t("automation.workflows.detail.noneYet")}</p>
        ) : (
          <ul className="task-list" aria-label={t("automation.workflows.detail.authorisations")}>
            {data.authorisations.map((a) => (
              <li key={a.id} className="memory-text">
                <strong>
                  {a.live
                    ? t("automation.workflows.detail.inForce")
                    : a.revoked_at
                      ? t("automation.workflows.detail.revoked")
                      : t("automation.workflows.detail.notInForce")}
                </strong>{" "}
                ·{" "}
                {t.rich("automation.workflows.detail.authorisedBy", {
                  by: a.authorised_by,
                  date: <time dateTime={a.authorised_at}>{formatDate(a.authorised_at)}</time>,
                })}
                {a.expires_at && (
                  <>
                    {" "}
                    ·{" "}
                    {t.rich("automation.workflows.detail.authExpires", {
                      date: <time dateTime={a.expires_at}>{formatDate(a.expires_at)}</time>,
                    })}
                  </>
                )}
                {!a.live && !a.revoked_at && ` · ${t("automation.workflows.detail.authChanged")}`} ·{" "}
                {t.rich("automation.workflows.detail.forHash", {
                  hash: <code>{a.definition_hash.slice(0, 12)}</code>,
                })}
              </li>
            ))}
          </ul>
        )}
        {live.length > 0 &&
          (confirmRevoke ? (
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-danger"
                disabled={revoke.busy}
                onClick={() => void doRevoke()}
              >
                {t("automation.workflows.detail.confirmRevoke")}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmRevoke(false)}>
                {t("common.button.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirmRevoke(true)}
            >
              {t("automation.workflows.detail.revoke")}
            </button>
          ))}
        {live.length > 0 && (
          <p className="muted small">{t("automation.workflows.detail.revokeNote")}</p>
        )}
        <Feedback error={revoke.error} />
      </section>

      <RunNow workflow={w} onStarted={both} />

      <section aria-labelledby="runs-recent-h" className="card">
        <h2 id="runs-recent-h" className="h3">
          {t("automation.workflows.detail.recentRuns")}
        </h2>
        {runs.length === 0 ? (
          <p className="muted small">{t("automation.workflows.detail.noRuns")}</p>
        ) : (
          <ul className="card-list" aria-label={t("automation.workflows.detail.recentRuns")}>
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="metrics-h" className="card">
        <h2 id="metrics-h" className="h3">
          {t("automation.workflows.metrics.title")}
        </h2>
        <Metrics m={metrics?.[w.id]} />
      </section>
    </div>
  );
}

function StepRow({ step }: { step: WorkflowRun["steps"][number] }) {
  const t = useT();
  return (
    <li className={`card wf-step${step.destructive ? " wf-step-destructive" : ""}`}>
      <p className="memory-text">
        <strong>
          {step.phase === "compensation"
            ? t("automation.workflows.step.undo", { step: step.step_id })
            : step.step_id}
        </strong>{" "}
        ({step.type}) · {stepStatusText(step.status)}
        {step.attempts > 1 &&
          ` · ${t("automation.workflows.step.attempts", { count: step.attempts })}`}
      </p>
      {step.destructive && (
        <p className="wf-flag small">
          {t.rich("automation.workflows.step.destructive", {
            lead: <strong>{t("automation.workflows.step.changesState")}</strong>,
          })}
        </p>
      )}
      {step.tool && (
        <p className="small memory-text">
          {t.rich("automation.workflows.step.tool", { tool: <code>{step.tool}</code> })}
        </p>
      )}
      {step.input && (
        <pre
          className="agent-output"
          tabIndex={0}
          aria-label={t("automation.workflows.step.input", { step: step.step_id })}
        >
          {step.input}
        </pre>
      )}
      {step.output && (
        <pre
          className="agent-output"
          tabIndex={0}
          aria-label={t("automation.workflows.step.output", { step: step.step_id })}
        >
          {step.output}
        </pre>
      )}
      {step.error && <p className="error-text small memory-text">{step.error}</p>}
    </li>
  );
}

/** One run: status, why, every step, and cancel while it is not finished. */
export function WorkflowRunPage({ workflowId, runId }: { workflowId: string; runId: string }) {
  const t = useT();
  const { data: run, error, reload } = useWorkflowRun(runId);
  const cancel = useAction();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (run?.terminal) setConfirm(false);
  }, [run?.terminal]);

  if (error && !run) {
    return (
      <div className="meetings">
        <p role="alert">
          {error}{" "}
          <a href={workflowHref(workflowId)}>{t("automation.workflows.run.backToWorkflow")}</a>
        </p>
      </div>
    );
  }
  if (!run) return <p className="muted">{t("common.status.loading")}</p>;
  const runApprovals = (
    <Approvals
      filter={(c) =>
        c.details?.run === run.id &&
        c.details.workflow === run.workflow_id &&
        Boolean(c.details.step)
      }
    />
  );

  const doCancel = async () => {
    await cancel.run("POST", `/api/workflows/runs/${encodeURIComponent(run.id)}/cancel`, {});
    setConfirm(false);
    await reload();
  };

  return (
    <div className="meetings workflows">
      <p>
        <a href={workflowHref(run.workflow_id)}>← {run.workflow_name}</a>
      </p>
      <h1 className="memory-text">
        {t("automation.workflows.run.title", { name: run.workflow_name })}
      </h1>
      <p role="status" aria-live="polite">
        <strong>{runStatusText(run.status)}</strong>
        {NEEDS_ATTENTION[run.status] && ` ${t("automation.workflows.run.notSuccess")}`}
        {run.current_step &&
          !run.terminal &&
          ` · ${t("automation.workflows.run.atStep", { step: run.current_step })}`}
      </p>
      {run.reason && <p className="memory-text">{run.reason}</p>}
      <p className="muted small memory-text">
        {t.rich("automation.workflows.run.created", {
          date: <time dateTime={run.created_at}>{formatDate(run.created_at)}</time>,
        })}
        {run.finished_at && (
          <>
            {" "}
            ·{" "}
            {t.rich("automation.workflows.run.finished", {
              date: <time dateTime={run.finished_at}>{formatDate(run.finished_at)}</time>,
            })}
          </>
        )}{" "}
        · {t("automation.workflows.run.chainDepth", { depth: formatNumber(run.chain_depth) })}
      </p>
      {/* Both workflow gates and tool policy confirmations belong to this run only when Core
          provides the run identifier; a generic policy request must stay in the main queue. */}
      {run.status === "waiting_approval" && (
        <section aria-labelledby="wait-h" className="card">
          <h2 id="wait-h" className="h3">
            {t("automation.workflows.run.waitingForYou")}
          </h2>
          {runApprovals}
        </section>
      )}
      {!run.terminal && run.status !== "waiting_approval" && runApprovals}
      {!run.terminal && (
        <section aria-labelledby="cancel-h" className="card">
          <h2 id="cancel-h" className="h3">
            {t("automation.workflows.run.stop")}
          </h2>
          {confirm ? (
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-danger"
                disabled={cancel.busy}
                onClick={() => void doCancel()}
              >
                {t("automation.workflows.run.confirmCancel")}
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                {t("automation.workflows.run.keepRunning")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirm(true)}
            >
              {t("automation.workflows.run.cancel")}
            </button>
          )}
          <p className="muted small">{t("automation.workflows.run.cancelNote")}</p>
          <Feedback error={cancel.error} />
        </section>
      )}
      <section aria-labelledby="trigger-h" className="card">
        <h2 id="trigger-h" className="h3">
          {t("automation.workflows.run.trigger")}
        </h2>
        <pre
          className="agent-output"
          tabIndex={0}
          aria-label={t("automation.workflows.run.triggerText")}
        >
          {run.trigger}
        </pre>
      </section>
      <section aria-labelledby="steps-h" className="card">
        <h2 id="steps-h" className="h3">
          {t("automation.workflows.run.stepsHeading", { count: formatNumber(run.steps.length) })}
        </h2>
        {run.steps.length === 0 ? (
          <p className="muted small">{t("automation.workflows.run.noSteps")}</p>
        ) : (
          <ol className="card-list" aria-label={t("automation.workflows.run.stepsLabel")}>
            {run.steps.map((s) => (
              <StepRow key={s.seq} step={s} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
