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
  SESSION_STATE_TEXT,
  validateStart,
  type StartProblems,
} from "../core/agent-sessions";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { formatAgo, formatDate, formatTime } from "../core/format";
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
import { Approvals } from "./Approvals";
import { Feedback } from "./Feedback";

const STEP_KIND_TEXT: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  run: "Run",
  other: "Other",
};
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
  return (
    <>
      {(state === "waiting" || state === "running") && (
        <>
          <p className="small" role="status">
            {state === "waiting" ? waiting : "Running…"}
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
      message = "Use a launcher name of 1–40 slug characters.";
    else if (!Object.hasOwn(savedLaunchers, name) && names.length >= 8)
      message = "At most eight launchers are allowed.";
    else if (
      argv.length < 1 ||
      argv.length > 32 ||
      argv.some((a) => !a.length || a.length > 1000 || /[\u0000-\u001f\u007f]/.test(a)) ||
      !clean(argv[0]!) ||
      argv[0]!.endsWith("/") ||
      /^(sh|bash|zsh|dash|fish|ksh|csh|tcsh)$/.test(argv[0]!.split("/").at(-1) ?? "")
    )
      message =
        "Enter an absolute executable (not a shell) and up to 31 fixed arguments, one per line (1000 characters each).";
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
      message = "Enter 1–8 normalised absolute folders (not /), one per line.";
    else if (
      allowed.length > 16 ||
      allowed.some((n) => !/^[A-Z_][A-Z0-9_]{0,63}$/.test(n) || n.startsWith("PHOENIX_"))
    )
      message = "Enter at most 16 valid environment variable names (not PHOENIX_ names).";
    else if (
      prompts.length > 8 ||
      prompts.some((p) => !p.length || p.length > 100 || /[\u0000-\u001f\u007f]/.test(p))
    )
      message = "Enter at most eight waiting phrases, each at most 100 characters.";
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
    <section className="card" aria-label="Configure coding-agent launcher">
      <h2 className="h3">Configure a launcher</h2>
      <p className="muted small">
        Only configure programs you trust. Phoenix passes prompts on stdin. Never put credentials in
        arguments; use environment variable names, never values.
      </p>
      <form onSubmit={review} className="settings-form">
        <label className="field" htmlFor={`${id}-existing`}>
          Edit a saved launcher
          <select
            id={`${id}-existing`}
            value={Object.hasOwn(savedLaunchers, name) ? name : ""}
            onChange={(e) => select(e.target.value)}
          >
            <option value="">New launcher</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Launcher name
          <input
            value={name}
            onChange={(e) => {
              change();
              setName(e.target.value);
            }}
          />
        </label>
        <label className="field">
          Executable absolute path, then fixed arguments (one per line)
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
          Allowed absolute workspace folders (one per line)
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
          Environment variable names (optional, one per line; no values)
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
          Waiting phrases (optional, one per line)
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
          Input mode
          <select
            value={stdin}
            onChange={(e) => {
              change();
              setStdin(e.target.value as "keep_open" | "close_after_prompt");
            }}
          >
            <option value="keep_open">Keep input open for messages</option>
            <option value="close_after_prompt">Close after first prompt</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Review launcher configuration…
        </button>
      </form>
      {problem && (
        <p role="alert" className="error-text">
          {problem}
        </p>
      )}
      {preview && (
        <div role="group" aria-label="Launcher configuration preview">
          <p>
            Save launcher <strong>{name}</strong> with executable <code>{lines(command)[0]}</code>,{" "}
            {lines(command).length - 1} fixed arguments (not shown), and allowed folders:{" "}
            {lines(roots).join(", ")}. Input mode:{" "}
            {stdin === "keep_open" ? "messages allowed" : "close after prompt"}.
          </p>
          <p className="muted small">
            Environment variable names, fixed arguments and waiting phrases are not shown here.
            Saving does not start an agent.{" "}
            {enabled
              ? "Saved changes require disabling and re-enabling agents in Settings. That stops running sessions; wait until they finish or explicitly approve stopping them."
              : "Enable agents in Settings to apply saved changes."}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            Save launcher configuration
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setPreview(false)}>
            Back to edit
          </button>
        </div>
      )}
      {saved && (
        <p role="status">
          Saved.{" "}
          {enabled
            ? "This launcher is not active until agents is disabled and re-enabled; active sessions are not interrupted."
            : "Enable agents to use this launcher."}
        </p>
      )}
      <Feedback error={error} />
    </section>
  );
}

function StartSession({ launchers }: { launchers: Record<string, AgentLauncher> }) {
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
        Start a coding agent
      </h2>
      {!reviewing ? (
        <form className="start-meeting" onSubmit={review} noValidate>
          <div className="field">
            <label htmlFor={`${id}-launcher`}>Launcher</label>
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
            <label htmlFor={`${id}-ws`}>Workspace (absolute folder path)</label>
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
              What should it do?{" "}
              <span className="muted small">(up to {MAX_PROMPT_CHARS} characters)</span>
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
            Review before starting…
          </button>
        </form>
      ) : (
        <div className="start-preview" role="group" aria-labelledby={`${id}-preview-h`}>
          <h3 id={`${id}-preview-h`} className="h4">
            Check this before you start
          </h3>
          <dl className="approval-facts small">
            <dt>Launcher</dt>
            <dd className="memory-text">{launcher}</dd>
            <dt>It will run</dt>
            <dd className="memory-text">
              <code>{spec?.command[0] ?? "unknown"}</code> (
              {Math.max(0, (spec?.command.length ?? 1) - 1)} fixed arguments; values hidden)
            </dd>
            <dt>Workspace</dt>
            <dd className="memory-text">
              <code>{workspace.trim()}</code>
            </dd>
            <dt>Folders this launcher may use</dt>
            <dd className="memory-text">
              {spec && spec.cwd_roots.length > 0 ? spec.cwd_roots.join(", ") : "none listed"}
            </dd>
            <dt>Prompt</dt>
            <dd className="memory-text">
              {prompt.length} characters, sent to the agent on its input (never in its arguments).
            </dd>
          </dl>
          <p className="muted small">
            Core asks for approval of <strong>agents: session.start</strong>, which runs a program
            on your computer. Nothing starts before you approve this named action.
          </p>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={start.busy || start.state === "succeeded"}
              onClick={confirm}
            >
              Start the session…
            </button>
            <button type="button" className="btn" disabled={start.busy} onClick={cancel}>
              {start.state === "succeeded" ? "Done" : "Back"}
            </button>
          </div>
          <CommandStatus
            state={start.state}
            error={start.error}
            waiting="Waiting for your approval below."
            done={start.result ? `Started session ${start.result.id}.` : "Started."}
          />
          {start.result && (
            <p className="small">
              <a href={sessionHref(start.result.id)}>Open the session</a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function SessionRow({ session }: { session: OrchestratedSession }) {
  return (
    <li className="card meeting-row">
      <a href={sessionHref(session.id)}>
        <strong>{session.launcher}</strong> in {session.repository}
      </a>
      <span className={session.state === "waiting" ? "agent-waiting" : "small"}>
        {SESSION_STATE_TEXT[session.state]}
      </span>
      <span className="muted small memory-text">
        {session.id} · started {formatAgo(session.started_at)}
      </span>
    </li>
  );
}

/** One ambiguous link, with a button per candidate session. Resolving asks for approval. */
function AmbiguousLink({ link, onResolved }: { link: AgentLink; onResolved: () => void }) {
  const resolve = useCommandAction<AgentLink>("agents", "link.resolve");
  useEffect(() => {
    if (resolve.state === "succeeded") onResolved();
  }, [resolve.state, onResolved]);
  return (
    <li className="card">
      <p className="memory-text">
        {LINK_KIND_TEXT[link.kind] ?? link.kind} <code className="break">{link.ref}</code> in{" "}
        {link.repo}: {CONFIDENCE_TEXT.ambiguous}.
      </p>
      <p className="muted small">
        Phoenix linked it to none of them. Pick the session it belongs to, or leave it.
      </p>
      <div className="button-row wrap">
        {(link.candidates ?? []).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className="btn"
            disabled={resolve.busy}
            aria-label={`Link ${LINK_KIND_TEXT[link.kind] ?? link.kind} ${link.ref} to session ${candidate}`}
            onClick={() => void resolve.submit({ link_id: link.id, session_id: candidate })}
          >
            It belongs to {candidate}
          </button>
        ))}
      </div>
      <CommandStatus
        state={resolve.state}
        error={resolve.error}
        waiting="Waiting for your approval below."
        done="Link saved."
      />
    </li>
  );
}

/** Coding agents Phoenix did not start, seen through their hooks. Hidden when there are none. */
function LiveSessionsList() {
  const { sessions, error } = useAgentLiveSessions();
  if (error || sessions.length === 0) return null;
  return (
    <section aria-labelledby="live-sessions-h">
      <h2 id="live-sessions-h" className="h3">
        Live sessions
      </h2>
      <p className="muted small">
        Coding agents running on this computer that report to Phoenix, however they were started.
      </p>
      <ul className="card-list" aria-label="Live sessions">
        {sessions.map((s) => (
          <li key={s.id} className="card meeting-row">
            <a href={sessionHref(s.id)}>
              <strong>{agentName(s.agent)}</strong> in {s.repository}
            </a>
            <span className="small">{s.active ? "Active" : "Ended"}</span>
            <span className="muted small memory-text">
              {s.step_count} step(s) · last seen {formatAgo(s.last_seen)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgentSessionsPage() {
  const { agents, enabled, launchers, reload: reloadCapabilities } = useAgentsAvailability();
  const { data, error, reload } = useCommandResult<OrchestratedSessionList>(
    "agents",
    "session.list",
    enabled,
    (t) => t.startsWith("agent."),
  );
  const sessions = data?.sessions ?? [];
  const ambiguous = data?.ambiguous_links ?? [];

  return (
    <div className="meetings agent-sessions">
      <h1>Coding agents</h1>
      <p className="muted">
        Start a coding agent you set up, follow what it does and what it leads to. Every start,
        message and stop asks for your approval first.
      </p>
      {!enabled ? (
        <p role="status">
          The coding-agents capability is off. Turn on <strong>agents</strong> under Capabilities in
          the Pet Panel to use this page.
        </p>
      ) : !launchers ? (
        <p role="status">Loading active launchers…</p>
      ) : Object.keys(launchers).length === 0 ? (
        <p role="status">
          No active launcher is set up, so Phoenix cannot start an agent. Save a launcher below,
          then enable or restart agents in Settings after active sessions have finished.
        </p>
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
              Sessions
            </h2>
            {data && sessions.length === 0 && (
              <p className="muted">No session has been started since Phoenix launched.</p>
            )}
            <ul className="card-list" aria-label="Sessions">
              {sessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </ul>
          </section>
          {ambiguous.length > 0 && (
            <section aria-labelledby="ambiguous-h">
              <h2 id="ambiguous-h" className="h3">
                Waiting for you to choose ({ambiguous.length})
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
    return <p className="muted small">This session does not take messages: its input is closed.</p>;
  }
  return (
    <form className="memory-form" onSubmit={submit}>
      <label htmlFor={id} className="small">
        Message to the agent <span className="muted">(up to {MAX_MESSAGE_CHARS} characters)</span>
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
        Send message…
      </button>
      <CommandStatus
        state={send.state}
        error={send.error}
        waiting="Waiting for your approval below."
        done="Message sent."
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
        Give the agent notes from Phoenix memory. What do you want it to know?
      </label>
      <input
        id={id}
        type="text"
        value={question}
        maxLength={MAX_QUESTION_CHARS}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <p className="muted small">
        Only notes about this session's own repository and folder, nothing sensitive and no meeting
        content, are sent, as quoted data.
      </p>
      <button
        type="submit"
        className="btn"
        disabled={handoff.busy || !running || !question.trim() || !accepts}
      >
        Hand over notes…
      </button>
      <CommandStatus
        state={handoff.state}
        error={handoff.error}
        waiting="Waiting for your approval below."
        done={
          handoff.result
            ? handoff.result.sent
              ? `Sent ${handoff.result.count} note(s) to the agent.`
              : "Nothing in memory was allowed or relevant, so nothing was sent."
            : "Done."
        }
      />
    </form>
  );
}

function StopSession({ sessionId, running }: { sessionId: string; running: boolean }) {
  const stop = useCommandAction("agents", "session.stop");
  return (
    <div>
      <button
        type="button"
        className="btn btn-danger-outline"
        disabled={stop.busy || !running}
        onClick={() => void stop.submit({ session_id: sessionId })}
      >
        Stop the session…
      </button>
      <p className="muted small">
        Stops the agent and every program it started. You are asked to approve first.
      </p>
      <CommandStatus
        state={stop.state}
        error={stop.error}
        waiting="Waiting for your approval below."
        done="The session was stopped."
      />
    </div>
  );
}

function Links({ links }: { links: AgentLink[] }) {
  return (
    <section aria-labelledby="links-h" className="card">
      <h2 id="links-h" className="h3">
        What happened during this session
      </h2>
      <p className="muted small">
        These happened while the session was active. That does not prove the agent made them.
      </p>
      {links.length === 0 ? (
        <p className="muted small">No commit, CI run or pull request is linked yet.</p>
      ) : (
        <ul className="task-list" aria-label="Linked work">
          {links.map((l) => (
            <li key={l.id}>
              {LINK_KIND_TEXT[l.kind] ?? l.kind} <code className="break">{l.ref}</code> in {l.repo}
              <span className="muted small">
                {" "}
                · {CONFIDENCE_TEXT[l.confidence] ?? l.confidence}
              </span>
              {typeof l.why.rule === "string" && (
                <span className="muted small memory-text"> · rule: {l.why.rule}</span>
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
  return (
    <div>
      <h3 className="h4">{label}</h3>
      {lines.length === 0 ? (
        <p className="muted small">Nothing yet.</p>
      ) : (
        <pre className="agent-output" tabIndex={0} aria-label={`${label} (plain text, scrolls)`}>
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
  const { enabled } = useAgentsAvailability();
  // Live steps of the agents that ran in this session's workspace while it was active.
  const live = useAgentLive(sessionId).data;
  const { data, error, reload } = useCommandResult<OrchestratedSessionDetail>(
    "agents",
    "session.get",
    enabled,
    (t) => t.startsWith("agent."),
    { session_id: sessionId, output_lines: OUTPUT_LINES },
  );
  const [announced, setAnnounced] = useState(false);
  useEffect(() => setAnnounced(data !== null), [data]);

  if (!enabled) {
    return (
      <div className="meetings">
        <p role="status">
          The coding-agents capability is off. <a href="#/agents">Back to sessions</a>
        </p>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="meetings">
        <p role="alert">
          {error} <a href="#/agents">All sessions</a>
        </p>
      </div>
    );
  }
  if (!data) return <p className="muted">Loading…</p>;

  const { session } = data;
  const running = session?.state === "running" || session?.state === "waiting";
  const timeline = mergeTimeline(data.timeline, live?.steps ?? []);

  return (
    <div className="meetings agent-sessions">
      <p>
        <a href="#/agents">← All sessions</a>
      </p>
      <h1 className="memory-text">Session {sessionId}</h1>
      {!session ? (
        <p className="muted">
          This session is no longer in memory (Phoenix keeps the last 20 finished sessions). What
          was linked to it is below.
        </p>
      ) : (
        <section aria-labelledby="session-h" className="card">
          <h2 id="session-h" className="h3">
            {session.launcher} in {session.repository}
          </h2>
          <p className={session.state === "waiting" ? "agent-waiting" : ""}>
            <strong>{SESSION_STATE_TEXT[session.state]}</strong>
            {session.stop_reason && <> · stopped because: {session.stop_reason}</>}
            {session.failure && <> · {session.failure}</>}
            {session.exit_code !== undefined && session.exit_code !== null && (
              <> · exit code {session.exit_code}</>
            )}
          </p>
          <p className="muted small memory-text">
            Workspace <code>{session.workspace}</code> · started{" "}
            <time dateTime={session.started_at}>{formatDate(session.started_at)}</time> ·{" "}
            {session.messages_sent} message(s) sent
          </p>
          <div className="button-row wrap">
            <button type="button" className="btn" onClick={() => void reload()}>
              Refresh
            </button>
          </div>
        </section>
      )}
      {announced && (
        <p className="sr-only" role="status">
          Session loaded.
        </p>
      )}

      {session && (
        <section aria-labelledby="output-h" className="card">
          <h2 id="output-h" className="h3">
            What the agent printed
          </h2>
          <p className="muted small">
            Plain text from the agent, last {OUTPUT_LINES} lines, with secrets and control
            characters removed. Phoenix never runs or follows anything in it.
          </p>
          <Output lines={data.output?.stdout ?? []} label="Output" />
          <Output lines={data.output?.stderr ?? []} label="Errors" />
        </section>
      )}

      <section aria-labelledby="timeline-h" className="card">
        <h2 id="timeline-h" className="h3">
          Timeline
        </h2>
        {timeline.length === 0 ? (
          <p className="muted small">Nothing recorded.</p>
        ) : (
          <ol className="timeline" aria-label="Timeline">
            {timeline.map((t) => (
              <li key={t.key} className="small memory-text">
                <time dateTime={t.at}>{new Date(t.at).toLocaleTimeString()}</time> · {t.kind}
                {t.detail &&
                  ` · ${Object.entries(t.detail)
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
            Waiting for you to choose ({data.ambiguous.length})
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
            Talk to the agent
          </h2>
          {!running && (
            <p className="muted small">
              This session is over, so it cannot be messaged or stopped.
            </p>
          )}
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
const WINDOW_TEXT: Record<UsageView["window"], string> = { "5h": "5-hour", weekly: "weekly" };

/** "2h 10m", "45m", "3d 4h": coarse on purpose, the reset time is not exact to the second. */
function formatResetIn(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "resets now";
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `resets in ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `resets in ${h}h ${min % 60}m`;
  return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Plan usage per agent window, with a text for every state (colour is never the only signal). */
function UsageMeters() {
  const { usage, unsupported } = useAgentUsage();
  const id = useId();
  if (usage.length === 0 && unsupported.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-labelledby={`${id}-h`} className="card">
      <h2 id={`${id}-h`} className="h3">
        Plan usage
      </h2>
      <ul className="task-list" aria-label="Plan usage">
        {usage.map((u) => {
          const pct = Math.min(100, Math.max(0, Math.round(u.used_pct)));
          const window = WINDOW_TEXT[u.window] ?? u.window;
          const reset = formatResetIn(u.resets_at, now);
          return (
            <li key={`${u.agent}:${u.window}`} className={`usage usage-${u.level}`}>
              <div
                className="usage-meter"
                role="meter"
                aria-label={`${agentName(u.agent)} ${window} plan usage`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-valuetext={`${pct}% used`}
              >
                <div className="usage-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="small memory-text">
                <strong>{agentName(u.agent)}</strong>: {pct}% of the {window} window used
                {reset && ` · ${reset}`}
              </p>
              {u.level !== "ok" && (
                <p className="small usage-note">
                  {u.level === "critical" ? "Almost at the limit" : "Approaching the limit"}
                </p>
              )}
              {u.stale && (
                <p className="muted small">
                  This reading may be out of date (last seen{" "}
                  <time dateTime={u.observed_at}>{formatAgo(u.observed_at)}</time>).
                </p>
              )}
              {typeof u.reset_credits === "number" && (
                <p className="muted small">{u.reset_credits} free resets left</p>
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
        Steps
      </h2>
      {detail.sessions.length === 0 && shown.length === 0 && (
        <p className="muted small">
          No live agent session has been seen for this page yet. Steps appear here while a coding
          agent works in this folder.
        </p>
      )}
      {detail.sessions.length > 0 && shown.length === 0 && (
        <p className="muted small">No steps have been seen yet.</p>
      )}
      {detail.dropped_steps > 0 && (
        <p className="muted small">
          {detail.dropped_steps} earlier step(s) are not kept, so the list starts later than the
          session did.
        </p>
      )}
      {detail.steps.length > shown.length && (
        <p className="muted small">
          Showing the last {shown.length} of {detail.steps.length} steps.
        </p>
      )}
      {shown.length > 0 && (
        <div
          ref={log}
          className="live-steps"
          role="log"
          aria-label="Steps"
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
                <span className="live-step-kind">{STEP_KIND_TEXT[s.kind] ?? "Other"}</span>
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

function DiffLinks({ title, links }: { title: string; links: DiffLink[] }) {
  return (
    <>
      {links.map((l) => (
        <li key={`${title}:${l.repo}:${l.ref}`} className="small memory-text">
          Appeared in {title} <code className="break">{l.ref}</code> in {l.repo}
          {l.conclusion && ` (${l.conclusion})`}
          <span className="muted"> · {CONFIDENCE_TEXT[l.confidence] ?? l.confidence}</span>
        </li>
      ))}
    </>
  );
}

function DiffView({ path, diff, onClose }: { path: string; diff: LiveDiff; onClose: () => void }) {
  const hasLinks = diff.commits.length + diff.ci_runs.length > 0;
  return (
    <div className="live-diff">
      <h3 className="h4 memory-text">Diff of {path}</h3>
      <p className="muted small">Source: {diff.source}. Plain text; nothing in it is run.</p>
      {diff.diff === "" ? (
        <p className="muted small">There is nothing to show for this file.</p>
      ) : (
        <pre
          className="agent-output"
          tabIndex={0}
          aria-label={`Diff of ${path} (plain text, scrolls)`}
        >
          {diff.diff}
        </pre>
      )}
      {diff.truncated && (
        <p className="small" role="status">
          This diff was truncated: only the first part is shown.
        </p>
      )}
      {hasLinks && (
        <>
          <p className="muted small">
            These links come from what Phoenix saved for this session (time and folder). They do not
            prove the agent made them.
          </p>
          <ul className="task-list" aria-label="Where this file appeared">
            <DiffLinks title="commit" links={diff.commits} />
            <DiffLinks title="CI run" links={diff.ci_runs} />
          </ul>
        </>
      )}
      <div className="button-row wrap">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function FilesChanged({ files }: { files: LiveFileOf[] }) {
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
        Files changed
      </h2>
      {files.length === 0 ? (
        <p className="muted small">No file change has been seen yet.</p>
      ) : (
        <ul className="task-list" aria-label="Files changed">
          {files.map((f) => (
            <li key={`${f.session_id}:${f.path}`} className="live-file small">
              <code className="break">{f.path}</code>
              <span
                className="live-counts"
                role="img"
                aria-label={`${f.added} ${f.added === 1 ? "line" : "lines"} added, ${f.removed} removed`}
              >
                +{f.added} −{f.removed}
              </span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                aria-label={`Open diff of ${f.path}`}
                ref={(el) => {
                  if (el) openers.current.set(f.path, el);
                  else openers.current.delete(f.path);
                }}
                onClick={() => void show(f)}
              >
                Open diff
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && (
        <p className="muted small" role="status">
          Loading the diff…
        </p>
      )}
      <Feedback error={error} />
      {open && <DiffView path={open.path} diff={open.diff} onClose={close} />}
    </section>
  );
}

function LiveActions({ sessionId, showApprovals }: { sessionId: string; showApprovals: boolean }) {
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
      setExportError(err instanceof ApiError ? err.message : "The export failed");
    } finally {
      exporting.current = false;
      setExportBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-h`} className="card">
      <h2 id={`${id}-h`} className="h3">
        Actions
      </h2>
      <div className="button-row wrap">
        <button type="button" className="btn" disabled={focus.busy} onClick={() => void jump()}>
          Jump to terminal
        </button>
        <button
          type="button"
          className="btn"
          disabled={exportBusy}
          onClick={() => void exportMarkdown()}
        >
          Export Markdown
        </button>
      </div>
      {focus.busy && (
        <>
          <p className="small" role="status">
            Waiting for your approval below.
          </p>
          {!showApprovals && <Approvals />}
        </>
      )}
      {focused && (
        <p className="small" role="status">
          Terminal window brought to the front.
        </p>
      )}
      <Feedback error={focus.error} />
      {exported && (
        <p className="small" role="status">
          The Markdown file was saved to your downloads.
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
  const { data, error } = useAgentLive(sessionId);
  return (
    <div className="meetings agent-sessions">
      <p>
        <a href="#/agents">← All sessions</a>
      </p>
      <h1 className="memory-text">Live session {sessionId}</h1>
      {!data && error && (
        <p role="alert">
          {error} <a href="#/agents">All sessions</a>
        </p>
      )}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          {data.sessions.length === 0 ? (
            <p className="muted small">No live session matches this id.</p>
          ) : (
            <ul className="card-list" aria-label="Sessions on this page">
              {data.sessions.map((s) => (
                <li key={s.id} className="card">
                  <p>
                    <strong className="memory-text">{agentName(s.agent)}</strong> in{" "}
                    <span className="memory-text">{s.repository}</span> ·{" "}
                    {s.active ? "Active" : "Ended"}
                  </p>
                  <p className="muted small memory-text">
                    <code className="break">{s.project}</code> · first seen{" "}
                    <time dateTime={s.first_seen}>{formatDate(s.first_seen)}</time>, last seen{" "}
                    {formatAgo(s.last_seen)} · {s.step_count} step(s)
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
