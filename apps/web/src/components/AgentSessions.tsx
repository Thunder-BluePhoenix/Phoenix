// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  CONFIDENCE_TEXT,
  launchersOf,
  LINK_KIND_TEXT,
  MAX_MESSAGE_CHARS,
  MAX_PROMPT_CHARS,
  MAX_QUESTION_CHARS,
  OUTPUT_LINES,
  PLAIN_NUMBER,
  SESSION_STATE_TEXT,
  validateStart,
  type StartProblems,
} from "../core/agent-sessions";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { formatAgo, formatDate, formatNumber, formatTime, translated } from "../core/format";
import {
  useAction,
  useAgentLive,
  useAgentLiveSessions,
  useAgentUsage,
  useCapabilities,
  useCommandAction,
  useCommandResult,
} from "../core/hooks";
import type {
  AgentLauncher,
  AgentLink,
  DiffLink,
  LiveDiff,
  LiveFileOf,
  LiveSessionDetail,
  OrchestratedSession,
  OrchestratedSessionDetail,
  OrchestratedSessionList,
  UsageView,
} from "../core/types";
import { useT, type MessageKey, type Translate } from "../i18n";
import { Approvals } from "./Approvals";
import { Feedback } from "./Feedback";

const STEP_KIND_TEXT = translated({
  read: "agents.sessions.steps.kind.read",
  edit: "agents.sessions.steps.kind.edit",
  run: "agents.sessions.steps.kind.run",
  other: "agents.sessions.steps.kind.other",
});

/** The `agents` capability's command shown in the approval note; a command identifier, not prose. */
const START_ACTION = "agents: session.start";
/** The capability id named in the "capability is off" notice. */
const AGENTS_CAPABILITY = "agents";

/** A limit or count written the way the commands document it: digits of the language, no grouping. */
const plain = (n: number): string => formatNumber(n, undefined, PLAIN_NUMBER);
/** Steps shown in the ticker, and in the orchestrated page's merged timeline. */
const SHOWN_STEPS = 100;
const TIMELINE_STEPS = 50;

const sessionHref = (id: string) => `#/agents/${encodeURIComponent(id)}`;

/** Saved settings are not live: the active launcher list comes from the enabled orchestrator. */
function useAgentsAvailability() {
  const { data: caps, reload } = useCapabilities();
  const agents = caps.find((c) => c.id === "agents");
  const enabled = agents?.status === "enabled";
  const { data: active } = useCommandResult<{ launchers: Record<string, AgentLauncher> }>(
    "agents",
    "launcher.list",
    enabled,
    () => false,
  );
  return { agents, enabled, launchers: active?.launchers, reload };
}

/** The status line of a command that waits for the user's approval, then the approval itself. */
function CommandStatus({
  state,
  error,
  waiting,
  done,
}: {
  state: string;
  error: string | null;
  waiting: string;
  done?: string;
}) {
  const t = useT();
  return (
    <>
      {(state === "waiting" || state === "running") && (
        <>
          <p className="small" role="status">
            {state === "waiting" ? waiting : t("agents.sessions.running")}
          </p>
          <Approvals />
        </>
      )}
      {state === "succeeded" && done && (
        <p className="small" role="status">
          {done}
        </p>
      )}
      <Feedback error={error} />
    </>
  );
}

/** Saves configuration only. Restart is a separate, potentially disruptive user action. */
function LauncherEditor({
  config,
  enabled,
  onSaved,
}: {
  config: Record<string, unknown>;
  enabled: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [roots, setRoots] = useState("");
  const [env, setEnv] = useState("");
  const [waiting, setWaiting] = useState("");
  const [stdin, setStdin] = useState<"keep_open" | "close_after_prompt">("keep_open");
  const [problem, setProblem] = useState("");
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const id = useId();
  const savedLaunchers = launchersOf(config);
  const names = Object.keys(savedLaunchers);
  const lines = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));
  const change = () => {
    setPreview(false);
    setSaved(false);
    setProblem("");
  };

  const review = (event: FormEvent) => {
    event.preventDefault();
    const argv = lines(command);
    const folders = lines(roots);
    const allowed = lines(env);
    const prompts = lines(waiting);
    const clean = (path: string) =>
      path.startsWith("/") &&
      !path.includes("//") &&
      !path.split("/").some((part) => part === "." || part === "..") &&
      !/[\u0000-\u001f\u007f]/.test(path);
    let message = "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(name))
      message = t("agents.sessions.editor.error.name");
    else if (!Object.hasOwn(savedLaunchers, name) && names.length >= 8)
      message = t("agents.sessions.editor.error.tooMany");
    else if (
      argv.length < 1 ||
      argv.length > 32 ||
      argv.some((a) => !a.length || a.length > 1000 || /[\u0000-\u001f\u007f]/.test(a)) ||
      !clean(argv[0]!) ||
      argv[0]!.endsWith("/") ||
      /^(sh|bash|zsh|dash|fish|ksh|csh|tcsh)$/.test(argv[0]!.split("/").at(-1) ?? "")
    )
      message = t("agents.sessions.editor.error.command");
    else if (
      folders.length < 1 ||
      folders.length > 8 ||
      folders.some(
        (r) =>
          !r.length ||
          !clean(r) ||
          r === "/" ||
          r.endsWith("/") ||
          r.includes("*") ||
          r.length > 1000,
      )
    )
      message = t("agents.sessions.editor.error.folders");
    else if (
      allowed.length > 16 ||
      allowed.some((n) => !/^[A-Z_][A-Z0-9_]{0,63}$/.test(n) || n.startsWith("PHOENIX_"))
    )
      message = t("agents.sessions.editor.error.env");
    else if (
      prompts.length > 8 ||
      prompts.some((p) => !p.length || p.length > 100 || /[\u0000-\u001f\u007f]/.test(p))
    )
      message = t("agents.sessions.editor.error.waiting");
    setProblem(message);
    setPreview(!message);
  };
  const save = async () => {
    if (!preview || busy) return;
    // Preserve all other capability settings and existing full launcher specs.
    const previous =
      config.launchers && typeof config.launchers === "object" && !Array.isArray(config.launchers)
        ? (config.launchers as Record<string, unknown>)
        : {};
    const launchers = {
      ...previous,
      [name]: {
        command: lines(command),
        cwd_roots: lines(roots),
        ...(lines(env).length ? { env_allow: lines(env) } : {}),
        ...(lines(waiting).length ? { waiting_prompts: lines(waiting) } : {}),
        stdin,
      },
    };
    const result = await run("POST", "/api/capabilities/agents/config", {
      config: { ...config, launchers },
    });
    if (result !== undefined) {
      setSaved(true);
      setPreview(false);
      onSaved();
    }
  };
  const select = (selected: string) => {
    change();
    setName(selected);
    const raw =
      config.launchers && typeof config.launchers === "object" && !Array.isArray(config.launchers)
        ? Object.entries(config.launchers).find(([key]) => key === selected)?.[1]
        : undefined;
    const spec =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const strings = (key: string) =>
      Array.isArray(spec[key])
        ? (spec[key] as unknown[]).filter((x): x is string => typeof x === "string").join("\n")
        : "";
    setCommand(strings("command"));
    setRoots(strings("cwd_roots"));
    setEnv(strings("env_allow"));
    setWaiting(strings("waiting_prompts"));
    setStdin(spec.stdin === "close_after_prompt" ? "close_after_prompt" : "keep_open");
  };
  return (
    <section className="card" aria-label={t("agents.sessions.editor.label")}>
      <h2 className="h3">{t("agents.sessions.editor.title")}</h2>
      <p className="muted small">{t("agents.sessions.editor.intro")}</p>
      <form onSubmit={review} className="settings-form">
        <label className="field" htmlFor={`${id}-existing`}>
          {t("agents.sessions.editor.editSaved")}
          <select
            id={`${id}-existing`}
            value={Object.hasOwn(savedLaunchers, name) ? name : ""}
            onChange={(e) => select(e.target.value)}
          >
            <option value="">{t("agents.sessions.editor.newLauncher")}</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t("agents.sessions.editor.name")}
          <input
            value={name}
            onChange={(e) => {
              change();
              setName(e.target.value);
            }}
          />
        </label>
        <label className="field">
          {t("agents.sessions.editor.command")}
          <textarea
            rows={3}
            spellCheck={false}
            value={command}
            onChange={(e) => {
              change();
              setCommand(e.target.value);
            }}
          />
        </label>
        <label className="field">
          {t("agents.sessions.editor.roots")}
          <textarea
            rows={2}
            spellCheck={false}
            value={roots}
            onChange={(e) => {
              change();
              setRoots(e.target.value);
            }}
          />
        </label>
        <label className="field">
          {t("agents.sessions.editor.env")}
          <textarea
            rows={2}
            spellCheck={false}
            value={env}
            onChange={(e) => {
              change();
              setEnv(e.target.value);
            }}
          />
        </label>
        <label className="field">
          {t("agents.sessions.editor.waiting")}
          <textarea
            rows={2}
            value={waiting}
            onChange={(e) => {
              change();
              setWaiting(e.target.value);
            }}
          />
        </label>
        <label className="field">
          {t("agents.sessions.editor.inputMode")}
          <select
            value={stdin}
            onChange={(e) => {
              change();
              setStdin(e.target.value as "keep_open" | "close_after_prompt");
            }}
          >
            <option value="keep_open">{t("agents.sessions.editor.keepOpen")}</option>
            <option value="close_after_prompt">{t("agents.sessions.editor.closeAfter")}</option>
          </select>
        </label>
        <button className="btn" type="submit">
          {t("agents.sessions.editor.review")}
        </button>
      </form>
      {problem && (
        <p role="alert" className="error-text">
          {problem}
        </p>
      )}
      {preview && (
        <div role="group" aria-label={t("agents.sessions.editor.previewLabel")}>
          <p>
            {t.rich("agents.sessions.editor.previewText", {
              name: <strong>{name}</strong>,
              command: <code>{lines(command)[0]}</code>,
              count: lines(command).length - 1,
              folders: lines(roots).join(", "),
              mode:
                stdin === "keep_open"
                  ? t("agents.sessions.editor.modeMessages")
                  : t("agents.sessions.editor.modeClose"),
            })}
          </p>
          <p className="muted small">
            {t("agents.sessions.editor.previewNote")}{" "}
            {enabled
              ? t("agents.sessions.editor.restartEnabled")
              : t("agents.sessions.editor.restartDisabled")}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {t("agents.sessions.editor.save")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setPreview(false)}>
            {t("agents.sessions.editor.backToEdit")}
          </button>
        </div>
      )}
      {saved && (
        <p role="status">
          {t("agents.sessions.editor.saved")}{" "}
          {enabled
            ? t("agents.sessions.editor.savedEnabled")
            : t("agents.sessions.editor.savedDisabled")}
        </p>
      )}
      <Feedback error={error} />
    </section>
  );
}

function StartSession({ launchers }: { launchers: Record<string, AgentLauncher> }) {
  const t = useT();
  const names = Object.keys(launchers);
  const start = useCommandAction<OrchestratedSession>("agents", "session.start");
  const [launcher, setLauncher] = useState(names[0] ?? "");
  const [workspace, setWorkspace] = useState("");
  const [prompt, setPrompt] = useState("");
  const [problems, setProblems] = useState<StartProblems>({});
  const [reviewing, setReviewing] = useState(false);
  const id = useId();
  const spec = Object.hasOwn(launchers, launcher) ? launchers[launcher] : undefined;

  const review = (e: FormEvent) => {
    e.preventDefault();
    const found = validateStart({ launcher, workspace, prompt }, launchers);
    setProblems(found);
    if (Object.keys(found).length === 0) setReviewing(true);
  };

  const confirm = () => {
    if (!Object.hasOwn(launchers, launcher) || !reviewing) return;
    void start.submit({ launcher, workspace: workspace.trim(), prompt });
  };

  const cancel = () => {
    if (!start.busy) {
      setReviewing(false);
      start.reset();
    }
  };

  return (
    <section aria-labelledby="start-h" className="card">
      <h2 id="start-h" className="h3">
        {t("agents.sessions.start.title")}
      </h2>
      {!reviewing ? (
        <form className="start-meeting" onSubmit={review} noValidate>
          <div className="field">
            <label htmlFor={`${id}-launcher`}>{t("agents.sessions.start.launcher")}</label>
            <select
              id={`${id}-launcher`}
              value={launcher}
              aria-invalid={problems.launcher ? true : undefined}
              onChange={(e) => setLauncher(e.target.value)}
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {problems.launcher && (
              <p className="error-text small" role="alert">
                {problems.launcher}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-ws`}>{t("agents.sessions.start.workspace")}</label>
            <input
              id={`${id}-ws`}
              type="text"
              value={workspace}
              spellCheck={false}
              aria-invalid={problems.workspace ? true : undefined}
              aria-describedby={problems.workspace ? `${id}-ws-err` : undefined}
              onChange={(e) => setWorkspace(e.target.value)}
            />
            {problems.workspace && (
              <p id={`${id}-ws-err`} className="error-text small" role="alert">
                {problems.workspace}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-prompt`}>
              {t("agents.sessions.start.prompt")}{" "}
              <span className="muted small">
                {t("agents.sessions.limit", { max: plain(MAX_PROMPT_CHARS) })}
              </span>
            </label>
            <textarea
              id={`${id}-prompt`}
              rows={4}
              value={prompt}
              aria-invalid={problems.prompt ? true : undefined}
              aria-describedby={problems.prompt ? `${id}-prompt-err` : undefined}
              onChange={(e) => setPrompt(e.target.value)}
            />
            {problems.prompt && (
              <p id={`${id}-prompt-err`} className="error-text small" role="alert">
                {problems.prompt}
              </p>
            )}
          </div>
          <button type="submit" className="btn btn-primary">
            {t("agents.sessions.start.review")}
          </button>
        </form>
      ) : (
        <div className="start-preview" role="group" aria-labelledby={`${id}-preview-h`}>
          <h3 id={`${id}-preview-h`} className="h4">
            {t("agents.sessions.start.checkTitle")}
          </h3>
          <dl className="approval-facts small">
            <dt>{t("agents.sessions.start.launcher")}</dt>
            <dd className="memory-text">{launcher}</dd>
            <dt>{t("agents.sessions.start.itWillRun")}</dt>
            <dd className="memory-text">
              {t.rich("agents.sessions.start.runLine", {
                command: <code>{spec?.command[0] ?? t("agents.sessions.start.unknown")}</code>,
                count: Math.max(0, (spec?.command.length ?? 1) - 1),
              })}
            </dd>
            <dt>{t("agents.sessions.start.workspaceFact")}</dt>
            <dd className="memory-text">
              <code>{workspace.trim()}</code>
            </dd>
            <dt>{t("agents.sessions.start.folders")}</dt>
            <dd className="memory-text">
              {spec && spec.cwd_roots.length > 0
                ? spec.cwd_roots.join(", ")
                : t("agents.sessions.start.noneListed")}
            </dd>
            <dt>{t("agents.sessions.start.promptFact")}</dt>
            <dd className="memory-text">
              {t("agents.sessions.start.promptSummary", { count: prompt.length })}
            </dd>
          </dl>
          <p className="muted small">
            {t.rich("agents.sessions.start.approvalNote", {
              action: <strong>{START_ACTION}</strong>,
            })}
          </p>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={start.busy || start.state === "succeeded"}
              onClick={confirm}
            >
              {t("agents.sessions.start.confirm")}
            </button>
            <button type="button" className="btn" disabled={start.busy} onClick={cancel}>
              {start.state === "succeeded"
                ? t("agents.sessions.start.done")
                : t("common.button.back")}
            </button>
          </div>
          <CommandStatus
            state={start.state}
            error={start.error}
            waiting={t("agents.sessions.waitingApproval")}
            done={
              start.result
                ? t("agents.sessions.start.startedId", { id: start.result.id })
                : t("agents.sessions.start.started")
            }
          />
          {start.result && (
            <p className="small">
              <a href={sessionHref(start.result.id)}>{t("agents.sessions.start.open")}</a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function SessionRow({ session }: { session: OrchestratedSession }) {
  const t = useT();
  return (
    <li className="card meeting-row">
      <a href={sessionHref(session.id)}>
        {t.rich("agents.sessions.inRepository", {
          agent: <strong>{session.launcher}</strong>,
          repository: session.repository,
        })}
      </a>
      <span className={session.state === "waiting" ? "agent-waiting" : "small"}>
        {SESSION_STATE_TEXT[session.state]}
      </span>
      <span className="muted small memory-text">
        {t("agents.sessions.row.started", { id: session.id, ago: formatAgo(session.started_at) })}
      </span>
    </li>
  );
}

/** One ambiguous link, with a button per candidate session. Resolving asks for approval. */
function AmbiguousLink({ link, onResolved }: { link: AgentLink; onResolved: () => void }) {
  const t = useT();
  const resolve = useCommandAction<AgentLink>("agents", "link.resolve");
  useEffect(() => {
    if (resolve.state === "succeeded") onResolved();
  }, [resolve.state, onResolved]);
  return (
    <li className="card">
      <p className="memory-text">
        {t.rich("agents.sessions.link.confidenceLine", {
          kind: LINK_KIND_TEXT[link.kind] ?? link.kind,
          ref: <code className="break">{link.ref}</code>,
          repo: link.repo,
          confidence: CONFIDENCE_TEXT.ambiguous,
        })}
      </p>
      <p className="muted small">{t("agents.sessions.link.pickHint")}</p>
      <div className="button-row wrap">
        {(link.candidates ?? []).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className="btn"
            disabled={resolve.busy}
            aria-label={t("agents.sessions.link.pickLabel", {
              kind: LINK_KIND_TEXT[link.kind] ?? link.kind,
              ref: link.ref,
              session: candidate,
            })}
            onClick={() => void resolve.submit({ link_id: link.id, session_id: candidate })}
          >
            {t("agents.sessions.link.belongsTo", { session: candidate })}
          </button>
        ))}
      </div>
      <CommandStatus
        state={resolve.state}
        error={resolve.error}
        waiting={t("agents.sessions.waitingApproval")}
        done={t("agents.sessions.link.saved")}
      />
    </li>
  );
}

/** Coding agents Phoenix did not start, seen through their hooks. Hidden when there are none. */
function LiveSessionsList() {
  const t = useT();
  const { sessions, error } = useAgentLiveSessions();
  if (error || sessions.length === 0) return null;
  return (
    <section aria-labelledby="live-sessions-h">
      <h2 id="live-sessions-h" className="h3">
        {t("agents.sessions.live.title")}
      </h2>
      <p className="muted small">{t("agents.sessions.live.intro")}</p>
      <ul className="card-list" aria-label={t("agents.sessions.live.title")}>
        {sessions.map((s) => (
          <li key={s.id} className="card meeting-row">
            <a href={sessionHref(s.id)}>
              {t.rich("agents.sessions.inRepository", {
                agent: <strong>{agentName(s.agent)}</strong>,
                repository: s.repository,
              })}
            </a>
            <span className="small">
              {s.active ? t("agents.sessions.active") : t("agents.sessions.ended")}
            </span>
            <span className="muted small memory-text">
              {t("agents.sessions.stepsSeen", {
                count: s.step_count,
                ago: formatAgo(s.last_seen),
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgentSessionsPage() {
  const t = useT();
  const { agents, enabled, launchers, reload: reloadCapabilities } = useAgentsAvailability();
  const { data, error, reload } = useCommandResult<OrchestratedSessionList>(
    "agents",
    "session.list",
    enabled,
    (type) => type.startsWith("agent."),
  );
  const sessions = data?.sessions ?? [];
  const ambiguous = data?.ambiguous_links ?? [];

  return (
    <div className="meetings agent-sessions">
      <h1>{t("agents.sessions.page.title")}</h1>
      <p className="muted">{t("agents.sessions.page.intro")}</p>
      {!enabled ? (
        <p role="status">
          {t.rich("agents.sessions.page.capabilityOff", {
            capability: <strong>{AGENTS_CAPABILITY}</strong>,
          })}
        </p>
      ) : !launchers ? (
        <p role="status">{t("agents.sessions.page.loadingLaunchers")}</p>
      ) : Object.keys(launchers).length === 0 ? (
        <p role="status">{t("agents.sessions.page.noLauncher")}</p>
      ) : (
        <StartSession launchers={launchers} />
      )}
      {agents && (
        <LauncherEditor
          config={agents.config ?? {}}
          enabled={enabled}
          onSaved={() => void reloadCapabilities()}
        />
      )}
      <LiveSessionsList />
      {enabled && (
        <>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <section aria-labelledby="sessions-h">
            <h2 id="sessions-h" className="h3">
              {t("agents.sessions.page.sessions")}
            </h2>
            {data && sessions.length === 0 && (
              <p className="muted">{t("agents.sessions.page.noSessions")}</p>
            )}
            <ul className="card-list" aria-label={t("agents.sessions.page.sessions")}>
              {sessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </ul>
          </section>
          {ambiguous.length > 0 && (
            <section aria-labelledby="ambiguous-h">
              <h2 id="ambiguous-h" className="h3">
                {t("agents.sessions.page.choose", { count: formatNumber(ambiguous.length) })}
              </h2>
              <ul className="card-list">
                {ambiguous.map((l) => (
                  <AmbiguousLink key={l.id} link={l} onResolved={() => void reload()} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SendMessage({
  sessionId,
  accepts,
  running,
}: {
  sessionId: string;
  accepts: boolean;
  running: boolean;
}) {
  const t = useT();
  const send = useCommandAction("agents", "session.send");
  const [message, setMessage] = useState("");
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (message.trim()) void send.submit({ session_id: sessionId, message });
  };
  useEffect(() => {
    if (send.state === "succeeded") setMessage("");
  }, [send.state]);
  if (!accepts) {
    return <p className="muted small">{t("agents.sessions.send.notAccepted")}</p>;
  }
  return (
    <form className="memory-form" onSubmit={submit}>
      <label htmlFor={id} className="small">
        {t.rich("agents.sessions.send.label", {
          limit: (
            <span className="muted">
              {t("agents.sessions.limit", { max: plain(MAX_MESSAGE_CHARS) })}
            </span>
          ),
        })}
      </label>
      <textarea
        id={id}
        rows={3}
        value={message}
        maxLength={MAX_MESSAGE_CHARS}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button
        type="submit"
        className="btn btn-primary"
        disabled={send.busy || !running || !message.trim()}
      >
        {t("agents.sessions.send.button")}
      </button>
      <CommandStatus
        state={send.state}
        error={send.error}
        waiting={t("agents.sessions.waitingApproval")}
        done={t("agents.sessions.send.done")}
      />
    </form>
  );
}

function Handoff({
  sessionId,
  accepts,
  running,
}: {
  sessionId: string;
  accepts: boolean;
  running: boolean;
}) {
  const t = useT();
  const handoff = useCommandAction<{ sent: boolean; count: number }>("agents", "context.handoff");
  const [question, setQuestion] = useState("");
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim()) void handoff.submit({ session_id: sessionId, question: question.trim() });
  };
  return (
    <form className="memory-form" onSubmit={submit}>
      <label htmlFor={id} className="small">
        {t("agents.sessions.handoff.label")}
      </label>
      <input
        id={id}
        type="text"
        value={question}
        maxLength={MAX_QUESTION_CHARS}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <p className="muted small">{t("agents.sessions.handoff.note")}</p>
      <button
        type="submit"
        className="btn"
        disabled={handoff.busy || !running || !question.trim() || !accepts}
      >
        {t("agents.sessions.handoff.button")}
      </button>
      <CommandStatus
        state={handoff.state}
        error={handoff.error}
        waiting={t("agents.sessions.waitingApproval")}
        done={
          handoff.result
            ? handoff.result.sent
              ? t("agents.sessions.handoff.sent", { count: handoff.result.count })
              : t("agents.sessions.handoff.nothing")
            : t("agents.sessions.handoff.done")
        }
      />
    </form>
  );
}

function StopSession({ sessionId, running }: { sessionId: string; running: boolean }) {
  const t = useT();
  const stop = useCommandAction("agents", "session.stop");
  return (
    <div>
      <button
        type="button"
        className="btn btn-danger-outline"
        disabled={stop.busy || !running}
        onClick={() => void stop.submit({ session_id: sessionId })}
      >
        {t("agents.sessions.stop.button")}
      </button>
      <p className="muted small">{t("agents.sessions.stop.note")}</p>
      <CommandStatus
        state={stop.state}
        error={stop.error}
        waiting={t("agents.sessions.waitingApproval")}
        done={t("agents.sessions.stop.done")}
      />
    </div>
  );
}

function Links({ links }: { links: AgentLink[] }) {
  const t = useT();
  return (
    <section aria-labelledby="links-h" className="card">
      <h2 id="links-h" className="h3">
        {t("agents.sessions.links.title")}
      </h2>
      <p className="muted small">{t("agents.sessions.links.note")}</p>
      {links.length === 0 ? (
        <p className="muted small">{t("agents.sessions.links.empty")}</p>
      ) : (
        <ul className="task-list" aria-label={t("agents.sessions.links.listLabel")}>
          {links.map((l) => (
            <li key={l.id}>
              {t.rich("agents.sessions.links.line", {
                kind: LINK_KIND_TEXT[l.kind] ?? l.kind,
                ref: <code className="break">{l.ref}</code>,
                repo: l.repo,
              })}
              <span className="muted small">
                {" "}
                · {CONFIDENCE_TEXT[l.confidence] ?? l.confidence}
              </span>
              {typeof l.why.rule === "string" && (
                <span className="muted small memory-text">
                  {" "}
                  · {t("agents.sessions.links.rule", { rule: l.why.rule })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Agent output is untrusted: plain text, in a box of fixed height, never markup. */
function Output({ lines, label }: { lines: string[]; label: string }) {
  const t = useT();
  return (
    <div>
      <h3 className="h4">{label}</h3>
      {lines.length === 0 ? (
        <p className="muted small">{t("agents.sessions.output.empty")}</p>
      ) : (
        <pre
          className="agent-output"
          tabIndex={0}
          aria-label={t("agents.sessions.output.ariaLabel", { label })}
        >
          {lines.join("\n")}
        </pre>
      )}
    </div>
  );
}

interface TimelineRow {
  key: string;
  at: string;
  kind: string;
  detail?: Record<string, unknown>;
}

/** The recorded entries in their own order, with the latest live steps slotted in by time. */
function mergeTimeline(
  entries: OrchestratedSessionDetail["timeline"],
  steps: LiveSessionDetail["steps"],
): TimelineRow[] {
  const pending: TimelineRow[] = steps.slice(-TIMELINE_STEPS).map((s) => ({
    key: `step:${s.session_id}:${s.n}`,
    at: s.at,
    kind: `step.${s.kind}`,
    detail: { tool: s.tool, target: s.target },
  }));
  const rows: TimelineRow[] = [];
  entries.forEach((e, i) => {
    const at = Date.parse(e.at);
    while (pending.length > 0 && Date.parse(pending[0]!.at) < at) rows.push(pending.shift()!);
    rows.push({ key: `${e.at}:${i}`, at: e.at, kind: e.kind, detail: e.detail });
  });
  return [...rows, ...pending];
}

function OrchestratedSessionPage({ sessionId }: { sessionId: string }) {
  const t = useT();
  const { enabled } = useAgentsAvailability();
  // Live steps of the agents that ran in this session's workspace while it was active.
  const live = useAgentLive(sessionId).data;
  const { data, error, reload } = useCommandResult<OrchestratedSessionDetail>(
    "agents",
    "session.get",
    enabled,
    (type) => type.startsWith("agent."),
    { session_id: sessionId, output_lines: OUTPUT_LINES },
  );
  const [announced, setAnnounced] = useState(false);
  useEffect(() => setAnnounced(data !== null), [data]);

  if (!enabled) {
    return (
      <div className="meetings">
        <p role="status">
          {t("agents.sessions.capabilityOff")}{" "}
          <a href="#/agents">{t("agents.sessions.backToSessions")}</a>
        </p>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="meetings">
        <p role="alert">
          {error} <a href="#/agents">{t("agents.sessions.all")}</a>
        </p>
      </div>
    );
  }
  if (!data) return <p className="muted">{t("common.status.loading")}</p>;

  const { session } = data;
  const running = session?.state === "running" || session?.state === "waiting";
  const timeline = mergeTimeline(data.timeline, live?.steps ?? []);

  return (
    <div className="meetings agent-sessions">
      <p>
        <a href="#/agents">{t("agents.sessions.backAll")}</a>
      </p>
      <h1 className="memory-text">{t("agents.sessions.detail.title", { id: sessionId })}</h1>
      {!session ? (
        <p className="muted">{t("agents.sessions.detail.gone")}</p>
      ) : (
        <section aria-labelledby="session-h" className="card">
          <h2 id="session-h" className="h3">
            {t("agents.sessions.inRepository", {
              agent: session.launcher,
              repository: session.repository,
            })}
          </h2>
          <p className={session.state === "waiting" ? "agent-waiting" : ""}>
            <strong>{SESSION_STATE_TEXT[session.state]}</strong>
            {session.stop_reason && (
              <> · {t("agents.sessions.detail.stopReason", { reason: session.stop_reason })}</>
            )}
            {session.failure && <> · {session.failure}</>}
            {session.exit_code !== undefined && session.exit_code !== null && (
              <> · {t("agents.sessions.detail.exitCode", { code: session.exit_code })}</>
            )}
          </p>
          <p className="muted small memory-text">
            {t.rich("agents.sessions.detail.facts", {
              path: <code>{session.workspace}</code>,
              date: <time dateTime={session.started_at}>{formatDate(session.started_at)}</time>,
              count: session.messages_sent,
            })}
          </p>
          <div className="button-row wrap">
            <button type="button" className="btn" onClick={() => void reload()}>
              {t("common.button.refresh")}
            </button>
          </div>
        </section>
      )}
      {announced && (
        <p className="sr-only" role="status">
          {t("agents.sessions.detail.loaded")}
        </p>
      )}

      {session && (
        <section aria-labelledby="output-h" className="card">
          <h2 id="output-h" className="h3">
            {t("agents.sessions.detail.printed")}
          </h2>
          <p className="muted small">
            {t("agents.sessions.detail.printedNote", { count: plain(OUTPUT_LINES) })}
          </p>
          <Output lines={data.output?.stdout ?? []} label={t("agents.sessions.output.output")} />
          <Output lines={data.output?.stderr ?? []} label={t("agents.sessions.output.errors")} />
        </section>
      )}

      <section aria-labelledby="timeline-h" className="card">
        <h2 id="timeline-h" className="h3">
          {t("agents.sessions.detail.timeline")}
        </h2>
        {timeline.length === 0 ? (
          <p className="muted small">{t("agents.sessions.detail.nothingRecorded")}</p>
        ) : (
          <ol className="timeline" aria-label={t("agents.sessions.detail.timeline")}>
            {timeline.map((row) => (
              <li key={row.key} className="small memory-text">
                <time dateTime={row.at}>{formatTime(row.at)}</time> · {row.kind}
                {row.detail &&
                  ` · ${Object.entries(row.detail)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(", ")}`}
              </li>
            ))}
          </ol>
        )}
      </section>
      <LiveActivity sessionId={sessionId} data={live} />

      <Links links={data.links} />
      {data.ambiguous.length > 0 && (
        <section aria-labelledby="amb-h">
          <h2 id="amb-h" className="h3">
            {t("agents.sessions.page.choose", { count: formatNumber(data.ambiguous.length) })}
          </h2>
          <ul className="card-list">
            {data.ambiguous.map((l) => (
              <AmbiguousLink key={l.id} link={l} onResolved={() => void reload()} />
            ))}
          </ul>
        </section>
      )}

      {session && (
        <section aria-labelledby="control-h" className="card">
          <h2 id="control-h" className="h3">
            {t("agents.sessions.detail.talk")}
          </h2>
          {!running && <p className="muted small">{t("agents.sessions.detail.over")}</p>}
          <SendMessage sessionId={sessionId} accepts={session.accepts_input} running={running} />
          <Handoff sessionId={sessionId} accepts={session.accepts_input} running={running} />
          <StopSession sessionId={sessionId} running={running} />
        </section>
      )}
    </div>
  );
}

const AGENT_NAMES: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };
const agentName = (agent: string) => AGENT_NAMES[agent] ?? agent;
const USAGE_METER_LABEL: Record<UsageView["window"], MessageKey> = {
  "5h": "agents.sessions.usage.meterLabel.fiveHour",
  weekly: "agents.sessions.usage.meterLabel.weekly",
};
const USAGE_LINE: Record<UsageView["window"], MessageKey> = {
  "5h": "agents.sessions.usage.line.fiveHour",
  weekly: "agents.sessions.usage.line.weekly",
};

/** "resets in 2h 10m", "resets in 45m", "resets in 3d 4h": coarse on purpose, not exact to the second. */
function formatResetIn(t: Translate, iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return t("agents.sessions.usage.resetsNow");
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return t("agents.sessions.usage.resetsMinutes", { minutes: formatNumber(min) });
  const h = Math.floor(min / 60);
  if (h < 48)
    return t("agents.sessions.usage.resetsHours", {
      hours: formatNumber(h),
      minutes: formatNumber(min % 60),
    });
  return t("agents.sessions.usage.resetsDays", {
    days: formatNumber(Math.floor(h / 24)),
    hours: formatNumber(h % 24),
  });
}

/** Plan usage per agent window, with a text for every state (colour is never the only signal). */
function UsageMeters() {
  const t = useT();
  const { usage, unsupported } = useAgentUsage();
  const id = useId();
  if (usage.length === 0 && unsupported.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-labelledby={`${id}-h`} className="card">
      <h2 id={`${id}-h`} className="h3">
        {t("agents.sessions.usage.title")}
      </h2>
      <ul className="task-list" aria-label={t("agents.sessions.usage.title")}>
        {usage.map((u) => {
          const pct = Math.min(100, Math.max(0, Math.round(u.used_pct)));
          const reset = formatResetIn(t, u.resets_at, now);
          return (
            <li key={`${u.agent}:${u.window}`} className={`usage usage-${u.level}`}>
              <div
                className="usage-meter"
                role="meter"
                aria-label={t(USAGE_METER_LABEL[u.window], { agent: agentName(u.agent) })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-valuetext={t("agents.sessions.usage.valueText", { pct: formatNumber(pct) })}
              >
                <div className="usage-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="small memory-text">
                {t.rich(USAGE_LINE[u.window], {
                  agent: <strong>{agentName(u.agent)}</strong>,
                  pct: formatNumber(pct),
                })}
                {reset && ` · ${reset}`}
              </p>
              {u.level !== "ok" && (
                <p className="small usage-note">
                  {u.level === "critical"
                    ? t("agents.sessions.usage.critical")
                    : t("agents.sessions.usage.warn")}
                </p>
              )}
              {u.stale && (
                <p className="muted small">
                  {t.rich("agents.sessions.usage.stale", {
                    ago: <time dateTime={u.observed_at}>{formatAgo(u.observed_at)}</time>,
                  })}
                </p>
              )}
              {typeof u.reset_credits === "number" && (
                <p className="muted small">
                  {t("agents.sessions.usage.resetCredits", { count: u.reset_credits })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {unsupported.map((u) => (
        <p key={u.agent} className="muted small memory-text">
          {u.agent}: {u.reason}
        </p>
      ))}
    </section>
  );
}

function StepsLog({ detail }: { detail: LiveSessionDetail }) {
  const t = useT();
  const id = useId();
  const shown = detail.steps.slice(-SHOWN_STEPS);
  const last = shown.at(-1);
  const lastKey = last ? `${last.session_id}:${last.n}` : "";
  const log = useRef<HTMLDivElement>(null);
  // Follow new steps only while the reader is at the bottom; scrolling up pauses it.
  const following = useRef(true);
  const agentOf = new Map(detail.sessions.map((s) => [s.id, s.agent]));

  useEffect(() => {
    const el = log.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  return (
    <section aria-labelledby={`${id}-h`} className="card">
      <h2 id={`${id}-h`} className="h3">
        {t("agents.sessions.steps.title")}
      </h2>
      {detail.sessions.length === 0 && shown.length === 0 && (
        <p className="muted small">{t("agents.sessions.steps.noLive")}</p>
      )}
      {detail.sessions.length > 0 && shown.length === 0 && (
        <p className="muted small">{t("agents.sessions.steps.none")}</p>
      )}
      {detail.dropped_steps > 0 && (
        <p className="muted small">
          {t("agents.sessions.steps.dropped", { count: detail.dropped_steps })}
        </p>
      )}
      {detail.steps.length > shown.length && (
        <p className="muted small">
          {t("agents.sessions.steps.showingLast", {
            shown: formatNumber(shown.length),
            total: formatNumber(detail.steps.length),
          })}
        </p>
      )}
      {shown.length > 0 && (
        <div
          ref={log}
          className="live-steps"
          role="log"
          aria-label={t("agents.sessions.steps.title")}
          aria-live="off"
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          <ol className="live-step-list">
            {shown.map((s) => (
              <li key={`${s.session_id}:${s.n}`} className="live-step small">
                <time dateTime={s.at}>{formatTime(s.at)}</time>
                <span className="live-step-kind">
                  {STEP_KIND_TEXT[s.kind] ?? t("agents.sessions.steps.kind.other")}
                </span>
                {detail.sessions.length > 1 && agentOf.has(s.session_id) && (
                  <span className="muted">{agentOf.get(s.session_id)}</span>
                )}
                <span className="memory-text">{s.tool}</span>
                <code className="break">{s.target}</code>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function DiffLinks({ kind, links }: { kind: "commit" | "ci_run"; links: DiffLink[] }) {
  const t = useT();
  return (
    <>
      {links.map((l) => (
        <li key={`${kind}:${l.repo}:${l.ref}`} className="small memory-text">
          {t.rich(
            kind === "commit"
              ? "agents.sessions.diff.appearedCommit"
              : "agents.sessions.diff.appearedCi",
            {
              ref: <code className="break">{l.ref}</code>,
              repo: l.repo,
            },
          )}
          {l.conclusion && ` (${l.conclusion})`}
          <span className="muted"> · {CONFIDENCE_TEXT[l.confidence] ?? l.confidence}</span>
        </li>
      ))}
    </>
  );
}

function DiffView({ path, diff, onClose }: { path: string; diff: LiveDiff; onClose: () => void }) {
  const t = useT();
  const hasLinks = diff.commits.length + diff.ci_runs.length > 0;
  return (
    <div className="live-diff">
      <h3 className="h4 memory-text">{t("agents.sessions.diff.title", { path })}</h3>
      <p className="muted small">{t("agents.sessions.diff.source", { source: diff.source })}</p>
      {diff.diff === "" ? (
        <p className="muted small">{t("agents.sessions.diff.empty")}</p>
      ) : (
        <pre
          className="agent-output"
          tabIndex={0}
          aria-label={t("agents.sessions.diff.ariaLabel", { path })}
        >
          {diff.diff}
        </pre>
      )}
      {diff.redacted && (
        <p className="small" role="status">
          {t("agents.sessions.diff.redacted")}
        </p>
      )}
      {diff.truncated && (
        <p className="small" role="status">
          {t("agents.sessions.diff.truncated")}
        </p>
      )}
      {hasLinks && (
        <>
          <p className="muted small">{t("agents.sessions.diff.linksNote")}</p>
          <ul className="task-list" aria-label={t("agents.sessions.diff.linksLabel")}>
            <DiffLinks kind="commit" links={diff.commits} />
            <DiffLinks kind="ci_run" links={diff.ci_runs} />
          </ul>
        </>
      )}
      <div className="button-row wrap">
        <button type="button" className="btn" onClick={onClose}>
          {t("common.button.close")}
        </button>
      </div>
    </div>
  );
}

function FilesChanged({ files }: { files: LiveFileOf[] }) {
  const t = useT();
  const id = useId();
  const { run, busy, error } = useAction();
  const [open, setOpen] = useState<{ path: string; diff: LiveDiff } | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());

  const show = async (file: LiveFileOf) => {
    setOpen(null);
    const diff = await run<LiveDiff>(
      "GET",
      `/api/agent/sessions/${encodeURIComponent(file.session_id)}/diff/${encodeURIComponent(file.path)}`,
    );
    if (diff) setOpen({ path: file.path, diff });
  };
  const close = () => {
    const path = open?.path;
    setOpen(null);
    if (path !== undefined) openers.current.get(path)?.focus();
  };

  return (
    <section aria-labelledby={`${id}-h`} className="card">
      <h2 id={`${id}-h`} className="h3">
        {t("agents.sessions.files.title")}
      </h2>
      {files.length === 0 ? (
        <p className="muted small">{t("agents.sessions.files.empty")}</p>
      ) : (
        <ul className="task-list" aria-label={t("agents.sessions.files.title")}>
          {files.map((f) => (
            <li key={`${f.session_id}:${f.path}`} className="live-file small">
              <code className="break">{f.path}</code>
              <span
                className="live-counts"
                role="img"
                aria-label={t("agents.sessions.files.counts", {
                  added: t("agents.sessions.files.added", { count: f.added }),
                  removed: formatNumber(f.removed),
                })}
              >
                +{formatNumber(f.added)} −{formatNumber(f.removed)}
              </span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                aria-label={t("agents.sessions.files.openDiffLabel", { path: f.path })}
                ref={(el) => {
                  if (el) openers.current.set(f.path, el);
                  else openers.current.delete(f.path);
                }}
                onClick={() => void show(f)}
              >
                {t("agents.sessions.files.openDiff")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && (
        <p className="muted small" role="status">
          {t("agents.sessions.files.loadingDiff")}
        </p>
      )}
      <Feedback error={error} />
      {open && <DiffView path={open.path} diff={open.diff} onClose={close} />}
    </section>
  );
}

function LiveActions({ sessionId, showApprovals }: { sessionId: string; showApprovals: boolean }) {
  const t = useT();
  const id = useId();
  const client = useClient();
  const focus = useAction();
  const [focused, setFocused] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const exporting = useRef(false);

  const jump = async () => {
    setFocused(false);
    const res = await focus.run<{ focused?: boolean }>(
      "POST",
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/focus-terminal`,
      {},
    );
    setFocused(res !== undefined);
  };

  const exportMarkdown = async () => {
    if (exporting.current) return;
    exporting.current = true;
    setExportBusy(true);
    setExportError(null);
    setExported(false);
    try {
      const text = await client.requestText(
        "GET",
        `/api/agent/sessions/${encodeURIComponent(sessionId)}/export.md`,
      );
      const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = `session-${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      setExported(true);
    } catch (err) {
      setExportError(
        err instanceof ApiError ? err.message : t("agents.sessions.actions.exportFailed"),
      );
    } finally {
      exporting.current = false;
      setExportBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-h`} className="card">
      <h2 id={`${id}-h`} className="h3">
        {t("agents.sessions.actions.title")}
      </h2>
      <div className="button-row wrap">
        <button type="button" className="btn" disabled={focus.busy} onClick={() => void jump()}>
          {t("agents.sessions.actions.jump")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={exportBusy}
          onClick={() => void exportMarkdown()}
        >
          {t("agents.sessions.actions.export")}
        </button>
      </div>
      {focus.busy && (
        <>
          <p className="small" role="status">
            {t("agents.sessions.waitingApproval")}
          </p>
          {!showApprovals && <Approvals />}
        </>
      )}
      {focused && (
        <p className="small" role="status">
          {t("agents.sessions.actions.focused")}
        </p>
      )}
      <Feedback error={focus.error} />
      {exported && (
        <p className="small" role="status">
          {t("agents.sessions.actions.exported")}
        </p>
      )}
      <Feedback error={exportError} />
    </section>
  );
}

/** The live sections of one page: steps, files, usage and the two actions. Nothing before Core answers. */
function LiveActivity({
  sessionId,
  data,
  showApprovals = false,
}: {
  sessionId: string;
  data: LiveSessionDetail | null;
  showApprovals?: boolean;
}) {
  if (!data) return null;
  return (
    <>
      <StepsLog detail={data} />
      <FilesChanged files={data.files} />
      <LiveActions sessionId={sessionId} showApprovals={showApprovals} />
      <UsageMeters />
    </>
  );
}

/** A coding agent Phoenix did not start: seen only through its own hooks. Works without the `agents` capability. */
function LiveSessionPage({ sessionId }: { sessionId: string }) {
  const t = useT();
  const { data, error } = useAgentLive(sessionId);
  return (
    <div className="meetings agent-sessions">
      <p>
        <a href="#/agents">{t("agents.sessions.backAll")}</a>
      </p>
      <h1 className="memory-text">{t("agents.sessions.livePage.title", { id: sessionId })}</h1>
      {!data && error && (
        <p role="alert">
          {error} <a href="#/agents">{t("agents.sessions.all")}</a>
        </p>
      )}
      {!data && !error && <p className="muted">{t("common.status.loading")}</p>}
      {data && (
        <>
          {data.sessions.length === 0 ? (
            <p className="muted small">{t("agents.sessions.livePage.noMatch")}</p>
          ) : (
            <ul className="card-list" aria-label={t("agents.sessions.livePage.listLabel")}>
              {data.sessions.map((s) => (
                <li key={s.id} className="card">
                  <p>
                    {t.rich("agents.sessions.inRepository", {
                      agent: <strong className="memory-text">{agentName(s.agent)}</strong>,
                      repository: <span className="memory-text">{s.repository}</span>,
                    })}{" "}
                    · {s.active ? t("agents.sessions.active") : t("agents.sessions.ended")}
                  </p>
                  <p className="muted small memory-text">
                    {t.rich("agents.sessions.livePage.facts", {
                      project: <code className="break">{s.project}</code>,
                      first: <time dateTime={s.first_seen}>{formatDate(s.first_seen)}</time>,
                      ago: formatAgo(s.last_seen),
                      count: s.step_count,
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <LiveActivity sessionId={sessionId} data={data} showApprovals />
        </>
      )}
      <Approvals />
    </div>
  );
}

const ORCHESTRATED_ID = /^ph-[0-9a-f]{16}$/;

export function AgentSessionDetail({ sessionId }: { sessionId: string }) {
  return ORCHESTRATED_ID.test(sessionId) ? (
    <OrchestratedSessionPage sessionId={sessionId} />
  ) : (
    <LiveSessionPage sessionId={sessionId} />
  );
}
