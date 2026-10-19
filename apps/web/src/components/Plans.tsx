// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useState, type FormEvent } from "react";
import { formatDate, formatNumber, safeHttpUrl, safeHttpsUrl } from "../core/format";
import { useLocale, useT } from "../i18n";
import { intlLocale } from "../i18n/supported";
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
  basisText,
  CANCELLABLE,
  destinationProblem,
  destinationText,
  draftOf,
  hasPlanProblems,
  kindText,
  MAX_LABELS,
  MAX_SUMMARY,
  MAX_TASK_BODY,
  MAX_TASKS,
  MAX_TITLE,
  planEditBody,
  type PlanEditBody,
  runText,
  statusText,
  toolText,
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
  const t = useT();
  return (
    <div className="review-notice small" role="note">
      <strong>{t("automation.plans.off")}</strong>
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
  const t = useT();
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
        aria-label={t("automation.plans.make.openFrom", {
          kind: kindText(item.kind),
          text: item.text,
        })}
        onClick={() => setOpen(!open)}
      >
        {t("automation.plans.make.open")}
      </button>
      <div id={id} hidden={!open}>
        {open && (
          <form className="review-edit" onSubmit={(e) => void submit(e)} noValidate>
            {off && <PlanningOff reasons={status.reasons} />}
            <p className="muted small">{t("automation.plans.make.intro")}</p>
            <div className="field">
              <label htmlFor={`${id}-system`}>{t("automation.plans.make.where")}</label>
              <select
                id={`${id}-system`}
                value={system}
                onChange={(e) => setSystem(e.target.value === "frappe" ? "frappe" : "github")}
              >
                <option value="github">{t("automation.plans.make.githubIssues")}</option>
                <option value="frappe">{t("automation.plans.make.frappeTasks")}</option>
              </select>
            </div>
            {system === "github" ? (
              <div className="field">
                <label htmlFor={`${id}-repo`}>{t("automation.plans.make.repository")}</label>
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
                <label htmlFor={`${id}-site`}>{t("automation.plans.make.site")}</label>
                {sites.length > 0 ? (
                  <select
                    id={`${id}-site`}
                    value={site}
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) => setSite(e.target.value)}
                  >
                    <option value="">{t("automation.plans.make.chooseSite")}</option>
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
              {busy ? t("automation.plans.make.drafting") : t("automation.plans.make.draft")}
            </button>
            {busy && (
              <p className="muted small" role="status">
                {t("automation.plans.make.localModel")}
              </p>
            )}
            {refusal.length > 0 && <PlanningOff reasons={refusal} />}
            {refusal.length === 0 && <Feedback error={error} />}
            {made && (
              <p className="small" role="status">
                {t("automation.plans.make.drafted")}{" "}
                {made.generation.unavailable ? `${made.generation.unavailable} ` : ""}
                <a href={planHref(made.plan.id)}>{t("automation.plans.make.openPlan")}</a>
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
  const t = useT();
  const { data: plans } = useMeetingPlans(meetingId);
  const { data: links } = useMeetingLinks(meetingId);
  if (plans.length === 0 && links.length === 0) return null;
  return (
    <section aria-labelledby="meeting-plans-h" className="card">
      <h2 id="meeting-plans-h" className="h3">
        {t("automation.plans.meeting.title")}
      </h2>
      {plans.length > 0 && (
        <ul className="task-list" aria-label={t("automation.plans.meeting.plans")}>
          {plans.map((p) => (
            <li key={p.id}>
              <a href={planHref(p.id)}>{p.title}</a>
              <span className="muted small">
                {" "}
                ·{" "}
                {t("automation.plans.meeting.summary", {
                  status: statusText(p.status),
                  count: p.task_count,
                  system: p.target === "github" ? "GitHub" : "Frappe",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <>
          <h3 className="h4">{t("automation.plans.meeting.tasksCreated")}</h3>
          <ul className="task-list" aria-label={t("automation.plans.meeting.tasksLabel")}>
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
  const t = useT();
  return (
    <li>
      <span className="mem-badge">{link.system === "github" ? "GitHub" : "Frappe"}</span>{" "}
      <span className="memory-text">
        {link.system === "frappe"
          ? t("automation.plans.link.frappeTask", { id: link.external_id })
          : link.external_id}
      </span>{" "}
      · <ExternalUrl url={link.url} system={link.system} />
      <span className="muted small">
        {" "}
        ·{" "}
        {t.rich("automation.plans.link.detail", {
          index: link.task_index + 1,
          plan: <a href={planHref(link.plan_id)}>{t("automation.plans.link.itsPlan")}</a>,
          date: <time dateTime={link.approved_at}>{formatDate(link.approved_at)}</time>,
        })}
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
            <span className="muted small">({basisText(s.basis)})</span>
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
  const t = useT();
  const id = useId();
  const original = draftOf(plan);
  const [draft, setDraft] = useState<PlanDraft>(original);
  const [problems, setProblems] = useState<PlanProblems>({ task: {} });
  const setTask = (i: number, patch: Partial<PlanDraft["tasks"][number]>) =>
    setDraft({
      ...draft,
      tasks: draft.tasks.map((task, j) => (j === i ? { ...task, ...patch } : task)),
    });

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
    <form
      className="review-edit"
      onSubmit={submit}
      noValidate
      aria-label={t("automation.plans.editor.label")}
    >
      <div className="field">
        <label htmlFor={`${id}-title`}>
          {t.rich("automation.plans.editor.title", {
            hint: (
              <span className="muted small">
                {t("automation.plans.editor.upTo", { max: MAX_TITLE })}
              </span>
            ),
          })}
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
          {t.rich("automation.plans.editor.summary", {
            hint: (
              <span className="muted small">
                {t("automation.plans.editor.upTo", { max: MAX_SUMMARY })}
              </span>
            ),
          })}
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
          {draft.destination.system === "github"
            ? t("automation.plans.make.repository")
            : t("automation.plans.make.site")}
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
          {t.rich("automation.plans.editor.tasks", {
            hint: (
              <span className="muted small">
                {t("automation.plans.editor.tasksRange", { max: MAX_TASKS })}
              </span>
            ),
          })}
        </legend>
        <FieldError id={`${id}-tasks-err`} text={problems.tasks} />
        {draft.tasks.map((task, i) => {
          const p = problems.task[i];
          return (
            <div
              key={i}
              className="card"
              role="group"
              aria-label={t("automation.plans.editor.task", { n: i + 1 })}
            >
              <div className="field">
                <label htmlFor={`${id}-t${i}-title`}>
                  {t("automation.plans.editor.taskTitle", { n: i + 1 })}
                </label>
                <input
                  id={`${id}-t${i}-title`}
                  type="text"
                  value={task.title}
                  aria-invalid={p?.title ? true : undefined}
                  aria-describedby={p?.title ? `${id}-t${i}-title-err` : undefined}
                  onChange={(e) => setTask(i, { title: e.target.value })}
                />
                <FieldError id={`${id}-t${i}-title-err`} text={p?.title} />
              </div>
              <div className="field">
                <label htmlFor={`${id}-t${i}-body`}>
                  {t.rich("automation.plans.editor.taskBody", {
                    n: i + 1,
                    hint: (
                      <span className="muted small">
                        {t("automation.plans.editor.upTo", { max: MAX_TASK_BODY })}
                      </span>
                    ),
                  })}
                </label>
                <textarea
                  id={`${id}-t${i}-body`}
                  rows={4}
                  value={task.body}
                  aria-invalid={p?.body ? true : undefined}
                  aria-describedby={p?.body ? `${id}-t${i}-body-err` : undefined}
                  onChange={(e) => setTask(i, { body: e.target.value })}
                />
                <FieldError id={`${id}-t${i}-body-err`} text={p?.body} />
              </div>
              <div className="field">
                <label htmlFor={`${id}-t${i}-labels`}>
                  {t.rich("automation.plans.editor.taskLabels", {
                    n: i + 1,
                    hint: (
                      <span className="muted small">
                        {t("automation.plans.editor.labelsHint", { max: MAX_LABELS })}
                      </span>
                    ),
                  })}
                </label>
                <input
                  id={`${id}-t${i}-labels`}
                  type="text"
                  value={task.labels}
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
                aria-label={t("automation.plans.editor.removeTask", { n: i + 1 })}
                onClick={() => setDraft({ ...draft, tasks: draft.tasks.filter((_, j) => j !== i) })}
              >
                {t("automation.plans.editor.removeTask", { n: i + 1 })}
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
          {t("automation.plans.editor.addTask")}
        </button>
      </fieldset>
      <p className="muted small">{t("automation.plans.editor.note")}</p>
      <div className="button-row wrap">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t("automation.plans.editor.save")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("common.button.cancel")}
        </button>
      </div>
      <Feedback error={error} />
    </form>
  );
}

/** Exactly what each task would send, as plain text, with the policy's verdict. */
function Preview({ preview }: { preview: PlanPreview }) {
  const t = useT();
  return (
    <section aria-labelledby="preview-h" className="card">
      <h2 id="preview-h" className="h3">
        {t("automation.plans.preview.title")}
      </h2>
      <p className="muted small">{t("automation.plans.preview.intro")}</p>
      <ol className="preview-list" aria-label={t("automation.plans.preview.calls")}>
        {preview.tasks.map((call) => (
          <li key={call.task_index}>
            <p>
              <strong>
                {t("automation.plans.preview.task", {
                  n: call.task_index + 1,
                  tool: toolText(call.tool),
                })}
              </strong>{" "}
              <span className="muted small">
                {t("automation.plans.preview.decision", {
                  effect: call.decision.effect,
                  risk: call.decision.risk,
                })}
              </span>
            </p>
            <pre
              className="agent-output"
              tabIndex={0}
              aria-label={t("automation.plans.preview.input", { n: call.task_index + 1 })}
            >
              {JSON.stringify(call.input, null, 2)}
            </pre>
            {call.decision.reasons.length > 0 && (
              <p className="muted small memory-text">{call.decision.reasons.join(" ")}</p>
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
  const t = useT();
  if (runs.length === 0) return null;
  return (
    <section aria-labelledby="runs-h" className="card">
      <h2 id="runs-h" className="h3">
        {t("automation.plans.runs.title")}
      </h2>
      <ul className="task-list" aria-label={t("automation.plans.runs.label")}>
        {runs.map((r) => (
          <li key={r.task_index}>
            <strong>{t("automation.plans.runs.task", { n: r.task_index + 1 })}</strong>{" "}
            {runText(r.status)}
            {r.attempts > 1 && (
              <span className="muted small">
                {" "}
                · {t("automation.plans.runs.attempts", { count: r.attempts })}
              </span>
            )}
            {r.external_id && (
              <span className="memory-text">
                {" "}
                ·{" "}
                {system === "frappe"
                  ? t("automation.plans.runs.frappeTask", { id: r.external_id })
                  : r.external_id}
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
          {t("automation.plans.runs.stopped", {
            n: report.failure.task_index + 1,
            message: report.failure.message,
          })}
        </p>
      )}
    </section>
  );
}

/** One plan: read it, edit it, see exactly what it would send, approve it, create its tasks. */
export function PlanPage({ planId }: { planId: string }) {
  const t = useT();
  const { locale } = useLocale();
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
          {error} <a href="#/meetings">{t("automation.plans.page.allMeetings")}</a>
        </p>
      </div>
    );
  }
  if (!plan || !data) return <p className="muted">{t("common.status.loading")}</p>;

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
    setNotice(res ? t("automation.plans.page.approvedNotice") : "");
    await reload();
  };
  const save = async (body: PlanEditBody) => {
    const res = await change.run<PlanDetail>("POST", `${path}/edit`, body);
    if (res) {
      setEditing(false);
      setNotice(t("automation.plans.page.savedNotice"));
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
        <a href={`#/meetings/${encodeURIComponent(plan.meeting_id)}`}>
          {t("automation.plans.page.meeting")}
        </a>
      </p>
      <h1 className="memory-text">{plan.title}</h1>
      <p>
        <strong>{statusText(plan.status)}</strong>
      </p>
      <p className="small">
        <span className={`mem-badge ${plan.not_ai_generated ? "" : "mem-kind-interpretation"}`}>
          {plan.not_ai_generated
            ? t("automation.plans.page.rules")
            : t("automation.plans.page.model")}
        </span>{" "}
        {authorshipText(plan)}
      </p>
      <p className="small">
        {t.rich("automation.plans.page.destination", {
          destination: <strong>{destinationText(plan.destination)}</strong>,
        })}
      </p>
      <p className="muted small memory-text">
        {t("automation.plans.page.from", {
          kind: kindText(plan.source.kind),
          text: plan.source.item_text,
        })}
        {plan.source.owner &&
          ` · ${t("automation.plans.page.owner", { owner: plan.source.owner })}`}
        {plan.source.due && ` · ${t("automation.plans.page.due", { due: plan.source.due })}`}
      </p>
      {off && <PlanningOff reasons={status.reasons} />}
      <p className="review-live small" role="status" aria-live="polite">
        {notice}
      </p>

      <section aria-labelledby="plan-h" className="card">
        <h2 id="plan-h" className="h3">
          {t("automation.plans.page.plan")}
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
            <p className="muted small">({basisText(plan.summary.basis)})</p>
            {plan.summary.basis === "meeting" && plan.summary.quote && (
              <blockquote className="quote">{plan.summary.quote}</blockquote>
            )}
            <h3 className="h4">
              {t("automation.plans.page.tasks", { count: formatNumber(total) })}
            </h3>
            <ol className="plan-task-list" aria-label={t("automation.plans.page.tasksLabel")}>
              {plan.tasks.map((task, i) => (
                <li key={i} className="card">
                  <p className="memory-text">
                    <strong>{task.title}</strong>{" "}
                    <span className="muted small">({basisText(task.basis)})</span>
                  </p>
                  {task.body && <p className="memory-text">{task.body}</p>}
                  {task.labels.length > 0 && (
                    <p className="small">
                      {t("automation.plans.page.labels")}{" "}
                      {task.labels.map((l) => (
                        <span key={l} className="chip">
                          {l}
                        </span>
                      ))}
                    </p>
                  )}
                  {task.basis === "meeting" && task.quote && (
                    <blockquote className="quote">{task.quote}</blockquote>
                  )}
                </li>
              ))}
            </ol>
            {plan.destination.system === "frappe" && plan.frappe && (
              <section aria-labelledby="frappe-design-h">
                <h3 id="frappe-design-h" className="h4">
                  {t.rich("automation.plans.frappe.doctype", {
                    doctype: <span className="memory-text">{plan.frappe.doctype}</span>,
                  })}
                </h3>
                <p className="muted small">{t("automation.plans.frappe.note")}</p>
                <h4>{t("automation.plans.frappe.fields")}</h4>
                {plan.frappe.fields.length ? (
                  <ul className="task-list" aria-label={t("automation.plans.frappe.fieldsLabel")}>
                    {plan.frappe.fields.map((field, i) => (
                      <li key={i} className="memory-text">
                        {field.label} · {field.fieldtype}
                        {field.required ? ` · ${t("automation.plans.frappe.required")}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">{t("automation.plans.frappe.noFields")}</p>
                )}
                <h4>{t("automation.plans.frappe.states")}</h4>
                {plan.frappe.workflow_states.length ? (
                  <ol className="task-list" aria-label={t("automation.plans.frappe.statesLabel")}>
                    {plan.frappe.workflow_states.map((state, i) => (
                      <li key={i} className="memory-text">
                        {i + 1}. {state}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted small">{t("automation.plans.frappe.noStates")}</p>
                )}
                <h4>{t("automation.plans.frappe.permissions")}</h4>
                {plan.frappe.permissions.length ? (
                  <ul
                    className="task-list"
                    aria-label={t("automation.plans.frappe.permissionsLabel")}
                  >
                    {plan.frappe.permissions.map((permission, i) => (
                      <li key={i} className="memory-text">
                        {t("automation.plans.frappe.access", {
                          role: permission.role,
                          access:
                            new Intl.ListFormat(intlLocale(locale), { type: "unit" }).format(
                              [
                                permission.read && t("automation.plans.frappe.read"),
                                permission.write && t("automation.plans.frappe.write"),
                                permission.create && t("automation.plans.frappe.create"),
                              ].filter((word) => typeof word === "string"),
                            ) || t("automation.plans.frappe.noAccess"),
                        })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">{t("automation.plans.frappe.noPermissions")}</p>
                )}
              </section>
            )}
            <Statements
              heading={t("automation.plans.page.acceptance")}
              items={plan.acceptance_criteria}
            />
            <Statements heading={t("automation.plans.page.risks")} items={plan.risks} />
            {plan.open_questions.length > 0 && (
              <>
                <h3 className="h4">{t("automation.plans.page.questions")}</h3>
                <ul className="task-list" aria-label={t("automation.plans.page.questions")}>
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
                {t("automation.plans.page.edit")}
              </button>
            )}
          </>
        )}
      </section>

      {preview && !editing && <Preview preview={preview} />}

      <section aria-labelledby="decide-h" className="card">
        <h2 id="decide-h" className="h3">
          {t("automation.plans.decide.title")}
        </h2>
        <p className="muted small memory-text">
          {t.rich("automation.plans.decide.fingerprint", {
            hash: <code>{plan.content_hash.slice(0, 16)}</code>,
          })}
        </p>
        {plan.status === "draft" && (
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={locked}
              onClick={() => void act("propose", t("automation.plans.page.proposedNotice"))}
            >
              {t("automation.plans.decide.propose")}
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
              {t("automation.plans.decide.nameMeeting")}
            </label>
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={locked}
                onClick={() => void approve()}
              >
                {t("automation.plans.decide.approve")}
              </button>
            </div>
          </>
        )}
        {plan.approved && (
          <p className="small">
            {t.rich(
              plan.include_meeting_ref
                ? "automation.plans.decide.approvedNamed"
                : "automation.plans.decide.approved",
              {
                by: plan.approved.by,
                date: <time dateTime={plan.approved.at}>{formatDate(plan.approved.at)}</time>,
              },
            )}
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
              {t("automation.plans.decide.understand", {
                count: total,
                destination: destinationText(plan.destination),
              })}
            </label>
            <div className="button-row wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={creating || !understood || off || plan.status === "creating"}
                onClick={() => void createTasks()}
              >
                {plan.status === "failed"
                  ? t("automation.plans.decide.createRemaining")
                  : t("automation.plans.decide.create")}
              </button>
            </div>
          </div>
        )}
        {creating && (
          <div role="status">
            <p>
              <strong>
                {t("automation.plans.decide.waiting", {
                  n: waitingTask(data.runs, total),
                  total,
                })}
              </strong>
            </p>
            <p className="muted small">{t("automation.plans.decide.waitingNote")}</p>
          </div>
        )}
        {creating && <Approvals />}
        {CANCELLABLE[plan.status] && !creating && (
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-danger-outline"
              disabled={locked}
              onClick={() => void act("cancel", t("automation.plans.page.cancelledNotice"))}
            >
              {t("automation.plans.decide.cancel")}
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
            {t("automation.plans.meeting.tasksCreated")}
          </h2>
          <ul className="task-list" aria-label={t("automation.plans.meeting.tasksCreated")}>
            {data.links.map((l) => (
              <LinkRow key={l.id} link={l} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
