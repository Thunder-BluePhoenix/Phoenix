// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatAgo, formatDate } from "../core/format";
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
  ENVIRONMENT_TEXT,
  expiryOf,
  expiryProblem,
  NEEDS_ATTENTION,
  parsePayload,
  refusedStart,
  RUN_STATUS_TEXT,
  STEP_STATUS_TEXT,
  toolSteps,
} from "../core/workflows";
import { Approvals } from "./Approvals";
import { Feedback } from "./Feedback";

const workflowHref = (id: string) => `#/workflows/${encodeURIComponent(id)}`;
const runHref = (workflowId: string, runId: string) =>
  `#/workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}`;

/** The state of a workflow in words: enabled or not, environment, authorised or not. */
function WorkflowState({ w }: { w: Workflow }) {
  return (
    <span className="small">
      <strong>{w.enabled ? "Enabled" : "Disabled"}</strong> ·{" "}
      <span className={w.environment === "production" ? "wf-production" : ""}>
        {ENVIRONMENT_TEXT[w.environment]}
        {w.environment === "production" && " (changes live systems)"}
      </span>{" "}
      · {authorisationText(w)}
    </span>
  );
}

export function WorkflowsPage() {
  const { data: workflows, error, reload } = useWorkflows();
  const { data: metrics } = useWorkflowMetrics();
  return (
    <div className="meetings workflows">
      <h1>Workflows</h1>
      <p className="muted">
        A workflow reacts to an event with a fixed list of steps. A workflow that changes production
        does nothing until you authorise exactly the definition you reviewed.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {workflows && workflows.length === 0 && (
        <p className="muted">No workflows yet. Create one by reviewing a definition below.</p>
      )}
      <WorkflowEditor onSaved={reload} />
      <ul className="card-list" aria-label="Workflows">
        {workflows?.map((w) => (
          <li key={w.id} className="card meeting-row">
            <a href={workflowHref(w.id)}>
              <strong className="memory-text">{w.name}</strong>
            </a>
            <WorkflowState w={w} />
            <span className="muted small memory-text">
              Runs when <code>{w.trigger.event}</code> happens · version {w.version}
            </span>
            {w.problems.length > 0 && (
              <span className="error-text small memory-text">
                Cannot run: {w.problems.join(" ")}
              </span>
            )}
            {metrics?.[w.id] && (
              <span className="muted small">
                {metrics[w.id]?.runs_started} run(s), {metrics[w.id]?.runs_succeeded} succeeded
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
  if (!m)
    return <p className="muted small">This workflow has not run yet, so there are no numbers.</p>;
  const rows: [string, string | number][] = [
    ["Runs started", m.runs_started],
    ["Succeeded", m.runs_succeeded],
    ["Failed", m.runs_failed],
    ["Needing your attention", m.runs_needing_attention],
    ["Cancelled", m.runs_cancelled],
    ["Refused", m.runs_refused],
    ["Interrupted", m.runs_interrupted],
    ["Steps that failed", `${m.steps_failed} (${Math.round(m.step_failure_rate * 100)}% of steps)`],
    ["Approvals waiting", m.approvals_waiting],
    [
      "Approvals approved / rejected / expired",
      `${m.approvals_approved} / ${m.approvals_rejected} / ${m.approvals_expired}`,
    ],
    [
      "Run time (median / 90th percentile)",
      m.duration
        ? `${m.duration.p50} ms / ${m.duration.p90} ms over ${m.duration.samples} runs`
        : "no finished runs",
    ],
  ];
  return (
    <dl className="approval-facts small" aria-label="Metrics">
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
      setProblem("Enter a JSON workflow definition before checking it.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setProblem("A workflow definition must be a JSON object.");
      return;
    }
    if (!("enabled" in parsed) || parsed.enabled !== (initial?.workflow.enabled ?? false)) {
      setProblem(
        initial
          ? `Keep "enabled": ${initial.workflow.enabled}. Change the switch separately after saving.`
          : 'Set "enabled": false. Saving a new definition must not switch it on.',
      );
      return;
    }
    if (initial && (!("id" in parsed) || parsed.id !== initial.workflow.id)) {
      setProblem("Editing must keep the same workflow ID. Use Create workflow for a new ID.");
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
            ? `Not valid: ${result.problems.join("; ")}`
            : "Validation did not return a valid definition hash.",
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
        setProblem(
          "The saved definition hash differs from the reviewed hash. Review the stored definition before using it.",
        );
      } else {
        setNote(
          initial
            ? "Definition saved. Existing switch state is unchanged; saving does not authorise it."
            : "Definition saved switched off. Saving does not authorise or enable it.",
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
        {initial ? "Edit definition" : "Create workflow"}
      </h2>
      <p className="muted small">
        Enter the complete JSON definition.{" "}
        {initial
          ? `Keep "enabled": ${initial.workflow.enabled}; this edit preserves its current switch state. Saving does not authorise or run it.`
          : 'New definitions must have "enabled": false. Saving does not run, enable or authorise them.'}{" "}
        Checking never saves.
      </p>
      <form onSubmit={(e) => void check(e)}>
        <div className="field">
          <label htmlFor={`${id}-json`}>Workflow definition (JSON)</label>
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
          Check draft
        </button>
      </form>
      <Feedback error={validation.error || save.error} />
      {problem && (
        <p className="error-text memory-text" role="alert">
          {problem}
        </p>
      )}
      {review && review.text === draft && (
        <div className="review-edit" aria-label="Reviewed definition">
          <p>
            <strong>Valid draft.</strong> Review this exact definition and hash before saving. A
            change requires another check.
          </p>
          <pre className="agent-output wf-definition" tabIndex={0} aria-label="Definition to save">
            {definitionText(review.definition)}
          </pre>
          <p className="memory-text">
            Validated hash: <code className="break">{review.hash}</code>
          </p>
          <p>
            {review.authorisation?.required
              ? `Authorisation required separately: ${review.authorisation.reasons.join("; ")}`
              : "No authorisation required."}{" "}
            Saving never authorises;{" "}
            {initial
              ? `the switch remains ${initial.workflow.enabled ? "on" : "off"}.`
              : "the new workflow stays switched off."}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={save.busy || saving.current}
            onClick={() => void submit()}
          >
            Confirm: save exactly this definition
          </button>
        </div>
      )}
      {note && <p role="status">{note}</p>}
      {savedId && (
        <p>
          <a href={workflowHref(savedId)}>Review stored workflow</a>
        </p>
      )}
    </section>
  );
}

function Validate({ definition }: { definition: unknown }) {
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
        Check the definition
      </button>
      <p className="muted small">A dry run. Nothing is saved and nothing runs.</p>
      <Feedback error={error} />
      {result && (
        <div role="status">
          {result.valid ? (
            <p>
              <strong>Valid.</strong> Hash <code className="break">{result.hash}</code>.{" "}
              {result.authorisation?.required
                ? `Needs your authorisation: ${result.authorisation.reasons.join("; ")}.`
                : "No authorisation needed."}
            </p>
          ) : (
            <>
              <p className="error-text">
                <strong>Not valid.</strong> {result.problems.length} problem(s):
              </p>
              <ul aria-label="Problems">
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
    setNote(
      res ? `Authorised version ${w.version}. Any later change to the definition ends this.` : "",
    );
    await onDone();
  };

  return (
    <section aria-labelledby="authorise-h" className="card">
      <h2 id="authorise-h" className="h3">
        Authorise for production
      </h2>
      {w.authorisation_reasons.length === 0 ? (
        <p className="muted small">This workflow does not need authorisation.</p>
      ) : (
        <>
          <p className="small">
            <strong>Why it needs your authorisation:</strong>
          </p>
          <ul aria-label="Reasons" className="small">
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
          This will let the workflow <strong className="memory-text">{w.name}</strong> run whenever{" "}
          <code>{w.trigger.event}</code> happens, with no further question for these steps unless
          the workflow asks:
        </p>
        <ul aria-label="What would be allowed to run">
          {steps.length === 0 && <li className="muted small">It calls no tools.</li>}
          {steps.map((s) => (
            <li key={s.step} className="memory-text">
              Step <code>{s.step}</code> calls <code>{s.tool}</code>
              {s.undo && (
                <>
                  {" "}
                  (undo: <code>{s.undo}</code>)
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="small memory-text">
          Definition being authorised: version {w.version}, hash{" "}
          <code className="break">{w.hash}</code>
        </p>
        <div className="field">
          <label htmlFor={id}>
            Expires <span className="muted small">(optional, within 90 days)</span>
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
          Authorise exactly this definition
        </button>
        <Feedback error={error} saved={note} />
      </form>
    </section>
  );
}

function RunNow({ workflow, onStarted }: { workflow: Workflow; onStarted: () => Promise<void> }) {
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
        Run now
      </h2>
      <form className="review-edit" onSubmit={(e) => void submit(e)} noValidate>
        <p className="muted small">
          Starts the workflow by hand with the same checks as when its event happens: enabled, not
          stopped by the emergency stop, valid, and authorised if it changes production.
        </p>
        <div className="field">
          <label htmlFor={id}>
            Data the event would have carried{" "}
            <span className="muted small">(a JSON object, optional)</span>
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
          Run now
        </button>
        {blocked && (
          <p className="muted small memory-text">
            {workflow.enabled
              ? `It cannot run: ${workflow.problems.join(" ")}`
              : "Enable the workflow to run it."}
          </p>
        )}
        {refused ? (
          <p className="error-text" role="alert">
            <strong>The start was refused.</strong>{" "}
            <span className="memory-text">{refused.reason}</span>{" "}
            {refused.runId && <a href={runHref(workflow.id, refused.runId)}>See the refused run</a>}
          </p>
        ) : (
          <Feedback error={error} />
        )}
        {started && (
          <p className="small" role="status">
            Started. <a href={runHref(workflow.id, started.id)}>Follow the run</a>
          </p>
        )}
      </form>
    </section>
  );
}

function RunRow({ run }: { run: WorkflowRunSummary }) {
  return (
    <li className="card meeting-row">
      <a href={runHref(run.workflow_id, run.id)}>
        <strong>{RUN_STATUS_TEXT[run.status] ?? run.status}</strong>
        {NEEDS_ATTENTION[run.status] && <span> (needs a look)</span>}
      </a>
      <span className="muted small">
        {formatAgo(run.created_at)}
        {run.current_step && !run.terminal && ` · now at step ${run.current_step}`}
      </span>
      {run.reason && <span className="small memory-text">{run.reason}</span>}
    </li>
  );
}

export function WorkflowDetailPage({ workflowId }: { workflowId: string }) {
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
          {error} <a href="#/workflows">All workflows</a>
        </p>
      </div>
    );
  }
  if (!data) return <p className="muted">Loading…</p>;

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
        <a href="#/workflows">← All workflows</a>
      </p>
      <h1 className="memory-text">{w.name}</h1>
      <p>
        <WorkflowState w={w} />
      </p>
      {w.environment === "production" && (
        <p className="wf-production-banner" role="note">
          <strong>Production.</strong> This workflow can change live systems. It runs only while you
          have authorised its exact definition.
        </p>
      )}
      {w.problems.length > 0 && (
        <div className="error-text" role="alert">
          <strong>It cannot run right now:</strong>
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
          Definition
        </h2>
        <p className="small memory-text">
          Version {w.version} · hash <code className="break">{w.hash}</code>
        </p>
        <p className="small memory-text">
          Runs when <code>{w.trigger.event}</code> happens
          {w.trigger.where && (
            <>
              {" "}
              and <code>{w.trigger.where}</code>
            </>
          )}
          .
        </p>
        {definition ? (
          <>
            <h3 className="h4">Tools it can call</h3>
            <ul aria-label="Tools" className="task-list">
              {toolSteps(definition).length === 0 && <li className="muted small">None.</li>}
              {toolSteps(definition).map((s) => {
                const risky = flagged.some((r) => r.includes(s.tool));
                return (
                  <li key={s.step} className="memory-text">
                    Step <code>{s.step}</code>: <code>{s.tool}</code>
                    {risky && (
                      <>
                        {" "}
                        <strong className="wf-flag">Production or critical action</strong>
                      </>
                    )}
                    {s.undo && <span className="muted small"> · declared undo: {s.undo}</span>}
                  </li>
                );
              })}
            </ul>
            <pre
              className="agent-output wf-definition"
              tabIndex={0}
              aria-label="Definition (read-only text, scrolls)"
            >
              {definitionText(definition)}
            </pre>
          </>
        ) : (
          <p className="error-text">The stored definition could not be read.</p>
        )}
        <Validate definition={definition} />
      </section>
      {definition && <WorkflowEditor key={`${w.id}:${w.hash}`} initial={data} onSaved={reload} />}

      <section aria-labelledby="state-h" className="card">
        <h2 id="state-h" className="h3">
          Switch
        </h2>
        <button
          type="button"
          className="btn"
          disabled={toggle.busy}
          onClick={() => void setEnabled()}
        >
          {w.enabled ? "Disable" : "Enable"}
        </button>
        <p className="muted small">
          Enabling does not authorise. An enabled production workflow that is not authorised records
          every trigger as refused.
        </p>
        <Feedback error={toggle.error} />
      </section>

      <Authorise detail={data} onDone={both} />

      <section aria-labelledby="auths-h" className="card">
        <h2 id="auths-h" className="h3">
          Authorisations
        </h2>
        {data.authorisations.length === 0 ? (
          <p className="muted small">None yet.</p>
        ) : (
          <ul className="task-list" aria-label="Authorisations">
            {data.authorisations.map((a) => (
              <li key={a.id} className="memory-text">
                <strong>{a.live ? "In force" : a.revoked_at ? "Revoked" : "Not in force"}</strong> ·
                by {a.authorised_by} on{" "}
                <time dateTime={a.authorised_at}>{formatDate(a.authorised_at)}</time>
                {a.expires_at && (
                  <>
                    {" "}
                    · expires <time dateTime={a.expires_at}>{formatDate(a.expires_at)}</time>
                  </>
                )}
                {!a.live && !a.revoked_at && " · the definition changed or it expired"} · for hash{" "}
                <code>{a.definition_hash.slice(0, 12)}</code>
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
                Confirm: revoke authorisation
              </button>
              <button type="button" className="btn" onClick={() => setConfirmRevoke(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirmRevoke(true)}
            >
              Revoke authorisation…
            </button>
          ))}
        {live.length > 0 && <p className="muted small">Runs in flight stop at their next step.</p>}
        <Feedback error={revoke.error} />
      </section>

      <RunNow workflow={w} onStarted={both} />

      <section aria-labelledby="runs-recent-h" className="card">
        <h2 id="runs-recent-h" className="h3">
          Recent runs
        </h2>
        {runs.length === 0 ? (
          <p className="muted small">No runs yet.</p>
        ) : (
          <ul className="card-list" aria-label="Recent runs">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="metrics-h" className="card">
        <h2 id="metrics-h" className="h3">
          Numbers
        </h2>
        <Metrics m={metrics?.[w.id]} />
      </section>
    </div>
  );
}

function StepRow({ step }: { step: WorkflowRun["steps"][number] }) {
  return (
    <li className={`card wf-step${step.destructive ? " wf-step-destructive" : ""}`}>
      <p className="memory-text">
        <strong>
          {step.phase === "compensation" ? "Undo: " : ""}
          {step.step_id}
        </strong>{" "}
        ({step.type}) · {STEP_STATUS_TEXT[step.status] ?? step.status}
        {step.attempts > 1 && ` · ${step.attempts} attempts`}
      </p>
      {step.destructive && (
        <p className="wf-flag small">
          <strong>Changes state</strong>: this step can change a real system.
        </p>
      )}
      {step.tool && (
        <p className="small memory-text">
          Tool <code>{step.tool}</code>
        </p>
      )}
      {step.input && (
        <pre
          className="agent-output"
          tabIndex={0}
          aria-label={`Input of step ${step.step_id} (plain text, scrolls)`}
        >
          {step.input}
        </pre>
      )}
      {step.output && (
        <pre
          className="agent-output"
          tabIndex={0}
          aria-label={`Output of step ${step.step_id} (plain text, scrolls)`}
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
          {error} <a href={workflowHref(workflowId)}>Back to the workflow</a>
        </p>
      </div>
    );
  }
  if (!run) return <p className="muted">Loading…</p>;
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
      <h1 className="memory-text">Run of {run.workflow_name}</h1>
      <p role="status" aria-live="polite">
        <strong>{RUN_STATUS_TEXT[run.status] ?? run.status}</strong>
        {NEEDS_ATTENTION[run.status] && " (not a success)"}
        {run.current_step && !run.terminal && ` · at step ${run.current_step}`}
      </p>
      {run.reason && <p className="memory-text">{run.reason}</p>}
      <p className="muted small memory-text">
        Created <time dateTime={run.created_at}>{formatDate(run.created_at)}</time>
        {run.finished_at && (
          <>
            {" "}
            · finished <time dateTime={run.finished_at}>{formatDate(run.finished_at)}</time>
          </>
        )}{" "}
        · chain depth {run.chain_depth}
      </p>
      {/* Both workflow gates and tool policy confirmations belong to this run only when Core
          provides the run identifier; a generic policy request must stay in the main queue. */}
      {run.status === "waiting_approval" && (
        <section aria-labelledby="wait-h" className="card">
          <h2 id="wait-h" className="h3">
            Waiting for you
          </h2>
          {runApprovals}
        </section>
      )}
      {!run.terminal && run.status !== "waiting_approval" && runApprovals}
      {!run.terminal && (
        <section aria-labelledby="cancel-h" className="card">
          <h2 id="cancel-h" className="h3">
            Stop this run
          </h2>
          {confirm ? (
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-danger"
                disabled={cancel.busy}
                onClick={() => void doCancel()}
              >
                Confirm: cancel this run
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                Keep running
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setConfirm(true)}
            >
              Cancel this run…
            </button>
          )}
          <p className="muted small">
            A cancel does not run declared undo steps. A step already in progress may still finish.
          </p>
          <Feedback error={cancel.error} />
        </section>
      )}
      <section aria-labelledby="trigger-h" className="card">
        <h2 id="trigger-h" className="h3">
          What started it
        </h2>
        <pre className="agent-output" tabIndex={0} aria-label="Trigger (plain text, scrolls)">
          {run.trigger}
        </pre>
      </section>
      <section aria-labelledby="steps-h" className="card">
        <h2 id="steps-h" className="h3">
          Steps ({run.steps.length})
        </h2>
        {run.steps.length === 0 ? (
          <p className="muted small">No step has started.</p>
        ) : (
          <ol className="card-list" aria-label="Steps">
            {run.steps.map((s) => (
              <StepRow key={s.seq} step={s} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
