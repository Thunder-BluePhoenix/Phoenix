// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The dictation flow of the pill page: the same session / WebSocket / finish protocol as the chat
// box's Dictate button (components/Dictation.tsx), as a reusable hook. The microphone is requested
// ONLY after a start and ONLY after Core accepted the session and said `ready`; it is released
// first on every way out.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../core/client";
import { useClient, useConnection } from "../core/context";
import type { DictationResult, DictationStarted, DictationStatus } from "../core/dictation";
import type { DictationMicrophone } from "../core/dictation-mic";
import type { ConnectionStatus } from "../core/types";
import type { PillAnalyser } from "./analyser";
import type { PillShell } from "./shell";

export type SessionPhase = "idle" | "starting" | "listening" | "recognising";

/** What the user is told after an attempt ended (never contains the dictated text). */
export interface SessionOutcome {
  tone: "success" | "info" | "error";
  text: string;
}

export interface DictationSessionOptions {
  createMicrophone: () => DictationMicrophone;
  /** Fed every PCM frame the microphone delivers; reset whenever the capture ends. */
  analyser: PillAnalyser;
  /** The desktop shell. Null in an ordinary browser, where the text is shown instead of pasted. */
  shell: PillShell | null;
  /** Browser mode only: called with the recognised text (nothing is pasted). */
  onText?: (text: string) => void;
}

export interface DictationSession {
  phase: SessionPhase;
  outcome: SessionOutcome | null;
  /** Browser mode only: the last recognised text, for showing and copying. Null with a shell. */
  text: string | null;
  /** Begins a session; ignored while one is already active. */
  start(): void;
  /** Finishes and pastes (or shows) the text. Before the microphone is on this cancels instead. */
  stop(): void;
  /** Abandons the attempt without pasting: releases the mic, closes the socket, deletes the session. */
  cancel(): void;
}

type Stage = "starting" | "listening" | "recognising" | "pasting";

interface Attempt {
  stage: Stage;
  id: string | null;
  socket: WebSocket | null;
  mic: DictationMicrophone | null;
  micRequested: boolean;
  done: boolean;
}

const failure = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Request failed";

/** The shell's paste errors are plain `{ code, message }` objects whose message is for humans. */
function pasteFailure(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    if (typeof err.message === "string" && err.message) return err.message.slice(0, 300);
  }
  return "The text could not be pasted.";
}

/** Why dictation cannot start now, in the words of the Dictate button; null when it can. */
export function dictationBlocked(
  status: DictationStatus | null,
  connection: ConnectionStatus,
): string | null {
  if (!status) return "Dictation status is not available.";
  if (!status.enabled) return "Dictation is off. Turn it on in Settings, under Dictation.";
  if (status.kill_switch_engaged) return "The emergency stop is engaged.";
  if (!status.recognizer.available) return status.recognizer.detail;
  if (connection !== "online") return "Phoenix Core is not connected.";
  return null;
}

/** Core's dictation status, refreshed when the connection changes and whenever `refreshKey` does. */
export function useDictationStatus(refreshKey: unknown): DictationStatus | null {
  const client = useClient();
  const [status, setStatus] = useState<DictationStatus | null>(null);
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
  }, [client, refresh, refreshKey]);
  return status;
}

export function useDictationSession(options: DictationSessionOptions): DictationSession {
  const client = useClient();
  const connection = useConnection();
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [outcome, setOutcome] = useState<SessionOutcome | null>(null);
  const [text, setText] = useState<string | null>(null);
  const attempt = useRef<Attempt | null>(null);
  // Results arrive long after the click: always use the latest options, not the ones captured then.
  const latest = useRef(options);
  latest.current = options;

  /** Every way out: the microphone is released first, then the socket, then Core is told. */
  const abandon = useCallback(
    (message: string | null, cancelCore: boolean) => {
      const current = attempt.current;
      // A paste in flight cannot be taken back, and the shell already knows about it.
      if (!current || current.stage === "pasting") return;
      attempt.current = null;
      current.done = true;
      current.mic?.stop();
      current.socket?.close();
      if (cancelCore && current.id)
        void client.request("DELETE", `/api/dictation/sessions/${current.id}`).catch(() => {});
      latest.current.analyser.reset();
      setPhase("idle");
      setOutcome(message === null ? null : { tone: "error", text: message });
      latest.current.shell?.ended();
    },
    [client],
  );
  useEffect(() => () => abandon(null, true), [abandon]);
  useEffect(() => {
    if (connection !== "online") abandon("Phoenix Core is not connected.", false);
  }, [connection, abandon]);

  const finish = useCallback(
    async (current: Attempt) => {
      let result: DictationResult;
      try {
        result = await client.request<DictationResult>(
          "POST",
          `/api/dictation/sessions/${current.id}/finish`,
          {},
        );
      } catch (err) {
        if (attempt.current === current) abandon(failure(err), false);
        return;
      }
      if (attempt.current !== current) return;
      current.done = true;
      current.socket?.close();
      latest.current.analyser.reset();
      const { shell, onText } = latest.current;
      const recognised = result.text;
      if (!recognised) {
        attempt.current = null;
        setPhase("idle");
        setOutcome({ tone: "info", text: "Nothing was recognised." });
        shell?.ended();
        return;
      }
      if (!shell) {
        attempt.current = null;
        setPhase("idle");
        setOutcome(null);
        setText(recognised);
        onText?.(recognised);
        return;
      }
      current.stage = "pasting";
      try {
        const pasted = await shell.paste(recognised);
        setOutcome({ tone: "success", text: pasted.pasted === "typed" ? "Typed" : "Pasted" });
      } catch (err) {
        setOutcome({ tone: "error", text: pasteFailure(err) });
      }
      if (attempt.current === current) attempt.current = null;
      setPhase("idle");
    },
    [client, abandon],
  );

  const start = useCallback(async () => {
    if (attempt.current) return;
    const current: Attempt = {
      stage: "starting",
      id: null,
      socket: null,
      mic: null,
      micRequested: false,
      done: false,
    };
    attempt.current = current;
    setOutcome(null);
    setText(null);
    setPhase("starting");

    let started: DictationStarted;
    try {
      started = await client.request<DictationStarted>("POST", "/api/dictation/sessions", {});
    } catch (err) {
      if (attempt.current === current) abandon(failure(err), false);
      return;
    }
    if (attempt.current !== current) {
      // Cancelled while Core was creating the session: it must not be left behind.
      void client.request("DELETE", `/api/dictation/sessions/${started.id}`).catch(() => {});
      return;
    }
    current.id = started.id;
    let socket: WebSocket;
    try {
      socket = client.openDictationSocket(started.id);
    } catch (err) {
      abandon(failure(err), true);
      return;
    }
    const mic = latest.current.createMicrophone();
    current.socket = socket;
    current.mic = mic;
    socket.onmessage = (event) => {
      if (attempt.current !== current || typeof event.data !== "string") return;
      let message: { type?: unknown; error?: unknown; reason?: unknown };
      try {
        message = JSON.parse(event.data) as typeof message;
      } catch {
        return abandon("Invalid reply from Core.", true);
      }
      if (message.type === "ready") {
        if (current.micRequested) return;
        current.micRequested = true;
        mic
          .start((pcm) => {
            if (
              attempt.current !== current ||
              (current.stage !== "listening" && current.stage !== "starting")
            )
              return;
            latest.current.analyser.push(pcm);
            if (socket.readyState === 1) socket.send(pcm.buffer as ArrayBuffer);
          })
          .then(
            () => {
              if (attempt.current !== current || current.stage !== "starting") return;
              current.stage = "listening";
              setPhase("listening");
            },
            (err: unknown) => abandon(`Microphone unavailable: ${failure(err)}`, true),
          );
      } else if (message.type === "ended" || message.type === "error") {
        const why =
          typeof message.reason === "string" ? message.reason : String(message.error ?? "");
        abandon(`Dictation stopped${why ? `: ${why.replaceAll("_", " ")}` : ""}.`, false);
      } else if (message.type === "audio_ended") {
        void finish(current);
      }
    };
    socket.onerror = () => {
      if (attempt.current === current) abandon("The audio connection failed.", true);
    };
    socket.onclose = () => {
      if (attempt.current === current && !current.done)
        abandon("The audio connection closed.", true);
    };
  }, [client, abandon, finish]);

  const stop = useCallback(() => {
    const current = attempt.current;
    if (!current) return;
    // Nothing has been captured yet (waiting for Core, `ready` or the permission prompt): cancel.
    if (current.stage === "starting") return abandon(null, true);
    if (current.stage !== "listening") return;
    current.stage = "recognising";
    setPhase("recognising");
    current.mic?.stop();
    latest.current.analyser.reset();
    if (current.socket?.readyState === 1) current.socket.send(JSON.stringify({ type: "end" }));
    else void finish(current);
  }, [abandon, finish]);

  const cancel = useCallback(() => abandon(null, true), [abandon]);
  const begin = useCallback(() => void start(), [start]);

  return { phase, outcome, text, start: begin, stop, cancel };
}
