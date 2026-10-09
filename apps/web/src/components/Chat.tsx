// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_MAX_CHARS, type CiTaskInput, type ChatItem } from "../core/chat-store";
import { useChat } from "../core/chat";
import { useDisplayedState } from "../core/context";
import { useAgentSettings } from "../core/hooks";
import { AnswerView } from "./AnswerView";
import { CurrentTask, TaskCard } from "./TaskView";

const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/** Returns the parsed task input, or what is wrong with the two fields in plain words. */
export function parseCiForm(repository: string, runId: string): CiTaskInput | string {
  const repo = repository.trim();
  if (!REPOSITORY.test(repo))
    return 'Enter the repository as "owner/name", for example "acme/app".';
  const id = runId.trim();
  if (id === "") return { repository: repo };
  if (!/^[0-9]{1,15}$/.test(id) || Number(id) < 1) {
    return "The run id must be a positive whole number, or left empty for the latest failed run.";
  }
  return { repository: repo, runId: Number(id) };
}

function CiTaskForm({
  onStart,
  onClose,
}: {
  onStart: (input: CiTaskInput) => Promise<string | null>;
  onClose: () => void;
}) {
  const [repository, setRepository] = useState("");
  const [runId, setRunId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const repoId = useId();
  const runIdId = useId();
  const repoRef = useRef<HTMLInputElement>(null);
  useEffect(() => repoRef.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseCiForm(repository, runId);
    if (typeof parsed === "string") return setProblem(parsed);
    setBusy(true);
    const failure = await onStart(parsed);
    setBusy(false);
    if (failure) setProblem(failure);
    else onClose();
  };

  return (
    <form
      className="memory-form card"
      aria-label="Diagnose a CI failure"
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}
    >
      <p className="small">
        Fawkes will read the failed GitHub Actions run and your local git history. It changes
        nothing.
      </p>
      <label htmlFor={repoId} className="small">
        Repository (owner/name)
      </label>
      <input
        id={repoId}
        ref={repoRef}
        type="text"
        value={repository}
        maxLength={140}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem !== null}
        onChange={(e) => setRepository(e.target.value)}
      />
      <label htmlFor={runIdId} className="small">
        Run id (optional; empty means the latest failed run)
      </label>
      <input
        id={runIdId}
        type="text"
        inputMode="numeric"
        value={runId}
        maxLength={15}
        autoComplete="off"
        onChange={(e) => setRunId(e.target.value)}
      />
      {problem && (
        <p className="error-text small" role="alert">
          {problem}
        </p>
      )}
      <div className="button-row wrap">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Start diagnosis
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Message({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <li className="chat-msg chat-user">
          <p className="chat-who small">You</p>
          <p className="memory-text">{item.text}</p>
        </li>
      );
    case "answer":
      return (
        <li className="chat-msg chat-fawkes">
          <p className="chat-who small">Fawkes</p>
          <AnswerView answer={item.answer} />
        </li>
      );
    case "error":
      return (
        <li className="chat-msg chat-fawkes">
          <p className="chat-who small">Fawkes</p>
          <p className="error-text memory-text" role="alert">
            {item.text}
          </p>
        </li>
      );
    case "task":
      return (
        <li className="chat-msg chat-fawkes">
          <p className="chat-who small">Fawkes</p>
          <TaskCard taskId={item.taskId} title={item.title} />
        </li>
      );
  }
}

/** Pet Panel "Chat" tab (Phase 32): ask Fawkes about what it remembers, and start a CI diagnosis. */
export function Chat() {
  const { chat, store } = useChat();
  const state = useDisplayedState();
  const { data: agents } = useAgentSettings();
  const [formOpen, setFormOpen] = useState(false);
  const log = useRef<HTMLUListElement>(null);
  const id = useId();
  const visual = visualFor(state.state);

  // Unmounting a focused box fires no blur, and LISTENING must not outlive the box.
  useEffect(() => () => store.setFocused(false), [store]);

  // Keep the newest message in view; the log is the only thing that scrolls.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.items.length]);

  const send = () => void store.ask(chat.draft);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a newline. Never while an IME is composing a character.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const taskIds = chat.items.flatMap((i) => (i.kind === "task" ? [i.taskId] : []));
  const empty = chat.draft.trim().length === 0;

  return (
    <div className="chat">
      <p className="small">
        <strong>Fawkes is {visual.label.toLowerCase()}.</strong> {state.explanation}
      </p>
      <p className="muted small">
        Ask what Fawkes remembers. Answers list stored facts with their sources first; anything
        generated is labelled. This conversation is kept in this page only and is gone when you
        reload.
      </p>
      {chat.items.length === 0 ? (
        <p className="muted small">No messages yet.</p>
      ) : (
        <ul className="chat-log" aria-label="Conversation" ref={log} tabIndex={0}>
          {chat.items.map((item) => (
            <Message key={item.id} item={item} />
          ))}
        </ul>
      )}
      {chat.asking && (
        <p className="small" role="status">
          Waiting for Phoenix Core to answer…
        </p>
      )}
      <form
        className="memory-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor={`${id}-msg`} className="small">
          Message to Fawkes
        </label>
        <textarea
          id={`${id}-msg`}
          rows={3}
          value={chat.draft}
          maxLength={CHAT_MAX_CHARS}
          aria-describedby={`${id}-count`}
          onChange={(e) => store.setDraft(e.target.value)}
          onFocus={() => store.setFocused(true)}
          onBlur={() => store.setFocused(false)}
          onKeyDown={onKey}
        />
        <p id={`${id}-count`} className="muted small">
          {chat.draft.length} / {CHAT_MAX_CHARS} characters · Enter sends, Shift+Enter starts a new
          line
        </p>
        <div className="button-row wrap">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={chat.asking || empty}
            aria-disabled={chat.asking || empty}
          >
            {chat.asking ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            className="btn"
            aria-expanded={formOpen}
            onClick={() => {
              setFormOpen(!formOpen);
            }}
          >
            Diagnose a CI failure
          </button>
        </div>
      </form>
      {agents && !agents.enabled && (
        <p className="warning-text small" role="note">
          Automation is off, so Fawkes cannot start tasks. Turn it on in Settings, under Automation.
        </p>
      )}
      {formOpen && (
        <CiTaskForm
          onStart={(input) => store.startCiTask(input)}
          onClose={() => setFormOpen(false)}
        />
      )}
      <CurrentTask exclude={taskIds} />
    </div>
  );
}
