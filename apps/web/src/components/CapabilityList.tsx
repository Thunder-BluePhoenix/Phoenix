// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useAction, useCapabilities } from "../core/hooks";
import type { CapabilityView } from "../core/types";

const STATUS_TEXT: Record<CapabilityView["status"], string> = {
  installed: "Not enabled",
  enabled: "Enabled",
  disabled: "Disabled",
  failed: "Failed to start",
  disconnected: "Not running",
};

/** Installed capabilities with health, permissions and enable/disable (PRD v2.0 §5.3). */
export function CapabilityList() {
  const { data, error, reload } = useCapabilities();
  if (error) return <p className="error-text">{error}</p>;
  if (data.length === 0) return <p className="muted">No capabilities installed.</p>;
  return (
    <ul className="card-list">
      {data.map((c) => (
        <CapabilityCard key={c.id} capability={c} onChanged={reload} />
      ))}
    </ul>
  );
}

function CapabilityCard({
  capability: c,
  onChanged,
}: {
  capability: CapabilityView;
  onChanged: () => void;
}) {
  const { run, busy, error } = useAction();
  const enabled = c.status === "enabled";
  const toggle = async () => {
    await run(
      "POST",
      `/api/capabilities/${encodeURIComponent(c.id)}/${enabled ? "disable" : "enable"}`,
      {},
    );
    onChanged();
  };
  const health = enabled && c.health.status !== "unknown" ? c.health.status : null;
  return (
    <li className="card capability">
      <div className="card-head">
        <div>
          <strong>{c.name}</strong> <span className="muted small">v{c.version}</span>
          <p className="muted small">{c.description}</p>
        </div>
        <button
          type="button"
          className={`btn ${enabled ? "" : "btn-primary"}`}
          disabled={busy || c.status === "disconnected"}
          onClick={() => void toggle()}
          aria-label={`${enabled ? "Disable" : "Enable"} ${c.name}`}
        >
          {enabled ? "Disable" : "Enable"}
        </button>
      </div>
      <p className="small">
        <span className={`status status-${c.status}`}>{STATUS_TEXT[c.status]}</span>
        {health && <span className={`health health-${health}`}> · {health}</span>}
        {c.health.message && enabled && <span className="muted"> · {c.health.message}</span>}
        {c.disabledReason === "kill_switch" && (
          <span className="muted"> · stopped by emergency stop</span>
        )}
      </p>
      {c.lastError && c.status === "failed" && <p className="error-text small">{c.lastError}</p>}
      {c.permissions.length > 0 && (
        <details>
          <summary className="small">Permissions ({c.permissions.length})</summary>
          <ul className="perm-list">
            {c.permissions.map((p) => (
              <li key={p.permission} className="small">
                <span aria-hidden="true">{p.granted ? "✓" : "○"}</span> {p.description}
                <span className="sr-only">{p.granted ? " (granted)" : " (not granted)"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.data_categories.length > 0 && (
        <p className="muted small">Accesses: {c.data_categories.join(", ")}</p>
      )}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
