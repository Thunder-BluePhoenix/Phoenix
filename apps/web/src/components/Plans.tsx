// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useState, type FormEvent } from "react";
import { formatDate, safeHttpUrl, safeHttpsUrl } from "../core/format";
import {
  useAction,
  useMeetingLinks,
  useMeetingPlans,
  usePlan,
  usePlanPreview,
  usePlanningStatus,
} from "../core/hooks";
import {
  authorshipText,
  BASIS_TEXT,
  CANCELLABLE,
  destinationProblem,
  destinationText,
  draftOf,
  hasPlanProblems,
  MAX_LABELS,
  MAX_SUMMARY,
  MAX_TASK_BODY,
  MAX_TASKS,
  MAX_TITLE,
  planEditBody,
  type PlanEditBody,
  RUN_TEXT,
  STATUS_TEXT,
  TOOL_TEXT,
  validatePlanDraft,
  waitingTask,
  type PlanDraft,
  type PlanProblems,
} from "../core/plans";
import type {
  MeetingItem,
  Plan,
  PlanCreationReport,
  PlanDestination,
  PlanDetail,
  PlanGeneration,
  PlanLink,
  PlanPreview,
  PlanStatement,
  PlanTaskRun,
} from "../core/types";
import { Approvals } from "./Approvals";
import { Feedback } from "./Feedback";

export const planHref = (id: string) => `#/plans/${encodeURIComponent(id)}`;

/** External addresses are shown as text unless HTTPS, or Frappe's configured loopback HTTP. */
function ExternalUrl({ url, system }: { url: string; system?: Plan["target"] }) {
  const parsed = system === "frappe" ? safeHttpUrl(url) : safeHttpsUrl(url);
  const href =
    parsed &&
    (parsed.startsWith("https:") ||
      (system === "frappe" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(new URL(parsed).hostname)))
      ? parsed
      : null;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="memory-text break">
      {url}
    </a>
  ) : (
    <code className="break">{url}</code>
  );
}

/** Why planning is off, one sentence per missing condition. */
function PlanningOff({ reasons }: { reasons: string[] }) {
  return (
    <div className="review-notice small" role="note">
      <strong>Planning is off.</strong>
      <ul>
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

const PLANNABLE: Record<string, true> = { decision: true, action_item: true, requirement: true };

/** "Make a plan" on an accepted item: choose where the tasks would go; nothing is created. */
export function MakePlan({ item }: { item: MeetingItem }) {
  const { data: status } = usePlanningStatus();
  const { run, busy, error, details } = useAction();
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState<"github" | "frappe">("github");
  const [repository, setRepository] = useState("");
  const [site, setSite] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<PlanGeneration | null>(null);
  const id = useId();
  if (item.status !== "accepted" || !PLANNABLE[item.kind]) return null;

  const off = status !== null && !status.enabled;
  const destination: PlanDestination =
    system === "github"
      ? { system: "github", repository: repository.trim() }
      : { system: "frappe", site: site.trim() };
  const sites = status?.destinations.frappe.sites ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = destinationProblem(destination);
    setProblem(found);
    if (found) return;
    const res = await run<PlanGeneration>("POST", `/api/meeting-items/${item.id}/plan`, {
      destination,
    });
    if (res) setMade(res);
  };
  const refusal = details[0] === "PLANNING_OFF" ? details.slice(1) : [];

  return (
    <div className="make-plan">
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Make a plan from ${item.kind.replace("_", " ")}: ${item.text}`}
        onClick={() => setOpen(!open)}
      >
        Make a plan…
      </button>
      <div id={id} hidden={!open}>
        {open && (
          <form className="review-edit" onSubmit={(e) => void submit(e)} noValidate>
            {off && <PlanningOff reasons={status.reasons} />}
            <p className="muted small">
              A plan is a draft of engineering tasks. Nothing is created until you approve it and
              confirm each task.
            </p>
            <div className="field">
              <label htmlFor={`${id}-system`}>Where would the tasks go?</label>
              <select
                id={`${id}-system`}
                value={system}
                onChange={(e) => setSystem(e.target.value === "frappe" ? "frappe" : "github")}
              >
                <option value="github">GitHub issues</option>
                <option value="frappe">Frappe tasks</option>
              </select>
            </div>
            {system === "github" ? (
              <div className="field">
                <label htmlFor={`${id}-repo`}>Repository (owner/name)</label>
                <input
                  id={`${id}-repo`}
                  type="text"
                  value={repository}
                  spellCheck={false}
                  aria-invalid={problem ? true : undefined}
                  onChange={(e) => setRepository(e.target.value)}
                />
              </div>
            ) : (
              <div className="field">
                <label htmlFor={`${id}-site`}>Frappe site</label>
                {sites.length > 0 ? (
                  <select
                    id={`${id}-site`}
                    value={site}
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) => setSite(e.target.value)}
                  >
                    <option value="">Choose a site</option>
                    {sites.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`${id}-site`}
                    type="text"
                    value={site}
                    spellCheck={false}
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) => setSite(e.target.value)}
                  />
                )}
              </div>
            )}
            {problem && (
              <p className="error-text small" role="alert">
                {problem}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || off}>
              {busy ? "Drafting the plan…" : "Draft a plan"}
            </button>
            {busy && (
              <p className="muted small" role="status">
                A local model can take a minute. Nothing is sent anywhere else.
              </p>
            )}
            {refusal.length > 0 && <PlanningOff reasons={refusal} />}
            {refusal.length === 0 && <Feedback error={error} />}
            {made && (
              <p className="small" role="status">
                Plan drafted. {made.generation.unavailable ? `${made.generation.unavailable} ` : ""}
                <a href={planHref(made.plan.id)}>Open the plan</a>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

/** Tasks that exist because of this meeting, and the plans made from it. */
export function MeetingPlans({ meetingId }: { meetingId: string }) {
  const { data: plans } = useMeetingPlans(meetingId);
  const { data: links } = useMeetingLinks(meetingId);
  if (plans.length === 0 && links.length === 0) return null;
  return (
    <section aria-labelledby="meeting-plans-h" className="card">
      <h2 id="meeting-plans-h" className="h3">
        Plans and tasks from this meeting
      </h2>
      {plans.length > 0 && (
        <ul className="task-list" aria-label="Plans">
          {plans.map((p) => (
            <li key={p.id}>
              <a href={planHref(p.id)}>{p.title}</a>
              <span className="muted small">
                {" "}
                · {STATUS_TEXT[p.status]} · {p.task_count} task(s) ·{" "}
                {p.target === "github" ? "GitHub" : "Frappe"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <>
          <h3 className="h4">Tasks created</h3>
          <ul className="task-list" aria-label="Tasks created from this meeting">
            {links.map((l) => (
              <LinkRow key={l.id} link={l} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function LinkRow({ link }: { link: PlanLink }) {
  return (
    <li>
      <span className="mem-badge">{link.system === "github" ? "GitHub" : "Frappe"}</span>{" "}
      <span className="memory-text">
        {link.system === "frappe" ? "Task " : ""}
        {link.external_id}
      </span>{" "}
      · <ExternalUrl url={link.url} system={link.system} />
      <span className="muted small">
        {" "}
        · task {link.task_index + 1} of <a href={planHref(link.plan_id)}>its plan</a> · approved{" "}
        <time dateTime={link.approved_at}>{formatDate(link.approved_at)}</time>
      </span>
    </li>
  );
}

function Statements({ heading, items }: { heading: string; items: PlanStatement[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="h4">{heading}</h3>
      <ul className="task-list" aria-label={heading}>
        {items.map((s, i) => (
          <li key={i}>
            <span className="memory-text">{s.text}</span>{" "}
            <span className="muted small">({BASIS_TEXT[s.basis]})</span>
            {s.basis === "meeting" && s.quote && (
              <blockquote className="quote">{s.quote}</blockquote>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text ? (
    <p id={id} className="error-text small" role="alert">
      {text}
    </p>
  ) : null;
}

/** Editing a plan. Saving always returns the plan to draft and clears its approval. */
function PlanEditor({
  plan,
  busy,
  error,
  onSave,
  onCancel,
}: {
  plan: Plan;
  busy: boolean;
  error: string | null;
  onSave: (body: PlanEditBody) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const original = draftOf(plan);
  const [draft, setDraft] = useState<PlanDraft>(original);
  const [problems, setProblems] = useState<PlanProblems>({ task: {} });
  const setTask = (i: number, patch: Partial<PlanDraft["tasks"][number]>) =>
    setDraft({ ...draft, tasks: draft.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validatePlanDraft(draft);
    setProblems(found);
    if (hasPlanProblems(found)) return;
    const body = planEditBody(original, draft);
    if (Object.keys(body).length === 0) return onCancel();
    onSave(body);
  };

  return (
    <form className="review-edit" onSubmit={submit} noValidate aria-label="Edit the plan">
      <div className="field">
        <label htmlFor={`${id}-title`}>
          Title <span className="muted small">(up to {MAX_TITLE})</span>
        </label>
        <input
          id={`${id}-title`}
          type="text"
          value={draft.title}
          aria-invalid={problems.title ? true : undefined}
          aria-describedby={problems.title ? `${id}-title-err` : undefined}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <FieldError id={`${id}-title-err`} text={problems.title} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-summary`}>
          Summary <span className="muted small">(up to {MAX_SUMMARY})</span>
        </label>
        <textarea
          id={`${id}-summary`}
          rows={3}
          value={draft.summary}
          aria-invalid={problems.summary ? true : undefined}
          aria-describedby={problems.summary ? `${id}-summary-err` : undefined}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        />
        <FieldError id={`${id}-summary-err`} text={problems.summary} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-dest`}>
          {draft.destination.system === "github" ? "Repository (owner/name)" : "Frappe site"}
        </label>
        <input
          id={`${id}-dest`}
          type="text"
          spellCheck={false}
          value={
            draft.destination.system === "github"
              ? draft.destination.repository
              : draft.destination.site
          }
          aria-invalid={problems.destination ? true : undefined}
          aria-describedby={problems.destination ? `${id}-dest-err` : undefined}
          onChange={(e) =>
            setDraft({
              ...draft,
              destination:
                draft.destination.system === "github"
                  ? { system: "github", repository: e.target.value }
                  : { system: "frappe", site: e.target.value },
            })
          }
        />
        <FieldError id={`${id}-dest-err`} text={problems.destination} />
      </div>
      <fieldset className="plan-tasks">
        <legend>
          Tasks <span className="muted small">(1 to {MAX_TASKS})</span>
        </legend>
        <FieldError id={`${id}-tasks-err`} text={problems.tasks} />
        {draft.tasks.map((t, i) => {
          const p = problems.task[i];
          return (
            <div key={i} className="card" role="group" aria-label={`Task ${i + 1}`}>
              <div className="field">
                <label htmlFor={`${id}-t${i}-title`}>Task {i + 1} title</label>
                <input
                  id={`${id}-t${i}-title`}
                  type="text"
                  value={t.title}
                  aria-invalid={p?.title ? true : undefined}
                  aria-describedby={p?.title ? `${id}-t${i}-title-err` : undefined}
                  onChange={(e) => setTask(i, { title: e.target.value })}
                />
                <FieldError id={`${id}-t${i}-title-err`} text={p?.title} />
              </div>
              <div className="field">
                <label htmlFor={`${id}-t${i}-body`}>
                  Task {i + 1} body <span className="muted small">(up to {MAX_TASK_BODY})</span>
                </label>
                <textarea
                  id={`${id}-t${i}-body`}
                  rows={4}
                  value={t.body}
                  aria-invalid={p?.body ? true : undefined}
                  aria-describedby={p?.body ? `${id}-t${i}-body-err` : undefined}
                  onChange={(e) => setTask(i, { body: e.target.value })}
                />
                <FieldError id={`${id}-t${i}-body-err`} text={p?.body} />
              </div>
              <div className="field">
                <label htmlFor={`${id}-t${i}-labels`}>
                  Task {i + 1} labels{" "}
                  <span className="muted small">(comma separated, up to {MAX_LABELS})</span>
                </label>
                <input
                  id={`${id}-t${i}-labels`}
                  type="text"
                  value={t.labels}
                  aria-invalid={p?.labels ? true : undefined}
                  aria-describedby={p?.labels ? `${id}-t${i}-labels-err` : undefined}
                  onChange={(e) => setTask(i, { labels: e.target.value })}
                />
                <FieldError id={`${id}-t${i}-labels-err`} text={p?.labels} />
              </div>
              <button
                type="button"
                className="btn"
                disabled={draft.tasks.length <= 1}
                aria-label={`Remove task ${i + 1}`}
                onClick={() => setDraft({ ...draft, tasks: draft.tasks.filter((_, j) => j !== i) })}
              >
                Remove task {i + 1}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="btn"
          disabled={draft.tasks.length >= MAX_TASKS}
          onClick={() =>
            setDraft({ ...draft, tasks: [...draft.tasks, { title: "", body: "", labels: "" }] })
          }
        >
          Add a task
        </button>
      </fieldset>
      <p className="muted small">
        Saving returns the plan to draft and clears any approval. You then propose and approve it
        again.
      </p>
      <div className="button-row wrap">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save changes
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <Feedback error={error} />
    </form>
  );
}

/** Exactly what each task would send, as plain text, with the policy's verdict. */
function Preview({ preview }: { preview: PlanPreview }) {
  return (
    <section aria-labelledby="preview-h" className="card">
      <h2 id="preview-h" className="h3">
        Exactly what would be sent
      </h2>
      <p className="muted small">
        Each task is one call made as you. This is the real input, shown as plain text.
      </p>
      <ol className="preview-list" aria-label="Calls that would be made">
        {preview.tasks.map((t) => (
          <li key={t.task_index}>
            <p>
              <strong>
                Task {t.task_index + 1}: {TOOL_TEXT[t.tool] ?? t.tool}
              </strong>{" "}
              <span className="muted small">
                (effect: {t.decision.effect}, risk: {t.decision.risk})
              </span>
            </p>
            <pre
              className="agent-output"
              tabIndex={0}
              aria-label={`Input of task ${t.task_index + 1} (plain text, scrolls)`}
            >
              {JSON.stringify(t.input, null, 2)}
            </pre>
            {t.decision.reasons.length > 0 && (
              <p className="muted small memory-text">{t.decision.reasons.join(" ")}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Runs({
  runs,
  report,
  system,
}: {
  runs: PlanTaskRun[];
  report: PlanCreationReport | null;
  system: Plan["target"];
}) {
  if (runs.length === 0) return null;
  return (
    <section aria-labelledby="runs-h" className="card">
      <h2 id="runs-h" className="h3">
        Task by task
      </h2>
      <ul className="task-list" aria-label="Task results">
        {runs.map((r) => (
          <li key={r.task_index}>
            <strong>Task {r.task_index + 1}:</strong> {RUN_TEXT[r.status]}
            {r.attempts > 1 && <span className="muted small"> · {r.attempts} attempts</span>}
            {r.external_id && (
              <span className="memory-text">
                {" "}
                · {system === "frappe" ? "Frappe Task " : ""}
                {r.external_id}
              </span>
            )}
            {r.url && (
              <>
                {" "}
                · <ExternalUrl url={r.url} system={system} />
              </>
            )}
            {r.error && <p className="error-text small memory-text">{r.error}</p>}
          </li>
        ))}
      </ul>
      {report?.failure && (
        <p className="error-text" role="alert">
          Stopped at task {report.failure.task_index + 1}: {report.failure.message}. Nothing after
          it was created. You can run Create again: tasks that exist are found, not duplicated.
        </p>
      )}
    </section>
  );
}

/** One plan: read it, edit it, see exactly what it would send, approve it, create its tasks. */
export function PlanPage({ planId }: { planId: string }) {
  const { data, error, reload } = usePlan(planId);
  const { data: status } = usePlanningStatus();
  const change = useAction();
  const create = useAction();
  const [editing, setEditing] = useState(false);
  const [includeRef, setIncludeRef] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<PlanCreationReport | null>(null);
  const plan = data?.plan ?? null;
  const { data: preview } = usePlanPreview(planId, plan?.content_hash ?? null);

  // A plan that was edited or re-approved elsewhere must not keep an old tick.
  useEffect(() => setUnderstood(false), [plan?.content_hash, plan?.status]);

  if (error && !data) {
    return (
      <div className="meetings">
        <p role="alert">
          {error} <a href="#/meetings">All meetings</a>
        </p>
      </div>
    );
  }
  if (!plan || !data) return <p className="muted">Loading…</p>;

  const creating = plan.status === "creating" || create.busy;
  const locked = creating || change.busy;
  const editable = !creating && ["draft", "proposed", "approved", "failed"].includes(plan.status);
  const off = status !== null && !status.enabled;
  const total = plan.tasks.length;
  const path = `/api/plans/${encodeURIComponent(plan.id)}`;

  const act = async (verb: "propose" | "cancel", message: string) => {
    const res = await change.run<PlanDetail>("POST", `${path}/${verb}`, {});
    if (res) setNotice(message);
    await reload();
  };
  const approve = async () => {
    // The hash is the one of the content on screen. If the plan moved on, Core refuses.
    const res = await change.run<PlanDetail>("POST", `${path}/approve`, {
      hash: plan.content_hash,
      include_meeting_ref: includeRef,
    });
    setNotice(res ? "Approved. Nothing has been created yet." : "");
    await reload();
  };
  const save = async (body: PlanEditBody) => {
    const res = await change.run<PlanDetail>("POST", `${path}/edit`, body);
    if (res) {
      setEditing(false);
      setNotice("Saved. The plan is a draft again; propose it to approve it.");
    }
    await reload();
  };
  const createTasks = async () => {
    setReport(null);
    const res = await create.run<PlanCreationReport>("POST", `${path}/create`, { confirm: true });
    if (res) setReport(res);
    await reload();
  };

  return (
    <div className="meetings plan-page">
      <p>
        <a href={`#/meetings/${encodeURIComponent(plan.meeting_id)}`}>← The meeting</a>
      </p>
      <h1 className="memory-text">{plan.title}</h1>
      <p>
        <strong>{STATUS_TEXT[plan.status]}</strong>
      </p>
      <p className="small">
        <span className={`mem-badge ${plan.not_ai_generated ? "" : "mem-kind-interpretation"}`}>
          {plan.not_ai_generated ? "Rules-based draft" : "Model output"}
        </span>{" "}
        {authorshipText(plan)}
      </p>
      <p className="small">
        Destination: <strong>{destinationText(plan.destination)}</strong>
      </p>
      <p className="muted small memory-text">
        From {plan.source.kind.replace("_", " ")}: {plan.source.item_text}
        {plan.source.owner && ` · owner ${plan.source.owner}`}
        {plan.source.due && ` · due ${plan.source.due}`}
      </p>
      {off && <PlanningOff reasons={status.reasons} />}
      <p className="review-live small" role="status" aria-live="polite">
        {notice}
      </p>

      <section aria-labelledby="plan-h" className="card">
        <h2 id="plan-h" className="h3">
          The plan
        </h2>
        {editing ? (
          <PlanEditor
            plan={plan}
            busy={change.busy}
            error={change.error}
            onSave={(body) => void save(body)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="memory-text">{plan.summary.text}</p>
            <p className="muted small">({BASIS_TEXT[plan.summary.basis]})</p>
            {plan.summary.basis === "meeting" && plan.summary.quote && (
              <blockquote className="quote">{plan.summary.quote}</blockquote>
            )}
            <h3 className="h4">Tasks ({total})</h3>
            <ol className="plan-task-list" aria-label="Tasks">
              {plan.tasks.map((t, i) => (
                <li key={i} className="card">
                  <p className="memory-text">
                    <strong>{t.title}</strong>{" "}
                    <span className="muted small">({BASIS_TEXT[t.basis]})</span>
                  </p>
                  {t.body && <p className="memory-text">{t.body}</p>}
                  {t.labels.length > 0 && (
                    <p className="small">
                      Labels:{" "}
                      {t.labels.map((l) => (
                        <span key={l} className="chip">
                          {l}
                        </span>
                      ))}
                    </p>
                  )}
                  {t.basis === "meeting" && t.quote && (
                    <blockquote className="quote">{t.quote}</blockquote>
                  )}
                </li>
              ))}
            </ol>
            {plan.destination.system === "frappe" && plan.frappe && (
              <section aria-labelledby="frappe-design-h">
                <h3 id="frappe-design-h" className="h4">
                  Proposed Frappe DocType:{" "}
                  <span className="memory-text">{plan.frappe.doctype}</span>
                </h3>
                <p className="muted small">
                  Suggested design only. Creating tasks does not create this DocType, its fields,
                  workflow or permissions.
                </p>
                <h4>Fields</h4>
                {plan.frappe.fields.length ? (
                  <ul className="task-list" aria-label="Proposed Frappe fields">
                    {plan.frappe.fields.map((field, i) => (
                      <li key={i} className="memory-text">
                        {field.label} · {field.fieldtype}
                        {field.required ? " · required" : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No fields proposed.</p>
                )}
                <h4>Workflow states</h4>
                {plan.frappe.workflow_states.length ? (
                  <ol className="task-list" aria-label="Proposed Frappe workflow states">
                    {plan.frappe.workflow_states.map((state, i) => (
                      <li key={i} className="memory-text">
                        {i + 1}. {state}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted small">No workflow states proposed.</p>
                )}
                <h4>Permissions</h4>
                {plan.frappe.permissions.length ? (
                  <ul className="task-list" aria-label="Proposed Frappe permissions">
                    {plan.frappe.permissions.map((permission, i) => (
                      <li key={i} className="memory-text">
                        {permission.role}:{" "}
                        {[
                          permission.read && "read",
                          permission.write && "write",
                          permission.create && "create",
                        ]
                          .filter(Boolean)
                          .join(", ") || "no access"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No permissions proposed.</p>
                )}
              </section>
            )}
            <Statements heading="Acceptance criteria" items={plan.acceptance_criteria} />
            <Statements heading="Risks" items={plan.risks} />
            {plan.open_questions.length > 0 && (
              <>
                <h3 className="h4">Open questions</h3>
                <ul className="task-list" aria-label="Open questions">
                  {plan.open_questions.map((q, i) => (
                    <li key={i} className="memory-text">
                      {q}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {editable && (
              <button
                type="button"
                className="btn"
                disabled={locked}
                onClick={() => setEditing(true)}
              >
                Edit the plan
              </button>
            )}
          </>
        )}
      </section>

      {preview && !editing && <Preview preview={preview} />}

      <section aria-labelledby="decide-h" className="card">
        <h2 id="decide-h" className="h3">
          Decide
        </h2>
        <p className="muted small memory-text">
          Fingerprint of what you are looking at: <code>{plan.content_hash.slice(0, 16)}</code>.
          Approval covers exactly this content; if the plan changes it is refused.
        </p>
        {plan.status === "draft" && (
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={locked}
              onClick={() => void act("propose", "Proposed. Check the preview, then approve.")}
            >
              Propose this plan
            </button>
          </div>
        )}
        {plan.status === "proposed" && (
          <>
            <label className="choice">
              <input
                type="checkbox"
                checked={includeRef}
                disabled={locked}
                onChange={(e) => setIncludeRef(e.target.checked)}
              />
              Name the meeting in the created tasks
            </label>
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={locked}
                onClick={() => void approve()}
              >
                Approve this exact plan
              </button>
            </div>
          </>
        )}
        {plan.approved && (
          <p className="small">
            Approved by {plan.approved.by} on{" "}
            <time dateTime={plan.approved.at}>{formatDate(plan.approved.at)}</time>
            {plan.include_meeting_ref && " · the meeting is named in the tasks"}.
          </p>
        )}
        {(plan.status === "approved" || plan.status === "failed" || plan.status === "creating") && (
          <div>
            <label className="choice approval-understand">
              <input
                type="checkbox"
                checked={understood}
                disabled={creating}
                onChange={(e) => setUnderstood(e.target.checked)}
              />
              I understand this creates {total} {total === 1 ? "task" : "tasks"} in{" "}
              {destinationText(plan.destination)}, as me.
            </label>
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={creating || !understood || off || plan.status === "creating"}
                onClick={() => void createTasks()}
              >
                {plan.status === "failed" ? "Create the remaining tasks" : "Create tasks"}
              </button>
            </div>
          </div>
        )}
        {creating && (
          <div role="status">
            <p>
              <strong>
                Waiting for your approval of task {waitingTask(data.runs, total)} of {total}.
              </strong>
            </p>
            <p className="muted small">
              Core asks you before each task is created. Answer below; this page waits for as long
              as it takes.
            </p>
          </div>
        )}
        {creating && <Approvals />}
        {CANCELLABLE[plan.status] && !creating && (
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={locked}
              onClick={() => void act("cancel", "Cancelled. Nothing was created.")}
            >
              Cancel this plan
            </button>
          </div>
        )}
        <Feedback error={change.error} />
        <Feedback error={create.error} />
      </section>

      <Runs runs={data.runs} report={report} system={plan.target} />

      {data.links.length > 0 && (
        <section aria-labelledby="links-created-h" className="card">
          <h2 id="links-created-h" className="h3">
            Tasks created
          </h2>
          <ul className="task-list" aria-label="Tasks created">
            {data.links.map((l) => (
              <LinkRow key={l.id} link={l} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
