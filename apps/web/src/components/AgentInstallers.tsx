// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useRef, useState } from "react";
import { ApiError } from "../core/client";
import { useClient } from "../core/context";
import { useAgentInstallers } from "../core/hooks";
import type {
  AgentInstallAction,
  AgentInstallView,
  InstallApplied,
  InstallPreview,
} from "../core/types";
import { Feedback } from "./Feedback";

const STATE_TEXT: Record<AgentInstallView["state"], string> = {
  installed: "Installed",
  not_installed: "Not installed",
  needs_repair: "Needs repair",
  unsupported: "Unsupported",
};

/** The action a state offers, in the order the buttons are shown. */
function actionsFor(agent: AgentInstallView): AgentInstallAction[] {
  if (agent.support !== "supported" || !agent.detected) return [];
  if (agent.state === "not_installed") return ["install"];
  if (agent.state === "needs_repair") return ["repair", "uninstall"];
  if (agent.state === "installed") return ["uninstall"];
  return [];
}

const ACTION_LABEL: Record<AgentInstallAction, string> = {
  install: "Install",
  repair: "Repair",
  uninstall: "Uninstall",
};

/** Only web links are rendered as links. */
function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function stateText(agent: AgentInstallView): string {
  if (agent.support === "unsupported" || agent.state === "unsupported")
    return `Unsupported${agent.reason ? `: ${agent.reason}` : ""}`;
  if (agent.state === "needs_repair")
    return `Needs repair${agent.missing.length ? ` — missing: ${agent.missing.join(", ")}` : ""}`;
  return STATE_TEXT[agent.state];
}

interface OpenPreview {
  agent: AgentInstallView;
  data: InstallPreview;
  /** The file changed after the preview, so its hash can no longer be confirmed. */
  stale: boolean;
}

/** Settings section: install, repair or remove Phoenix's hooks in each coding agent, previewed first. */
export function AgentInstallersSection() {
  const client = useClient();
  const { data, error: loadError, reload } = useAgentInstallers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const inFlight = useRef(false);

  /** One request at a time; a 409 also runs `onConflict`. Other failures become the error text. */
  const call = useCallback(
    async <T,>(path: string, body: unknown, onConflict?: () => void): Promise<T | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setApplied(null);
      try {
        return await client.request<T>("POST", path, body);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
          if (err.status === 409) onConflict?.();
        } else {
          setError("Request failed");
        }
        return undefined;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client],
  );

  const startPreview = async (agent: AgentInstallView, action: AgentInstallAction) => {
    const res = await call<InstallPreview>(`/api/agent-relay/${action}`, { agent: agent.id });
    if (res) setPreview({ agent, data: res, stale: false });
  };

  const confirm = async (open: OpenPreview) => {
    const { agent, data: p } = open;
    const res = await call<InstallApplied>(
      `/api/agent-relay/${p.action}`,
      { agent: agent.id, confirm_hash: p.hash },
      () => setPreview({ ...open, stale: true }),
    );
    if (!res) return;
    setPreview(null);
    setApplied(
      `${res.summary}${res.kept_user_edits ? " Your own edits to the file were kept." : ""}`,
    );
    void reload();
  };

  const cancel = () => {
    setPreview(null);
    setError(null);
  };

  const relay = data.relay;

  return (
    <section aria-labelledby="agent-installers-h" className="card">
      <h2 id="agent-installers-h" className="h3">
        Coding agents
      </h2>
      <p className="muted small">
        Let coding agents on this computer report to Phoenix by adding its hooks to their settings.
        Every change is shown first as a diff; nothing is written until you confirm.
      </p>
      {relay && (
        <p className="small">
          Relay: {relay.running ? "running" : "not running"} · version {relay.version}
          {relay.error ? ` · ${relay.error}` : ""}
        </p>
      )}
      <Feedback error={loadError ?? error} saved={applied} />
      {data.agents.length === 0 ? (
        <p className="muted small">No coding agents are known to Phoenix.</p>
      ) : (
        <ul className="card-list" aria-label="Coding agents">
          {data.agents.map((a) => {
            const url = safeUrl(a.doc_url);
            const open = preview && preview.agent.id === a.id ? preview : null;
            const unsupported = a.support === "unsupported" || a.state === "unsupported";
            return (
              <li key={a.id} className="card" aria-label={a.label}>
                <p>
                  <strong>{a.label}</strong>
                </p>
                <p className="small">
                  {a.detected ? "Detected" : "Not detected"}
                  {a.detected && a.detected_via ? ` (${a.detected_via})` : ""}
                </p>
                <p className="small">
                  {stateText(a)}
                  {unsupported && url && (
                    <>
                      {" "}
                      <a href={url} target="_blank" rel="noreferrer">
                        Documentation
                      </a>
                    </>
                  )}
                </p>
                {!unsupported && a.reason && <p className="muted small">{a.reason}</p>}
                {a.note && <p className="muted small">{a.note}</p>}
                {!unsupported && !a.detected && (
                  <p className="muted small">Not found on this computer.</p>
                )}
                {a.config_path && (
                  <p className="small">
                    Config file: <code className="memory-text">{a.config_path}</code>
                  </p>
                )}
                <div className="button-row">
                  {actionsFor(a).map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={`${ACTION_LABEL[action]} Phoenix hooks for ${a.label}`}
                      onClick={() => void startPreview(a, action)}
                    >
                      {ACTION_LABEL[action]}
                    </button>
                  ))}
                </div>
                {open && (
                  <div role="region" aria-label={`Preview: ${open.data.action} ${a.label}`}>
                    <p className="small">
                      Changes to <code className="memory-text">{open.data.path}</code>
                    </p>
                    {open.data.changed ? (
                      open.data.diff && (
                        <pre className="memory-text" tabIndex={0}>
                          {open.data.diff}
                        </pre>
                      )
                    ) : (
                      <p className="small">No changes needed</p>
                    )}
                    {open.data.notes.length > 0 && (
                      <ul className="small">
                        {open.data.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                    <div className="button-row">
                      {open.stale ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void startPreview(a, open.data.action)}
                        >
                          Preview again
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void confirm(open)}
                        >
                          Confirm {open.data.action}
                        </button>
                      )}
                      <button type="button" className="btn" disabled={busy} onClick={cancel}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
