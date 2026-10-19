// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createBrowserCaptureSession } from "@phoenix/ai-multimodal/browser";
import type { CaptureKind, ScopedCaptureSession } from "@phoenix/ai-multimodal/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClient, useConnection } from "../core/context";
import { useCapabilities } from "../core/hooks";
import type { CapabilityView } from "../core/types";
import { useT, type MessageKey } from "../i18n";
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
  const t = useT();
  const client = useClient();
  const connection = useConnection();
  const { data: capabilities } = useCapabilities();
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [active, setActive] = useState<CaptureKind | null>(null);
  const [phase, setPhase] = useState<MessageKey | null>(null);
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
      setStatusError(false);
    } catch {
      setStatus(null);
      setStatusError(true);
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
    setPhase(null);
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
      setError(
        err instanceof Error ? err.message : t("capture.multimodal.error.connectionUnavailable"),
      );
      return;
    }
    const capture: { socket: WebSocket; session?: ScopedCaptureSession } = { socket };
    current.current = capture;
    setResult(null);
    setError(null);
    setActive(kind);
    setPhase("capture.multimodal.phase.waitingApproval");
    socket.onopen = () => {
      if (current.current === capture) socket.send(JSON.stringify({ kind, agent_id: source }));
    };
    socket.onmessage = (event) => {
      if (current.current !== capture || typeof event.data !== "string") return;
      let message: CaptureMessage;
      try {
        message = JSON.parse(event.data) as CaptureMessage;
      } catch {
        setError(t("capture.multimodal.error.invalidResponse"));
        stop();
        return;
      }
      if (message.type === "ready" && !capture.session) {
        setPhase(
          kind === "microphone"
            ? "capture.multimodal.phase.approvedMicrophone"
            : "capture.multimodal.phase.approvedScreen",
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
          setError(t("capture.multimodal.error.browserUnavailable"));
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
              throw new Error(t("capture.multimodal.error.frameSize"));
            socket.send(bytes);
            setPhase("capture.multimodal.phase.processing");
          } catch (err) {
            if (current.current !== capture) return;
            setError(
              err instanceof Error ? err.message : t("capture.multimodal.error.deviceDenied"),
            );
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
          setError(t("capture.multimodal.error.invalidResult"));
        } else {
          setResult({ kind, text, provider: message.provider, locality: message.locality });
        }
        stop();
        void refresh();
      } else if (message.type === "error") {
        setError(
          typeof message.error === "string" ? message.error : t("capture.multimodal.error.refused"),
        );
        stop();
        void refresh();
      } else {
        setError(t("capture.multimodal.error.unexpected"));
        stop();
      }
    };
    socket.onerror = () => {
      if (current.current === capture) {
        setError(t("capture.multimodal.error.connectionFailed"));
        stop();
      }
    };
    socket.onclose = () => {
      if (current.current === capture) {
        setError(t("capture.multimodal.error.ended"));
        stop();
      }
    };
  };

  return (
    <section className="card" aria-labelledby="capture-h">
      <h2 id="capture-h" className="h3">
        {t("capture.multimodal.title")}
      </h2>
      <p className="muted small">{t("capture.multimodal.intro")}</p>
      {statusError && <p role="status">{t("capture.multimodal.statusUnavailable")}</p>}
      {status?.kill_switch_engaged && <p role="status">{t("capture.multimodal.killSwitch")}</p>}
      {(["microphone", "screen"] as const).map((kind) => {
        const modality = status?.[kind === "microphone" ? "speech" : "vision"];
        const reported = (value: string | undefined) =>
          modality?.available
            ? (value ?? t("capture.multimodal.notReported"))
            : t("capture.multimodal.modalityUnavailable");
        return (
          <div key={kind}>
            <p>
              {t("capture.multimodal.modality", {
                label: t(`capture.multimodal.kind.${kind}`),
                model: reported(modality?.model),
                provider: reported(modality?.provider),
                locality: reported(modality?.locality),
                detail: modality?.detail ?? t("capture.multimodal.statusPending"),
              })}
            </p>
            {!granted(kind) && (
              <p className="muted small">{t(`capture.multimodal.grant.${kind}`)}</p>
            )}
            <button
              type="button"
              className="btn"
              disabled={!!current.current || !available(kind)}
              onClick={() => start(kind)}
            >
              {t(`capture.multimodal.capture.${kind}`)}
            </button>
          </div>
        );
      })}
      {active && (
        <>
          <p role="status">{phase && t(phase)}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              stop();
              setError(null);
              setResult(null);
            }}
          >
            {t("capture.multimodal.stop")}
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
            {t("capture.multimodal.result.heading", {
              what: t(
                result.kind === "microphone"
                  ? "capture.multimodal.result.transcript"
                  : "capture.multimodal.result.screen",
              ),
              provider: result.provider,
              locality: result.locality,
            })}
          </p>
          <p className="memory-text">{result.text}</p>
          <button type="button" className="btn" onClick={() => setResult(null)}>
            {t("capture.multimodal.result.clear")}
          </button>
        </div>
      )}
    </section>
  );
}
