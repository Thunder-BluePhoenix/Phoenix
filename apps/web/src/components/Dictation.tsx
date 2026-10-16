// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../core/client";
import { useClient, useConnection } from "../core/context";
import {
  CLEANUP_MODES,
  CLEANUP_MODE_LABELS,
  formatDuration,
  type CleanupMode,
  type DictationResult,
  type DictationSettings,
  type DictationStarted,
  type DictationStats,
  type DictationStatus,
  type DictationVocabulary,
} from "../core/dictation";
import { createBrowserMicrophone, type DictationMicrophone } from "../core/dictation-mic";
import { useAction } from "../core/hooks";
import { Feedback } from "./Feedback";

const failure = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Request failed";

// ── The "Dictate" button of the chat box ────────────────────────────────────────────────────────

type Phase = "idle" | "starting" | "listening" | "processing";

interface Live {
  id: string;
  socket: WebSocket;
  mic: DictationMicrophone;
  done: boolean;
}

/**
 * Dictate into a text box. The microphone is requested ONLY after the user clicks this button and
 * Core has accepted a session; a visible "Listening" indicator is shown for the whole capture; the
 * audio is sent as PCM frames to Core's session stream and kept nowhere in this page.
 */
export function DictateButton({
  onText,
  createMicrophone = createBrowserMicrophone,
}: {
  onText: (text: string) => void;
  /** Test seam: a fake microphone. Production uses getUserMedia through the browser. */
  createMicrophone?: () => DictationMicrophone;
}) {
  const client = useClient();
  const connection = useConnection();
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const live = useRef<Live | null>(null);
  // The result arrives long after the click: always call the latest handler, not the one captured then.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const hint = useId();

  const refresh = useCallback(async () => {
    try {
      setStatus(await client.request<DictationStatus>("GET", "/api/dictation/status"));
    } catch {
      setStatus(null);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
    return client.statusChanged.on(() => void refresh());
  }, [client, refresh]);

  /** Every way out: the microphone is released first, then the socket, then Core is told. */
  const abandon = useCallback(
    (message: string | null, cancelCore: boolean) => {
      const current = live.current;
      live.current = null;
      if (current) {
        current.done = true;
        current.mic.stop();
        current.socket.close();
        if (cancelCore)
          void client.request("DELETE", `/api/dictation/sessions/${current.id}`).catch(() => {});
      }
      setPhase("idle");
      setError(message);
    },
    [client],
  );
  useEffect(() => () => abandon(null, true), [abandon]);
  useEffect(() => {
    if (connection !== "online" && live.current) abandon("Phoenix Core is not connected.", false);
  }, [connection, abandon]);

  const start = async () => {
    if (live.current) return;
    setError(null);
    setPhase("starting");
    let started: DictationStarted;
    try {
      started = await client.request<DictationStarted>("POST", "/api/dictation/sessions", {});
    } catch (err) {
      setPhase("idle");
      setError(failure(err));
      void refresh();
      return;
    }
    let socket: WebSocket;
    try {
      socket = client.openDictationSocket(started.id);
    } catch (err) {
      void client.request("DELETE", `/api/dictation/sessions/${started.id}`).catch(() => {});
      setPhase("idle");
      setError(failure(err));
      return;
    }
    const mic = createMicrophone();
    const session: Live = { id: started.id, socket, mic, done: false };
    live.current = session;
    socket.onmessage = (event) => {
      if (live.current !== session || typeof event.data !== "string") return;
      let message: { type?: unknown; error?: unknown; reason?: unknown };
      try {
        message = JSON.parse(event.data) as typeof message;
      } catch {
        return abandon("Invalid reply from Core.", true);
      }
      if (message.type === "ready") {
        mic
          .start((pcm) => {
            if (live.current === session && socket.readyState === 1)
              socket.send(pcm.buffer as ArrayBuffer);
          })
          .then(
            () => {
              if (live.current === session) setPhase("listening");
            },
            (err: unknown) => abandon(`Microphone unavailable: ${failure(err)}`, true),
          );
      } else if (message.type === "ended" || message.type === "error") {
        const why =
          typeof message.reason === "string" ? message.reason : String(message.error ?? "");
        abandon(`Dictation stopped${why ? `: ${why.replaceAll("_", " ")}` : ""}.`, false);
        void refresh();
      } else if (message.type === "audio_ended") {
        void finish(session);
      }
    };
    socket.onerror = () => {
      if (live.current === session) abandon("The audio connection failed.", true);
    };
    socket.onclose = () => {
      if (live.current === session && !session.done) abandon("The audio connection closed.", true);
    };
  };

  const finish = async (session: Live) => {
    try {
      const result = await client.request<DictationResult>(
        "POST",
        `/api/dictation/sessions/${session.id}/finish`,
        {},
      );
      if (live.current !== session) return;
      live.current = null;
      session.done = true;
      session.socket.close();
      setPhase("idle");
      if (result.text) onTextRef.current(result.text);
      else setError("Nothing was recognised.");
    } catch (err) {
      if (live.current === session) abandon(failure(err), false);
    } finally {
      void refresh();
    }
  };

  const stop = () => {
    const session = live.current;
    if (!session || phase !== "listening") return;
    setPhase("processing");
    session.mic.stop();
    if (session.socket.readyState === 1) session.socket.send(JSON.stringify({ type: "end" }));
    else void finish(session);
  };

  const blocked = !status
    ? "Dictation status is not available."
    : !status.enabled
      ? "Dictation is off. Turn it on in Settings, under Dictation."
      : status.kill_switch_engaged
        ? "The emergency stop is engaged."
        : !status.recognizer.available
          ? status.recognizer.detail
          : connection !== "online"
            ? "Phoenix Core is not connected."
            : null;

  return (
    <>
      {phase === "idle" || phase === "starting" ? (
        <button
          type="button"
          className="btn"
          disabled={blocked !== null || phase === "starting"}
          aria-describedby={hint}
          onClick={() => void start()}
        >
          {phase === "starting" ? "Starting…" : "Dictate"}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={phase !== "listening"}
            onClick={stop}
          >
            {phase === "processing" ? "Recognising…" : "Stop dictating"}
          </button>
          <button type="button" className="btn" onClick={() => abandon(null, true)}>
            Cancel dictation
          </button>
        </>
      )}
      <span id={hint} className="muted small">
        {blocked ?? "Uses your microphone only while you dictate; audio is not stored."}
      </span>
      {(phase === "listening" || phase === "starting") && (
        <p className="dictation-live small" role="status" data-testid="dictation-indicator">
          <span className="dictation-dot" aria-hidden="true" />
          {phase === "listening"
            ? "Listening: your microphone is on."
            : "Waiting for the microphone permission…"}
        </p>
      )}
      <Feedback error={error} />
    </>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────

const emptyVocabulary: DictationVocabulary = { dictionary: [], replacements: [], snippets: [] };

/** Settings > Dictation: consent, clean-up modes, vocabulary and statistics. Off by default. */
export function DictationSettingsSection() {
  const client = useClient();
  const { run, busy, error } = useAction();
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [settings, setSettings] = useState<DictationSettings | null>(null);
  const [stats, setStats] = useState<DictationStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<DictationVocabulary>(emptyVocabulary);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [st, se, ss] = await Promise.all([
        client.request<DictationStatus>("GET", "/api/dictation/status"),
        client.request<DictationSettings>("GET", "/api/dictation/settings"),
        client.request<DictationStats>("GET", "/api/dictation/stats"),
      ]);
      setStatus(st);
      setSettings(se);
      setStats(ss);
      setVocabulary(se.vocabulary);
      setLoadError(null);
    } catch {
      setLoadError("Dictation settings are unavailable from Phoenix Core.");
    }
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (patch: object, message: string) => {
    setSaved(null);
    const next = await run<DictationSettings>("POST", "/api/dictation/settings", patch);
    if (next) {
      setSettings(next);
      setVocabulary(next.vocabulary);
      setSaved(message);
      void reload();
    }
  };

  if (loadError)
    return (
      <section className="card" aria-labelledby="dictation-h">
        <h2 id="dictation-h" className="h3">
          Dictation
        </h2>
        <p role="status">{loadError}</p>
      </section>
    );
  if (!settings || !status)
    return (
      <section className="card" aria-labelledby="dictation-h">
        <h2 id="dictation-h" className="h3">
          Dictation
        </h2>
        <p className="muted small">Loading…</p>
      </section>
    );

  const limits = status.vocabulary_limits;
  return (
    <section className="card dictation-settings" aria-labelledby="dictation-h">
      <h2 id="dictation-h" className="h3">
        Dictation
      </h2>
      <p className="small">
        Dictation turns your speech into text on this device. It is <strong>off</strong> until you
        turn it on here, and turning it on is your consent for dictation only.
      </p>
      <ul className="small">
        <li>
          <strong>What leaves this device:</strong> nothing. Speech is recognised on this device;
          optional clean-up uses a model on this device only and is never sent to a cloud provider,
          even if you allowed cloud AI for other things.
        </li>
        <li>
          <strong>What stays in memory:</strong> the audio, for the length of one dictation (at most{" "}
          {status.limits.max_seconds} seconds). It is never written to disk and is erased when the
          dictation ends, is cancelled, or the emergency stop is used.
        </li>
        <li>
          <strong>What is stored:</strong> your settings and word lists below, and counts per day
          and app (words, speaking time, number of dictations). Never the text you dictate and never
          audio.
        </li>
        <li>
          The microphone is on only while you dictate, and Fawkes shows “Listening” the whole time.
        </li>
      </ul>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(e) =>
            void save(
              { enabled: e.target.checked },
              e.target.checked ? "Dictation is on." : "Dictation is off.",
            )
          }
        />
        Turn on dictation
      </label>
      <p className="small" role="status">
        Speech recogniser: {status.recognizer.available ? "available" : "unavailable"}.{" "}
        {status.recognizer.detail}
      </p>
      {status.kill_switch_engaged && (
        <p role="status">The emergency stop is engaged: dictation is blocked.</p>
      )}
      <Feedback error={error} saved={saved} />

      <h3 className="h4">Clean-up</h3>
      <p className="muted small">{status.cleanup.detail}</p>
      <div className="field">
        <label htmlFor="dictation-default-mode">Default clean-up</label>
        <select
          id="dictation-default-mode"
          value={settings.default_mode}
          disabled={busy}
          onChange={(e) => void save({ default_mode: e.target.value }, "Default clean-up saved.")}
        >
          {CLEANUP_MODES.map((m) => (
            <option key={m} value={m}>
              {CLEANUP_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </div>
      <AppModes
        modes={settings.app_modes}
        max={limits.app_modes}
        busy={busy}
        onSave={(app_modes) => save({ app_modes }, "App clean-up modes saved.")}
      />

      <h3 className="h4">Typing speed</h3>
      <TypingSpeed
        value={settings.typing_wpm}
        busy={busy}
        onSave={(typing_wpm) => save({ typing_wpm }, "Typing speed saved.")}
      />

      <VocabularyEditor
        value={vocabulary}
        onChange={setVocabulary}
        limits={limits}
        busy={busy}
        onSave={() => save({ vocabulary }, "Word lists saved.")}
      />

      <h3 className="h4">Statistics</h3>
      <Statistics
        stats={stats}
        busy={busy}
        confirm={confirmDelete}
        onAsk={() => setConfirmDelete(true)}
        onCancel={() => setConfirmDelete(false)}
        onDelete={async () => {
          setConfirmDelete(false);
          if (await run("DELETE", "/api/dictation/stats")) {
            setSaved("All dictation statistics were deleted.");
            void reload();
          }
        }}
      />
    </section>
  );
}

function TypingSpeed({
  value,
  busy,
  onSave,
}: {
  value: number;
  busy: boolean;
  onSave: (wpm: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const wpm = Number(text);
  const valid = Number.isInteger(wpm) && wpm >= 10 && wpm <= 200;
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(wpm);
      }}
    >
      <label htmlFor="dictation-wpm">How fast do you type? (words per minute)</label>
      <input
        id="dictation-wpm"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="btn" disabled={busy || !valid || wpm === value}>
        Save typing speed
      </button>
      {!valid && <span className="error-text small">Enter a whole number from 10 to 200.</span>}
    </form>
  );
}

const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function AppModes({
  modes,
  max,
  busy,
  onSave,
}: {
  modes: Record<string, CleanupMode>;
  max: number;
  busy: boolean;
  onSave: (modes: Record<string, CleanupMode>) => void;
}) {
  const [app, setApp] = useState("");
  const [mode, setMode] = useState<CleanupMode>("natural");
  const entries = Object.entries(modes);
  const valid = APP_ID.test(app) && (app in modes || entries.length < max);
  return (
    <div className="ai-subsection">
      <p className="small">
        Clean-up per app ({entries.length} of {max}). An app not listed uses the default.
      </p>
      <ul className="card-list">
        {entries.map(([name, m]) => (
          <li key={name} className="button-row wrap">
            <span className="small">
              <code>{name}</code>: {CLEANUP_MODE_LABELS[m]}
            </span>
            <button
              type="button"
              className="btn"
              aria-label={`Remove ${name}`}
              disabled={busy}
              onClick={() => onSave(Object.fromEntries(entries.filter(([n]) => n !== name)))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="button-row wrap"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) {
            onSave({ ...modes, [app]: mode });
            setApp("");
          }
        }}
      >
        <label className="small" htmlFor="dictation-app-id">
          App identifier (for example a bundle id)
        </label>
        <input
          id="dictation-app-id"
          value={app}
          maxLength={100}
          onChange={(e) => setApp(e.target.value)}
        />
        <label className="small" htmlFor="dictation-app-mode">
          Clean-up for this app
        </label>
        <select
          id="dictation-app-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as CleanupMode)}
        >
          {CLEANUP_MODES.map((m) => (
            <option key={m} value={m}>
              {CLEANUP_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn" disabled={busy || !valid}>
          Set app clean-up
        </button>
      </form>
      {app !== "" && !APP_ID.test(app) && (
        <p className="error-text small">
          Use letters, digits, dot, dash or underscore (at most 100).
        </p>
      )}
    </div>
  );
}

type Limits = DictationStatus["vocabulary_limits"];
// Same rule as Core: control, invisible and direction-changing characters are refused (Core checks again).
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;
const PHRASE = /^[\p{L}\p{N}\p{M}_'\u2019-]+(?: [\p{L}\p{N}\p{M}_'\u2019-]+)*$/u;

function phraseProblem(value: string, limits: Limits): string | null {
  if (!PHRASE.test(value)) return "Use plain words separated by single spaces (no punctuation).";
  if (value.length > limits.phrase_chars) return `At most ${limits.phrase_chars} characters.`;
  if (value.split(" ").length > limits.phrase_words) return `At most ${limits.phrase_words} words.`;
  return null;
}

function VocabularyEditor({
  value,
  onChange,
  limits,
  busy,
  onSave,
}: {
  value: DictationVocabulary;
  onChange: (value: DictationVocabulary) => void;
  limits: Limits;
  busy: boolean;
  onSave: () => void;
}) {
  const [term, setTerm] = useState("");
  const [sounds, setSounds] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [trigger, setTrigger] = useState("");
  const [snippet, setSnippet] = useState("");

  const termProblem =
    term === ""
      ? null
      : HIDDEN.test(term) || term.length > limits.term_chars || term !== term.trim()
        ? `Up to ${limits.term_chars} visible characters, no spaces at the ends.`
        : phraseProblem(sounds || term, limits)
          ? `“Sounds like” is needed when the term is not plain words: ${phraseProblem(sounds || term, limits)}`
          : null;
  const fromProblem = from === "" ? null : phraseProblem(from, limits);
  const toProblem =
    HIDDEN.test(to) || to.length > limits.replacement_chars
      ? `Up to ${limits.replacement_chars} visible characters.`
      : null;
  const triggerProblem = trigger === "" ? null : phraseProblem(trigger, limits);
  // eslint-disable-next-line no-control-regex
  const snippetProblem =
    /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u.test(
      snippet,
    ) || snippet.length > limits.snippet_chars
      ? `Up to ${limits.snippet_chars} characters; no control or hidden characters.`
      : null;

  return (
    <div className="dictation-vocabulary">
      <h3 className="h4">Dictionary, replacements and snippets</h3>
      <p className="muted small">
        Everything here is literal text: there are no patterns. Matching ignores upper and lower
        case and works on whole words.
      </p>

      <h4 className="h5">
        Dictionary ({value.dictionary.length} of {limits.dictionary})
      </h4>
      <p className="muted small">Spell a name or term the way you want it.</p>
      <ul className="card-list">
        {value.dictionary.map((e, i) => (
          <li key={`${e.term}-${i}`} className="button-row wrap">
            <span className="small">
              {e.sounds_like ? `“${e.sounds_like}” → ` : ""}
              {e.term}
            </span>
            <button
              type="button"
              className="btn"
              aria-label={`Remove dictionary entry ${e.term}`}
              onClick={() =>
                onChange({ ...value, dictionary: value.dictionary.filter((_, n) => n !== i) })
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row wrap">
        <label className="small" htmlFor="dict-term">
          Term
        </label>
        <input
          id="dict-term"
          value={term}
          maxLength={limits.term_chars}
          onChange={(e) => setTerm(e.target.value)}
        />
        <label className="small" htmlFor="dict-sounds">
          Sounds like (optional)
        </label>
        <input
          id="dict-sounds"
          value={sounds}
          maxLength={limits.phrase_chars}
          onChange={(e) => setSounds(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={!term || termProblem !== null || value.dictionary.length >= limits.dictionary}
          onClick={() => {
            onChange({
              ...value,
              dictionary: [...value.dictionary, sounds ? { term, sounds_like: sounds } : { term }],
            });
            setTerm("");
            setSounds("");
          }}
        >
          Add dictionary entry
        </button>
      </div>
      {termProblem && <p className="error-text small">{termProblem}</p>}

      <h4 className="h5">
        Replacements ({value.replacements.length} of {limits.replacements})
      </h4>
      <ul className="card-list">
        {value.replacements.map((e, i) => (
          <li key={`${e.from}-${i}`} className="button-row wrap">
            <span className="small">
              “{e.from}” → {e.to === "" ? "(removed)" : `“${e.to}”`}
            </span>
            <button
              type="button"
              className="btn"
              aria-label={`Remove replacement ${e.from}`}
              onClick={() =>
                onChange({ ...value, replacements: value.replacements.filter((_, n) => n !== i) })
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row wrap">
        <label className="small" htmlFor="repl-from">
          Replace the words
        </label>
        <input
          id="repl-from"
          value={from}
          maxLength={limits.phrase_chars}
          onChange={(e) => setFrom(e.target.value)}
        />
        <label className="small" htmlFor="repl-to">
          With (empty removes them)
        </label>
        <input
          id="repl-to"
          value={to}
          maxLength={limits.replacement_chars}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={
            !from ||
            fromProblem !== null ||
            toProblem !== null ||
            value.replacements.length >= limits.replacements
          }
          onClick={() => {
            onChange({ ...value, replacements: [...value.replacements, { from, to }] });
            setFrom("");
            setTo("");
          }}
        >
          Add replacement
        </button>
      </div>
      {(fromProblem || toProblem) && <p className="error-text small">{fromProblem ?? toProblem}</p>}

      <h4 className="h5">
        Snippets ({value.snippets.length} of {limits.snippets})
      </h4>
      <p className="muted small">
        A snippet expands only when the whole dictation is exactly its trigger.
      </p>
      <ul className="card-list">
        {value.snippets.map((e, i) => (
          <li key={`${e.trigger}-${i}`} className="button-row wrap">
            <span className="small">
              “{e.trigger}” → <span className="memory-text">{e.text}</span>
            </span>
            <button
              type="button"
              className="btn"
              aria-label={`Remove snippet ${e.trigger}`}
              onClick={() =>
                onChange({ ...value, snippets: value.snippets.filter((_, n) => n !== i) })
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row wrap">
        <label className="small" htmlFor="snip-trigger">
          When I say
        </label>
        <input
          id="snip-trigger"
          value={trigger}
          maxLength={limits.phrase_chars}
          onChange={(e) => setTrigger(e.target.value)}
        />
        <label className="small" htmlFor="snip-text">
          Insert this text
        </label>
        <textarea
          id="snip-text"
          rows={2}
          value={snippet}
          maxLength={limits.snippet_chars}
          onChange={(e) => setSnippet(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={
            !trigger ||
            !snippet ||
            triggerProblem !== null ||
            snippetProblem !== null ||
            value.snippets.length >= limits.snippets
          }
          onClick={() => {
            onChange({ ...value, snippets: [...value.snippets, { trigger, text: snippet }] });
            setTrigger("");
            setSnippet("");
          }}
        >
          Add snippet
        </button>
      </div>
      {(triggerProblem || snippetProblem) && (
        <p className="error-text small">{triggerProblem ?? snippetProblem}</p>
      )}

      <div className="button-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onSave}>
          Save word lists
        </button>
      </div>
    </div>
  );
}

function Statistics({
  stats,
  busy,
  confirm,
  onAsk,
  onCancel,
  onDelete,
}: {
  stats: DictationStats | null;
  busy: boolean;
  confirm: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  if (!stats) return null;
  return (
    <div>
      {stats.sessions === 0 ? (
        <p className="muted small">No dictations yet.</p>
      ) : (
        <dl className="small dictation-stats">
          <dt>Words dictated</dt>
          <dd>{stats.words}</dd>
          <dt>Dictations</dt>
          <dd>{stats.sessions}</dd>
          <dt>Time saved</dt>
          <dd>
            {formatDuration(stats.saved_ms)} (typing at {stats.typing_wpm} words per minute)
          </dd>
          <dt>Average speaking speed</dt>
          <dd>{stats.average_wpm} words per minute</dd>
          <dt>Streak</dt>
          <dd>
            {stats.streak_days} {stats.streak_days === 1 ? "day" : "days"}
          </dd>
          <dt>Top apps</dt>
          <dd>
            {stats.top_apps.length === 0
              ? "none"
              : stats.top_apps
                  .map((a) => `${a.app || "unknown app"} (${a.words} words)`)
                  .join(", ")}
          </dd>
        </dl>
      )}
      <p className="muted small">
        These are counts only. App names are private to you and are not sent anywhere. Core keeps
        them until you delete them.
      </p>
      {confirm ? (
        <div className="button-row wrap" role="group" aria-label="Confirm deleting statistics">
          <span className="small">Delete every dictation statistic? This cannot be undone.</span>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onDelete}>
            Yes, delete all
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Keep them
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={onAsk}>
          Delete all dictation statistics
        </button>
      )}
    </div>
  );
}
