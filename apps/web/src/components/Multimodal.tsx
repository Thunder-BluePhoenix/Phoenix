// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createBrowserCaptureSession } from "@phoenix/ai-multimodal/browser";
import type { CaptureKind, ScopedCaptureSession } from "@phoenix/ai-multimodal/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClient, useConnection } from "../core/context";
import { useCapabilities } from "../core/hooks";
import type { CapabilityView } from "../core/types";
import { Approvals } from "./Approvals";

type Modality = {
  available: boolean;
  detail: string;
  provider?: string;
  model?: string;
  locality?: string;
};
type CaptureStatus = {
  kill_switch_engaged: boolean;
  speech: Modality;
  vision: Modality;
  capture: Modality;
};
type Result = { kind: CaptureKind; text: string; provider: string; locality: string };
type CaptureMessage = {
  type: string;
  transcript?: unknown;
  description?: unknown;
  provider?: unknown;
  locality?: unknown;
  error?: unknown;
};

const source = "user";
const LIMIT: Record<CaptureKind, number> = {
  microphone: 32 * 1024 * 1024,
  screen: 8 * 1024 * 1024,
};
const CAPABILITY: Record<CaptureKind, string> = {
  microphone: "capture-microphone",
  screen: "capture-screen",
};

/** Core confirms grant, local model and per-use approval before a browser OS permission prompt. */
export function Multimodal() {
  const client = useClient();
  const connection = useConnection();
  const { data: capabilities } = useCapabilities();
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [active, setActive] = useState<CaptureKind | null>(null);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const current = useRef<{ socket: WebSocket; session?: ScopedCaptureSession } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const value = await client.request<CaptureStatus>("GET", "/api/multimodal/status");
      if (
        !value?.capture ||
        !value.speech ||
        !value.vision ||
        typeof value.capture.available !== "boolean"
      )
        throw new Error("Incomplete capture status");
      setStatus(value);
      setStatusError(null);
    } catch {
      setStatus(null);
      setStatusError("Core capture status is unavailable.");
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const offStatus = client.statusChanged.on(() => void refresh());
    const offCapability = client.capabilityChanged.on(() => void refresh());
    const offEvents = client.eventCreated.on(({ event }) => {
      if (event.event_type.startsWith("security.") || event.event_type.startsWith("capability."))
        void refresh();
    });
    return () => {
      offStatus();
      offCapability();
      offEvents();
    };
  }, [client, refresh]);

  const stop = useCallback(() => {
    const capture = current.current;
    current.current = null;
    capture?.session?.stop();
    capture?.socket.close();
    setActive(null);
    setPhase("");
  }, []);
  useEffect(
    () => () => {
      const capture = current.current;
      current.current = null;
      capture?.session?.stop();
      capture?.socket.close();
    },
    [],
  );
  useEffect(() => {
    if (connection !== "online") stop();
  }, [connection, stop]);

  const granted = (kind: CaptureKind) => {
    const cap: CapabilityView | undefined = capabilities.find((c) => c.id === CAPABILITY[kind]);
    return (
      cap?.status === "enabled" &&
      cap.permissions.length > 0 &&
      cap.permissions.every((p) => p.granted)
    );
  };
  const available = (kind: CaptureKind) => {
    const modality = status?.[kind === "microphone" ? "speech" : "vision"];
    return (
      connection === "online" &&
      !statusError &&
      !!status &&
      !status.kill_switch_engaged &&
      status.capture.available &&
      modality?.available === true &&
      modality.locality === "local" &&
      granted(kind)
    );
  };

  const start = (kind: CaptureKind) => {
    // Synchronous ref guard prevents a second click before React updates button state.
    if (current.current || !available(kind)) return;
    let socket: WebSocket;
    try {
      socket = client.openCaptureSocket();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture connection unavailable.");
      return;
    }
    const capture: { socket: WebSocket; session?: ScopedCaptureSession } = { socket };
    current.current = capture;
    setResult(null);
    setError(null);
    setActive(kind);
    setPhase("Waiting for Core approval. Review the request below; no device is active yet.");
    socket.onopen = () => {
      if (current.current === capture) socket.send(JSON.stringify({ kind, agent_id: source }));
    };
    socket.onmessage = (event) => {
      if (current.current !== capture || typeof event.data !== "string") return;
      let message: CaptureMessage;
      try {
        message = JSON.parse(event.data) as CaptureMessage;
      } catch {
        setError("Invalid Core capture response.");
        stop();
        return;
      }
      if (message.type === "ready" && !capture.session) {
        setPhase(
          kind === "microphone"
            ? "Core approved. Requesting microphone access for one second."
            : "Core approved. Requesting one screen frame.",
        );
        let session: ScopedCaptureSession;
        try {
          session = createBrowserCaptureSession({
            kind,
            capabilityId: CAPABILITY[kind],
            agentId: source,
            maxDurationMs: 15_000,
            // Core's ready is the real authorization; this bridge grants no independent permission.
            authorization: {
              authorize: async () => current.current === capture && socket.readyState === 1,
            },
          });
        } catch {
          setError("Browser capture is unavailable.");
          stop();
          return;
        }
        capture.session = session;
        void (async () => {
          try {
            await session.start();
            const bytes = await session.readFor(source);
            if (current.current !== capture || socket.readyState !== 1) return;
            if (bytes.length === 0 || bytes.length > LIMIT[kind])
              throw new Error("Capture exceeds the allowed frame size.");
            socket.send(bytes);
            setPhase("Processing locally; the device is stopped.");
          } catch (err) {
            if (current.current !== capture) return;
            setError(err instanceof Error ? err.message : "Browser device access denied.");
            stop();
          } finally {
            session.stop();
          }
        })();
      } else if (message.type === "result") {
        const text = kind === "microphone" ? message.transcript : message.description;
        if (
          typeof text !== "string" ||
          typeof message.provider !== "string" ||
          message.locality !== "local"
        ) {
          setError("Core returned an invalid local capture result.");
        } else {
          setResult({ kind, text, provider: message.provider, locality: message.locality });
        }
        stop();
        void refresh();
      } else if (message.type === "error") {
        setError(typeof message.error === "string" ? message.error : "Core refused capture.");
        stop();
        void refresh();
      } else {
        setError("Unexpected Core capture response.");
        stop();
      }
    };
    socket.onerror = () => {
      if (current.current === capture) {
        setError("Capture connection failed.");
        stop();
      }
    };
    socket.onclose = () => {
      if (current.current === capture) {
        setError("Capture ended without a result or approval.");
        stop();
      }
    };
  };

  return (
    <section className="card" aria-labelledby="capture-h">
      <h2 id="capture-h" className="h3">
        One-time device capture
      </h2>
      <p className="muted small">
        Requested by: user. Core checks your capability grant and asks for per-use approval before
        your browser asks for device access. Nothing captures in the background; no cloud fallback.
      </p>
      {statusError && <p role="status">{statusError}</p>}
      {status?.kill_switch_engaged && (
        <p role="status">Capture unavailable: kill switch engaged.</p>
      )}
      {(["microphone", "screen"] as const).map((kind) => {
        const modality = status?.[kind === "microphone" ? "speech" : "vision"];
        const label =
          kind === "microphone" ? "Microphone · one second of WAV audio" : "Screen · one PNG frame";
        return (
          <div key={kind}>
            <p>
              {label}. Model:{" "}
              {modality?.available ? (modality.model ?? "not reported by Core") : "unavailable"};
              provider:{" "}
              {modality?.available ? (modality.provider ?? "not reported by Core") : "unavailable"};
              locality:{" "}
              {modality?.available ? (modality.locality ?? "not reported by Core") : "unavailable"}.{" "}
              {modality?.detail ?? "Status not yet available."}
            </p>
            {!granted(kind) && (
              <p className="muted small">
                {kind} capability grant is unavailable; enable it under Capabilities before capture.
              </p>
            )}
            <button
              type="button"
              className="btn"
              disabled={!!current.current || !available(kind)}
              onClick={() => start(kind)}
            >
              Capture {kind}
            </button>
          </div>
        );
      })}
      {active && (
        <>
          <p role="status">{phase}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              stop();
              setError(null);
              setResult(null);
            }}
          >
            Stop capture
          </button>
          <Approvals />
        </>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {result && (
        <div role="status">
          <p>
            {result.kind === "microphone" ? "Transcript" : "Screen description"} · {result.provider}{" "}
            ({result.locality})
          </p>
          <p className="memory-text">{result.text}</p>
          <button type="button" className="btn" onClick={() => setResult(null)}>
            Clear result
          </button>
        </div>
      )}
    </section>
  );
}
