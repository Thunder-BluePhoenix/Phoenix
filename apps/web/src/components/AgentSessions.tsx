// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useId, useState, type FormEvent } from "react";
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
import { formatAgo, formatDate } from "../core/format";
import { useCapabilities, useCommandAction, useCommandResult } from "../core/hooks";
import type {
  AgentLauncher,
  AgentLink,
  OrchestratedSession,
  OrchestratedSessionDetail,
  OrchestratedSessionList,
} from "../core/types";
import { Approvals } from "./Approvals";
import { Feedback } from "./Feedback";

const sessionHref = (id: string) => `#/agents/${encodeURIComponent(id)}`;

/** Why the page cannot be used yet, in words; null when sessions can be started. */
function useAgentsAvailability() {
  const { data: caps } = useCapabilities();
  const agents = caps.find((c) => c.id === "agents");
  const launchers = launchersOf(agents?.config);
  const enabled = agents?.status === "enabled";
  return { agents, enabled, launchers, hasLauncher: Object.keys(launchers).length > 0 };
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
              <code>{spec?.command.join(" ") ?? "unknown"}</code>
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
            Core then asks for your approval, because this runs a program on your computer. Nothing
            starts before you approve.
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

export function AgentSessionsPage() {
  const { enabled, launchers, hasLauncher } = useAgentsAvailability();
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
      ) : !hasLauncher ? (
        <p role="status">
          No launcher is set up, so Phoenix cannot start an agent. Add a launcher in the
          capability's settings (<a href="#/settings">Settings</a>), then turn the capability off
          and on again.
        </p>
      ) : (
        <StartSession launchers={launchers} />
      )}
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

export function AgentSessionDetail({ sessionId }: { sessionId: string }) {
  const { enabled } = useAgentsAvailability();
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
        {data.timeline.length === 0 ? (
          <p className="muted small">Nothing recorded.</p>
        ) : (
          <ol className="timeline" aria-label="Timeline">
            {data.timeline.map((t, i) => (
              <li key={`${t.at}:${i}`} className="small memory-text">
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
