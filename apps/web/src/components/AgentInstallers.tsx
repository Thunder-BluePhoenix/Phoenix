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
import { useT, type MessageKey, type Translate } from "../i18n";
import { Feedback } from "./Feedback";

const STATE_TEXT: Record<AgentInstallView["state"], MessageKey> = {
  installed: "agents.installers.state.installed",
  not_installed: "agents.installers.state.notInstalled",
  needs_repair: "agents.installers.state.needsRepair",
  unsupported: "agents.installers.state.unsupported",
};

/** The action a state offers, in the order the buttons are shown. */
function actionsFor(agent: AgentInstallView): AgentInstallAction[] {
  if (agent.support !== "supported" || !agent.detected) return [];
  if (agent.state === "not_installed") return ["install"];
  if (agent.state === "needs_repair") return ["repair", "uninstall"];
  if (agent.state === "installed") return ["uninstall"];
  return [];
}

const ACTION_LABEL: Record<AgentInstallAction, MessageKey> = {
  install: "agents.installers.action.install",
  repair: "agents.installers.action.repair",
  uninstall: "agents.installers.action.uninstall",
};

const ACTION_ARIA: Record<AgentInstallAction, MessageKey> = {
  install: "agents.installers.actionLabel.install",
  repair: "agents.installers.actionLabel.repair",
  uninstall: "agents.installers.actionLabel.uninstall",
};

const PREVIEW_ARIA: Record<AgentInstallAction, MessageKey> = {
  install: "agents.installers.previewLabel.install",
  repair: "agents.installers.previewLabel.repair",
  uninstall: "agents.installers.previewLabel.uninstall",
};

const CONFIRM_LABEL: Record<AgentInstallAction, MessageKey> = {
  install: "agents.installers.confirm.install",
  repair: "agents.installers.confirm.repair",
  uninstall: "agents.installers.confirm.uninstall",
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

function stateText(t: Translate, agent: AgentInstallView): string {
  if (agent.support === "unsupported" || agent.state === "unsupported")
    return agent.reason
      ? t("agents.installers.unsupportedReason", { reason: agent.reason })
      : t("agents.installers.state.unsupported");
  if (agent.state === "needs_repair")
    return agent.missing.length
      ? t("agents.installers.needsRepairMissing", { missing: agent.missing.join(", ") })
      : t("agents.installers.state.needsRepair");
  return t(STATE_TEXT[agent.state]);
}

interface OpenPreview {
  agent: AgentInstallView;
  data: InstallPreview;
  /** The file changed after the preview, so its hash can no longer be confirmed. */
  stale: boolean;
}

/** Settings section: install, repair or remove Phoenix's hooks in each coding agent, previewed first. */
export function AgentInstallersSection() {
  const t = useT();
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
          setError(t("common.error.requestFailed"));
        }
        return undefined;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client, t],
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
      res.kept_user_edits ? `${res.summary} ${t("agents.installers.keptEdits")}` : res.summary,
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
        {t("agents.installers.title")}
      </h2>
      <p className="muted small">{t("agents.installers.intro")}</p>
      {relay && (
        <p className="small">
          {t(relay.running ? "agents.installers.relayRunning" : "agents.installers.relayStopped", {
            version: relay.version,
          })}
          {relay.error ? ` · ${relay.error}` : ""}
        </p>
      )}
      <Feedback error={loadError ?? error} saved={applied} />
      {data.agents.length === 0 ? (
        <p className="muted small">{t("agents.installers.none")}</p>
      ) : (
        <ul className="card-list" aria-label={t("agents.installers.listLabel")}>
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
                  {a.detected
                    ? t("agents.installers.detected")
                    : t("agents.installers.notDetected")}
                  {a.detected && a.detected_via ? ` (${a.detected_via})` : ""}
                </p>
                <p className="small">
                  {stateText(t, a)}
                  {unsupported && url && (
                    <>
                      {" "}
                      <a href={url} target="_blank" rel="noreferrer">
                        {t("agents.installers.documentation")}
                      </a>
                    </>
                  )}
                </p>
                {!unsupported && a.reason && <p className="muted small">{a.reason}</p>}
                {a.note && <p className="muted small">{a.note}</p>}
                {!unsupported && !a.detected && (
                  <p className="muted small">{t("agents.installers.notFound")}</p>
                )}
                {a.config_path && (
                  <p className="small">
                    {t.rich("agents.installers.configFile", {
                      path: <code className="memory-text">{a.config_path}</code>,
                    })}
                  </p>
                )}
                <div className="button-row">
                  {actionsFor(a).map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={t(ACTION_ARIA[action], { agent: a.label })}
                      onClick={() => void startPreview(a, action)}
                    >
                      {t(ACTION_LABEL[action])}
                    </button>
                  ))}
                </div>
                {open && (
                  <div
                    role="region"
                    aria-label={t(PREVIEW_ARIA[open.data.action], { agent: a.label })}
                  >
                    <p className="small">
                      {t.rich("agents.installers.changesTo", {
                        path: <code className="memory-text">{open.data.path}</code>,
                      })}
                    </p>
                    {open.data.changed ? (
                      open.data.diff && (
                        <pre className="memory-text" tabIndex={0}>
                          {open.data.diff}
                        </pre>
                      )
                    ) : (
                      <p className="small">{t("agents.installers.noChanges")}</p>
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
                          {t("agents.installers.previewAgain")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void confirm(open)}
                        >
                          {t(CONFIRM_LABEL[open.data.action])}
                        </button>
                      )}
                      <button type="button" className="btn" disabled={busy} onClick={cancel}>
                        {t("common.button.cancel")}
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
