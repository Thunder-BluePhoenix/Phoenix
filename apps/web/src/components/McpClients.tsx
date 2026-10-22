// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useClient } from "../core/context";
import { formatAgo, formatDate } from "../core/format";
import { useAction } from "../core/hooks";
import {
  isValidScope,
  MCP_READ_TOOLS,
  MCP_SENSITIVITIES,
  sameGrants,
  type McpClient,
  type McpCreatedClient,
  type McpGrants,
  type McpSensitivity,
  type McpStatus,
} from "../core/mcp";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

/**
 * Phoenix MCP server: turns the local listener on, creates clients, and edits what each client may
 * do. Off by default; a new client has no grants. A client token lives only in this component's
 * state (shown once) and is dropped when the owner says they saved it.
 */
export function McpClients() {
  const t = useT();
  const client = useClient();
  const { run, busy, error } = useAction();
  const ids = useId();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState<McpCreatedClient | null>(null);
  const [port, setPort] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await client.request<McpStatus>("GET", "/api/mcp/status");
      setStatus(next);
      setPort((current) => (current === "" ? String(next.port) : current));
      setLoadError(null);
    } catch {
      setLoadError(t("mcp.unavailable"));
    }
  }, [client, t]);
  const reloadClients = useCallback(async () => {
    try {
      setClients(
        (await client.request<{ clients: McpClient[] }>("GET", "/api/mcp/clients")).clients,
      );
    } catch {
      // The list is secondary; the status above reports an unreachable Core.
    }
  }, [client]);

  useEffect(() => {
    void reload();
    void reloadClients();
  }, [reload, reloadClients]);

  const change = async (body: object, success: string) => {
    setMessage(null);
    const next = await run<McpStatus>("POST", "/api/mcp/settings", body);
    if (next) {
      setStatus(next);
      setMessage(success);
    }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const made = await run<McpCreatedClient>("POST", "/api/mcp/clients", { name });
    if (made) {
      setToken(made);
      setName("");
      setMessage(t("mcp.new.created"));
      await reload();
      await reloadClients();
    }
  };
  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.token);
      setMessage(t("mcp.token.copied"));
    } catch {
      setMessage(t("mcp.token.copyFailed"));
    }
  };
  const saveGrants = async (id: string, grants: McpGrants) => {
    setMessage(null);
    const saved = await run<McpClient>(
      "POST",
      `/api/mcp/clients/${encodeURIComponent(id)}/grants`,
      grants,
    );
    if (saved) {
      setMessage(t("mcp.grants.saved"));
      await reloadClients();
    }
  };
  const revoke = async (id: string) => {
    setMessage(null);
    const done = await run("DELETE", `/api/mcp/clients/${encodeURIComponent(id)}`);
    if (done) {
      setRevoking(null);
      setMessage(t("mcp.revoke.done"));
      if (token?.client.id === id) setToken(null);
      await reload();
      await reloadClients();
    }
  };

  const warningId = `${ids}-warning`;
  return (
    <section aria-labelledby={`${ids}-h`} className="card mcp-clients">
      <h2 id={`${ids}-h`} className="h3">
        {t("mcp.title")}
      </h2>
      <p className="muted small">{t("mcp.intro")}</p>
      {loadError && <Feedback error={loadError} />}
      {status?.unavailable && <p className="muted small">{t("mcp.demoUnavailable")}</p>}
      {status && !status.unavailable && (
        <>
          <div id={warningId} className="mcp-warning small">
            <p>
              <strong>{t("mcp.warning.title")}</strong>
            </p>
            <ul>
              <li>{t("mcp.warning.local")}</li>
              <li>{t("mcp.warning.token")}</li>
              <li>{t("mcp.warning.untrusted")}</li>
              <li>{t("mcp.warning.approval")}</li>
            </ul>
          </div>
          <label className="choice">
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busy}
              aria-describedby={warningId}
              onChange={(e) =>
                void change(
                  { enabled: e.target.checked },
                  t(e.target.checked ? "mcp.saved.on" : "mcp.saved.off"),
                )
              }
            />
            {t("mcp.enable.label")}
          </label>
          {status.kill_switch && (
            <p className="error-text small" role="status">
              {t("mcp.killSwitch")}
            </p>
          )}
          {status.enabled && !status.kill_switch && !status.listening && (
            <p className="small" role="status">
              {t("mcp.notListening")}
            </p>
          )}
          {status.listening && status.url && (
            <dl className="mcp-facts small">
              <dt>{t("mcp.listening.url")}</dt>
              <dd>
                <code className="mcp-mono">{status.url}</code>
              </dd>
            </dl>
          )}
          <form
            className="mcp-port"
            onSubmit={(e) => {
              e.preventDefault();
              void change({ port: Number(port) }, t("mcp.port.saved"));
            }}
          >
            <label htmlFor={`${ids}-port`}>{t("mcp.port.label")}</label>
            <input
              id={`${ids}-port`}
              inputMode="numeric"
              value={port}
              disabled={busy}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
            />
            <button className="btn" type="submit" disabled={busy || !/^\d{4,5}$/.test(port)}>
              {t("mcp.port.save")}
            </button>
          </form>

          <h3 className="h4">{t("mcp.new.title")}</h3>
          <form className="mcp-new" onSubmit={(e) => void create(e)}>
            <label htmlFor={`${ids}-name`}>{t("mcp.new.name")}</label>
            <input
              id={`${ids}-name`}
              value={name}
              maxLength={80}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn" type="submit" disabled={busy || name.trim().length === 0}>
              {t("mcp.new.create")}
            </button>
          </form>

          {token && (
            <div className="card mcp-token" role="group" aria-label={t("mcp.token.title")}>
              <p>
                <strong>{t("mcp.token.title")}</strong>
              </p>
              <p className="small">{t("mcp.token.note")}</p>
              <p>
                <code className="mcp-mono mcp-token-text" aria-label={t("mcp.token.label")}>
                  {token.token}
                </code>
              </p>
              <div className="button-row wrap">
                <button className="btn" type="button" onClick={() => void copy()}>
                  {t("mcp.token.copy")}
                </button>
                <button className="btn" type="button" onClick={() => setToken(null)}>
                  {t("mcp.token.done")}
                </button>
              </div>
            </div>
          )}

          <h3 className="h4">{t("mcp.clients.title")}</h3>
          {clients.length === 0 ? (
            <p className="muted small">{t("mcp.clients.none")}</p>
          ) : (
            <ul className="mcp-list">
              {clients.map((c) => (
                <ClientCard
                  key={c.id}
                  c={c}
                  busy={busy}
                  asking={revoking === c.id}
                  onAsk={() => setRevoking(c.id)}
                  onCancel={() => setRevoking(null)}
                  onRevoke={() => void revoke(c.id)}
                  onSave={(grants) => void saveGrants(c.id, grants)}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <Feedback error={error} saved={message} />
    </section>
  );
}

interface ClientCardProps {
  c: McpClient;
  busy: boolean;
  asking: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRevoke: () => void;
  onSave: (grants: McpGrants) => void;
}

function ClientCard({ c, busy, asking, onAsk, onCancel, onRevoke, onSave }: ClientCardProps) {
  const t = useT();
  const ids = useId();
  const [draft, setDraft] = useState<McpGrants>(c.grants);
  const [scope, setScope] = useState("");
  const [sensitivity, setSensitivity] = useState<McpSensitivity>("internal");
  const revoked = c.revoked_at !== null;
  const scopeBad = scope.length > 0 && !isValidScope(scope);

  // The server's copy wins after a save or reload.
  useEffect(() => {
    setDraft(c.grants);
  }, [c.grants]);

  const toggleTool = (tool: string, on: boolean) =>
    setDraft((d) => ({
      ...d,
      tools: on ? [...new Set([...d.tools, tool])] : d.tools.filter((x) => x !== tool),
    }));
  const addScope = () => {
    if (scope.length === 0 || scopeBad) return;
    setDraft((d) => ({
      ...d,
      memory: [
        ...d.memory.filter((m) => m.scope !== scope),
        { scope, max_sensitivity: sensitivity },
      ],
    }));
    setScope("");
  };

  return (
    <li className="mcp-client">
      <p>
        <strong>{c.name}</strong>
      </p>
      <p className="muted small">{t("mcp.client.id", { id: c.id })}</p>
      <p className="muted small">
        {t("mcp.client.created", { date: formatDate(c.created_at) })}
        {" · "}
        {c.last_used_at
          ? t("mcp.client.lastUsed", { when: formatAgo(c.last_used_at) })
          : t("mcp.client.neverUsed")}
      </p>
      {revoked ? (
        <p className="small">{t("mcp.client.revokedOn", { date: formatDate(c.revoked_at!) })}</p>
      ) : (
        <>
          {c.grants.tools.length === 0 &&
            c.grants.memory.length === 0 &&
            !c.grants.request_approval &&
            !c.grants.notify && <p className="muted small">{t("mcp.client.noGrants")}</p>}
          <fieldset className="mcp-grants">
            <legend>{t("mcp.grants.title", { name: c.name })}</legend>
            <p className="small">{t("mcp.grants.tools")}</p>
            {MCP_READ_TOOLS.map(([tool, label]) => (
              <label key={tool} className="choice">
                <input
                  type="checkbox"
                  checked={draft.tools.includes(tool)}
                  disabled={busy}
                  onChange={(e) => toggleTool(tool, e.target.checked)}
                />
                {t(label)}
              </label>
            ))}
            <p className="small">{t("mcp.grants.actions")}</p>
            <label className="choice">
              <input
                type="checkbox"
                checked={draft.request_approval}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, request_approval: e.target.checked }))}
              />
              {t("mcp.grants.requestApproval")}
            </label>
            <label className="choice">
              <input
                type="checkbox"
                checked={draft.notify}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, notify: e.target.checked }))}
              />
              {t("mcp.grants.notify")}
            </label>
            <p className="small">{t("mcp.grants.memory")}</p>
            <p className="muted small">{t("mcp.grants.memory.note")}</p>
            {draft.memory.length === 0 ? (
              <p className="muted small">{t("mcp.grants.memory.none")}</p>
            ) : (
              <ul className="mcp-scopes">
                {draft.memory.map((m) => (
                  <li key={m.scope}>
                    <code className="mcp-mono">{m.scope}</code>{" "}
                    <span className="small">
                      {t(MCP_SENSITIVITIES.find(([s]) => s === m.max_sensitivity)![1])}
                    </span>{" "}
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          memory: d.memory.filter((x) => x.scope !== m.scope),
                        }))
                      }
                    >
                      {t("mcp.grants.memory.remove", { scope: m.scope })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mcp-add-scope">
              <label htmlFor={`${ids}-scope`}>{t("mcp.grants.memory.scope")}</label>
              <input
                id={`${ids}-scope`}
                value={scope}
                maxLength={210}
                aria-invalid={scopeBad}
                disabled={busy}
                onChange={(e) => setScope(e.target.value)}
              />
              <label htmlFor={`${ids}-sens`}>{t("mcp.grants.memory.sensitivity")}</label>
              <select
                id={`${ids}-sens`}
                value={sensitivity}
                disabled={busy}
                onChange={(e) => setSensitivity(e.target.value as McpSensitivity)}
              >
                {MCP_SENSITIVITIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                type="button"
                disabled={busy || scope.length === 0 || scopeBad}
                onClick={addScope}
              >
                {t("mcp.grants.memory.add")}
              </button>
            </div>
            {scopeBad && (
              <p className="error-text small" role="alert">
                {t("mcp.grants.memory.invalid")}
              </p>
            )}
            <div className="button-row wrap">
              <button
                className="btn"
                type="button"
                disabled={busy || sameGrants(draft, c.grants)}
                onClick={() => onSave(draft)}
              >
                {t("mcp.grants.save")}
              </button>
            </div>
          </fieldset>
          {asking ? (
            <div role="group" aria-label={t("mcp.revoke.ask", { name: c.name })}>
              <p className="small">{t("mcp.revoke.ask", { name: c.name })}</p>
              <div className="button-row wrap">
                <button className="btn" type="button" disabled={busy} onClick={onRevoke}>
                  {t("mcp.revoke.yes")}
                </button>
                <button className="btn" type="button" onClick={onCancel}>
                  {t("mcp.revoke.no")}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn" type="button" disabled={busy} onClick={onAsk}>
              {t("mcp.revoke", { name: c.name })}
            </button>
          )}
        </>
      )}
    </li>
  );
}
