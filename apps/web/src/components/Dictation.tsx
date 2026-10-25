// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../core/client";
import { useClient, useConnection } from "../core/context";
import {
  CLEANUP_MODES,
  CLEANUP_MODE_KEYS,
  dictationBlocked,
  dictationStopped,
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
import { formatNumber } from "../core/format";
import { useAction } from "../core/hooks";
import { useT } from "../i18n";
import { translate } from "../i18n/store";
import { Feedback } from "./Feedback";

const failure = (err: unknown) =>
  err instanceof ApiError
    ? err.message
    : err instanceof Error
      ? err.message
      : translate("common.error.requestFailed");

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
  const t = useT();
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
    if (connection !== "online" && live.current)
      abandon(translate("capture.audio.coreNotConnected"), false);
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
        return abandon(translate("capture.audio.invalidReply"), true);
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
            (err: unknown) =>
              abandon(translate("capture.audio.micUnavailable", { reason: failure(err) }), true),
          );
      } else if (message.type === "ended" || message.type === "error") {
        const why =
          typeof message.reason === "string" ? message.reason : String(message.error ?? "");
        abandon(dictationStopped(why), false);
        void refresh();
      } else if (message.type === "audio_ended") {
        void finish(session);
      }
    };
    socket.onerror = () => {
      if (live.current === session) abandon(translate("capture.audio.connectionFailed"), true);
    };
    socket.onclose = () => {
      if (live.current === session && !session.done)
        abandon(translate("capture.audio.connectionClosed"), true);
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
      else setError(translate("capture.dictation.nothingRecognised"));
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

  const blocked = dictationBlocked(status, connection);

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
          {phase === "starting"
            ? t("capture.dictation.button.starting")
            : t("capture.dictation.button.start")}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={phase !== "listening"}
            onClick={stop}
          >
            {phase === "processing"
              ? t("capture.dictation.button.recognising")
              : t("capture.dictation.button.stop")}
          </button>
          <button type="button" className="btn" onClick={() => abandon(null, true)}>
            {t("capture.dictation.button.cancel")}
          </button>
        </>
      )}
      <span id={hint} className="muted small">
        {blocked ?? t("capture.dictation.hint")}
      </span>
      {(phase === "listening" || phase === "starting") && (
        <p className="dictation-live small" role="status" data-testid="dictation-indicator">
          <span className="dictation-dot" aria-hidden="true" />
          {phase === "listening"
            ? t("capture.dictation.indicator.listening")
            : t("capture.audio.waitingForPermission")}
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
  const t = useT();
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
      setLoadError(translate("capture.dictation.settings.unavailable"));
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
          {t("capture.dictation.settings.title")}
        </h2>
        <p role="status">{loadError}</p>
      </section>
    );
  if (!settings || !status)
    return (
      <section className="card" aria-labelledby="dictation-h">
        <h2 id="dictation-h" className="h3">
          {t("capture.dictation.settings.title")}
        </h2>
        <p className="muted small">{t("common.status.loading")}</p>
      </section>
    );

  const limits = status.vocabulary_limits;
  return (
    <section className="card dictation-settings" aria-labelledby="dictation-h">
      <h2 id="dictation-h" className="h3">
        {t("capture.dictation.settings.title")}
      </h2>
      <p className="small">
        {t.rich("capture.dictation.settings.intro", {
          off: <strong>{t("capture.dictation.settings.intro.off")}</strong>,
        })}
      </p>
      <ul className="small">
        <li>
          <strong>{t("capture.dictation.privacy.leaves.lead")}</strong>{" "}
          {t("capture.dictation.privacy.leaves.body")}
        </li>
        <li>
          <strong>{t("capture.dictation.privacy.memory.lead")}</strong>{" "}
          {t("capture.dictation.privacy.memory.body", {
            seconds: status.limits.max_seconds,
          })}
        </li>
        <li>
          <strong>{t("capture.dictation.privacy.stored.lead")}</strong>{" "}
          {t("capture.dictation.privacy.stored.body")}
        </li>
        <li>{t("capture.dictation.privacy.microphone")}</li>
      </ul>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(e) =>
            void save(
              { enabled: e.target.checked },
              e.target.checked ? t("capture.dictation.saved.on") : t("capture.dictation.saved.off"),
            )
          }
        />
        {t("capture.dictation.settings.enable")}
      </label>
      <p className="small" role="status">
        {t(
          status.recognizer.available
            ? "capture.audio.recognizerAvailable"
            : "capture.audio.recognizerUnavailable",
          { detail: status.recognizer.detail },
        )}
      </p>
      {status.audio_on_disk && <p className="small">{t("capture.audio.onDisk")}</p>}
      {status.kill_switch_engaged && <p role="status">{t("capture.dictation.killSwitch")}</p>}
      <Feedback error={error} saved={saved} />

      <h3 className="h4">{t("capture.dictation.cleanup.heading")}</h3>
      <p className="muted small">{status.cleanup.detail}</p>
      <div className="field">
        <label htmlFor="dictation-default-mode">{t("capture.dictation.cleanup.default")}</label>
        <select
          id="dictation-default-mode"
          value={settings.default_mode}
          disabled={busy}
          onChange={(e) =>
            void save({ default_mode: e.target.value }, t("capture.dictation.saved.defaultMode"))
          }
        >
          {CLEANUP_MODES.map((m) => (
            <option key={m} value={m}>
              {t(CLEANUP_MODE_KEYS[m])}
            </option>
          ))}
        </select>
      </div>
      <AppModes
        modes={settings.app_modes}
        max={limits.app_modes}
        busy={busy}
        onSave={(app_modes) => save({ app_modes }, t("capture.dictation.saved.appModes"))}
      />

      <h3 className="h4">{t("capture.dictation.typing.heading")}</h3>
      <TypingSpeed
        value={settings.typing_wpm}
        busy={busy}
        onSave={(typing_wpm) => save({ typing_wpm }, t("capture.dictation.saved.typing"))}
      />

      <VocabularyEditor
        value={vocabulary}
        onChange={setVocabulary}
        limits={limits}
        busy={busy}
        onSave={() => save({ vocabulary }, t("capture.dictation.saved.vocabulary"))}
      />

      <h3 className="h4">{t("capture.dictation.stats.heading")}</h3>
      <Statistics
        stats={stats}
        busy={busy}
        confirm={confirmDelete}
        onAsk={() => setConfirmDelete(true)}
        onCancel={() => setConfirmDelete(false)}
        onDelete={async () => {
          setConfirmDelete(false);
          if (await run("DELETE", "/api/dictation/stats")) {
            setSaved(t("capture.dictation.saved.statsDeleted"));
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
  const t = useT();
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
      <label htmlFor="dictation-wpm">{t("capture.dictation.typing.label")}</label>
      <input
        id="dictation-wpm"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="btn" disabled={busy || !valid || wpm === value}>
        {t("capture.dictation.typing.save")}
      </button>
      {!valid && (
        <span className="error-text small">
          {t("capture.dictation.typing.invalid", {
            min: formatNumber(10),
            max: formatNumber(200),
          })}
        </span>
      )}
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
  const t = useT();
  const [app, setApp] = useState("");
  const [mode, setMode] = useState<CleanupMode>("natural");
  const entries = Object.entries(modes);
  const valid = APP_ID.test(app) && (app in modes || entries.length < max);
  return (
    <div className="ai-subsection">
      <p className="small">
        {t("capture.dictation.appModes.summary", {
          count: formatNumber(entries.length),
          max: formatNumber(max),
        })}
      </p>
      <ul className="card-list">
        {entries.map(([name, m]) => (
          <li key={name} className="button-row wrap">
            <span className="small">
              {t.rich("capture.dictation.appModes.entry", {
                app: <code>{name}</code>,
                mode: t(CLEANUP_MODE_KEYS[m]),
              })}
            </span>
            <button
              type="button"
              className="btn"
              aria-label={t("capture.dictation.appModes.remove", { app: name })}
              disabled={busy}
              onClick={() => onSave(Object.fromEntries(entries.filter(([n]) => n !== name)))}
            >
              {t("common.button.remove")}
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
          {t("capture.dictation.appModes.idLabel")}
        </label>
        <input
          id="dictation-app-id"
          value={app}
          maxLength={100}
          onChange={(e) => setApp(e.target.value)}
        />
        <label className="small" htmlFor="dictation-app-mode">
          {t("capture.dictation.appModes.modeLabel")}
        </label>
        <select
          id="dictation-app-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as CleanupMode)}
        >
          {CLEANUP_MODES.map((m) => (
            <option key={m} value={m}>
              {t(CLEANUP_MODE_KEYS[m])}
            </option>
          ))}
        </select>
        <button type="submit" className="btn" disabled={busy || !valid}>
          {t("capture.dictation.appModes.set")}
        </button>
      </form>
      {app !== "" && !APP_ID.test(app) && (
        <p className="error-text small">
          {t("capture.dictation.appModes.invalid", { max: formatNumber(100) })}
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
  if (!PHRASE.test(value)) return translate("capture.dictation.problem.plainWords");
  if (value.length > limits.phrase_chars)
    return translate("capture.dictation.problem.maxChars", { n: limits.phrase_chars });
  if (value.split(" ").length > limits.phrase_words)
    return translate("capture.dictation.problem.maxWords", { n: limits.phrase_words });
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
  const t = useT();
  const [term, setTerm] = useState("");
  const [sounds, setSounds] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [trigger, setTrigger] = useState("");
  const [snippet, setSnippet] = useState("");

  const termSoundsProblem = term === "" ? null : phraseProblem(sounds || term, limits);
  const termProblem =
    term === ""
      ? null
      : HIDDEN.test(term) || term.length > limits.term_chars || term !== term.trim()
        ? t("capture.dictation.problem.term", { n: limits.term_chars })
        : termSoundsProblem
          ? t("capture.dictation.problem.soundsLike", { problem: termSoundsProblem })
          : null;
  const fromProblem = from === "" ? null : phraseProblem(from, limits);
  const toProblem =
    HIDDEN.test(to) || to.length > limits.replacement_chars
      ? t("capture.dictation.problem.replacement", { n: limits.replacement_chars })
      : null;
  const triggerProblem = trigger === "" ? null : phraseProblem(trigger, limits);
  // eslint-disable-next-line no-control-regex
  const snippetProblem =
    /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u.test(
      snippet,
    ) || snippet.length > limits.snippet_chars
      ? t("capture.dictation.problem.snippet", { n: limits.snippet_chars })
      : null;

  return (
    <div className="dictation-vocabulary">
      <h3 className="h4">{t("capture.dictation.vocabulary.heading")}</h3>
      <p className="muted small">{t("capture.dictation.vocabulary.intro")}</p>

      <h4 className="h5">
        {t("capture.dictation.dictionary.heading", {
          count: formatNumber(value.dictionary.length),
          max: formatNumber(limits.dictionary),
        })}
      </h4>
      <p className="muted small">{t("capture.dictation.dictionary.intro")}</p>
      <ul className="card-list">
        {value.dictionary.map((e, i) => (
          <li key={`${e.term}-${i}`} className="button-row wrap">
            <span className="small">
              {e.sounds_like
                ? t("capture.dictation.dictionary.entry", {
                    soundsLike: e.sounds_like,
                    term: e.term,
                  })
                : e.term}
            </span>
            <button
              type="button"
              className="btn"
              aria-label={t("capture.dictation.dictionary.remove", { term: e.term })}
              onClick={() =>
                onChange({ ...value, dictionary: value.dictionary.filter((_, n) => n !== i) })
              }
            >
              {t("common.button.remove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row wrap">
        <label className="small" htmlFor="dict-term">
          {t("capture.dictation.dictionary.term")}
        </label>
        <input
          id="dict-term"
          value={term}
          maxLength={limits.term_chars}
          onChange={(e) => setTerm(e.target.value)}
        />
        <label className="small" htmlFor="dict-sounds">
          {t("capture.dictation.dictionary.soundsLike")}
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
          {t("capture.dictation.dictionary.add")}
        </button>
      </div>
      {termProblem && <p className="error-text small">{termProblem}</p>}

      <h4 className="h5">
        {t("capture.dictation.replacements.heading", {
          count: formatNumber(value.replacements.length),
          max: formatNumber(limits.replacements),
        })}
      </h4>
      <ul className="card-list">
        {value.replacements.map((e, i) => (
          <li key={`${e.from}-${i}`} className="button-row wrap">
            <span className="small">
              {e.to === ""
                ? t("capture.dictation.replacements.entryRemoved", { from: e.from })
                : t("capture.dictation.replacements.entry", { from: e.from, to: e.to })}
            </span>
            <button
              type="button"
              className="btn"
              aria-label={t("capture.dictation.replacements.remove", { from: e.from })}
              onClick={() =>
                onChange({ ...value, replacements: value.replacements.filter((_, n) => n !== i) })
              }
            >
              {t("common.button.remove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row wrap">
        <label className="small" htmlFor="repl-from">
          {t("capture.dictation.replacements.from")}
        </label>
        <input
          id="repl-from"
          value={from}
          maxLength={limits.phrase_chars}
          onChange={(e) => setFrom(e.target.value)}
        />
        <label className="small" htmlFor="repl-to">
          {t("capture.dictation.replacements.to")}
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
          {t("capture.dictation.replacements.add")}
        </button>
      </div>
      {(fromProblem || toProblem) && <p className="error-text small">{fromProblem ?? toProblem}</p>}

      <h4 className="h5">
        {t("capture.dictation.snippets.heading", {
          count: formatNumber(value.snippets.length),
          max: formatNumber(limits.snippets),
        })}
      </h4>
      <p className="muted small">{t("capture.dictation.snippets.intro")}</p>
      <ul className="card-list">
        {value.snippets.map((e, i) => (
          <li key={`${e.trigger}-${i}`} className="button-row wrap">
            <span className="small">
              {t.rich("capture.dictation.snippets.entry", {
                trigger: e.trigger,
                text: <span className="memory-text">{e.text}</span>,
              })}
            </span>
            <button
              type="button"
              className="btn"
              aria-label={t("capture.dictation.snippets.remove", { trigger: e.trigger })}
              onClick={() =>
                onChange({ ...value, snippets: value.snippets.filter((_, n) => n !== i) })
              }
            >
              {t("common.button.remove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="button-row wrap">
        <label className="small" htmlFor="snip-trigger">
          {t("capture.dictation.snippets.trigger")}
        </label>
        <input
          id="snip-trigger"
          value={trigger}
          maxLength={limits.phrase_chars}
          onChange={(e) => setTrigger(e.target.value)}
        />
        <label className="small" htmlFor="snip-text">
          {t("capture.dictation.snippets.text")}
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
          {t("capture.dictation.snippets.add")}
        </button>
      </div>
      {(triggerProblem || snippetProblem) && (
        <p className="error-text small">{triggerProblem ?? snippetProblem}</p>
      )}

      <div className="button-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onSave}>
          {t("capture.dictation.vocabulary.save")}
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
  const t = useT();
  if (!stats) return null;
  return (
    <div>
      {stats.sessions === 0 ? (
        <p className="muted small">{t("capture.dictation.stats.none")}</p>
      ) : (
        <dl className="small dictation-stats">
          <dt>{t("capture.dictation.stats.words")}</dt>
          <dd>{formatNumber(stats.words)}</dd>
          <dt>{t("capture.dictation.stats.sessions")}</dt>
          <dd>{formatNumber(stats.sessions)}</dd>
          <dt>{t("capture.dictation.stats.saved")}</dt>
          <dd>
            {t("capture.dictation.stats.savedValue", {
              duration: formatDuration(stats.saved_ms),
              wpm: stats.typing_wpm,
            })}
          </dd>
          <dt>{t("capture.dictation.stats.average")}</dt>
          <dd>{t("capture.dictation.stats.wordsPerMinute", { n: stats.average_wpm })}</dd>
          <dt>{t("capture.dictation.stats.streak")}</dt>
          <dd>{t("capture.dictation.stats.days", { n: stats.streak_days })}</dd>
          <dt>{t("capture.dictation.stats.topApps")}</dt>
          <dd>
            {stats.top_apps.length === 0
              ? t("capture.dictation.stats.noApps")
              : stats.top_apps
                  .map((a) =>
                    t("capture.dictation.stats.appWords", {
                      app: a.app || t("capture.dictation.stats.unknownApp"),
                      n: a.words,
                    }),
                  )
                  .join(", ")}
          </dd>
        </dl>
      )}
      <p className="muted small">{t("capture.dictation.stats.note")}</p>
      {confirm ? (
        <div
          className="button-row wrap"
          role="group"
          aria-label={t("capture.dictation.stats.confirmGroup")}
        >
          <span className="small">{t("capture.dictation.stats.confirmText")}</span>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onDelete}>
            {t("capture.dictation.stats.confirmYes")}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            {t("capture.dictation.stats.confirmKeep")}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={onAsk}>
          {t("capture.dictation.stats.delete")}
        </button>
      )}
    </div>
  );
}
