// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatNumber } from "../core/format";
import { useAction, useCapabilities } from "../core/hooks";
import type { CapabilityView } from "../core/types";
import { useT, type MessageKey } from "../i18n";

const STATUS_TEXT: Record<CapabilityView["status"], MessageKey> = {
  installed: "services.capabilities.status.installed",
  enabled: "services.capabilities.status.enabled",
  disabled: "services.capabilities.status.disabled",
  failed: "services.capabilities.status.failed",
  disconnected: "services.capabilities.status.disconnected",
};

const HEALTH_TEXT: Record<Exclude<CapabilityView["health"]["status"], "unknown">, MessageKey> = {
  healthy: "services.capabilities.health.healthy",
  degraded: "services.capabilities.health.degraded",
  unhealthy: "services.capabilities.health.unhealthy",
};

/** Installed capabilities with health, permissions and enable/disable (PRD v2.0 §5.3). */
export function CapabilityList() {
  const t = useT();
  const { data, error, reload } = useCapabilities();
  if (error) return <p className="error-text">{error}</p>;
  if (data.length === 0) return <p className="muted">{t("services.capabilities.empty")}</p>;
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
  const t = useT();
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
          <strong>{c.name}</strong>{" "}
          <span className="muted small">
            {t("services.capabilities.version", { version: c.version })}
          </span>
          <p className="muted small">{c.description}</p>
        </div>
        <button
          type="button"
          className={`btn ${enabled ? "" : "btn-primary"}`}
          disabled={busy || c.status === "disconnected"}
          onClick={() => void toggle()}
          aria-label={t(
            enabled ? "services.capabilities.disableNamed" : "services.capabilities.enableNamed",
            { name: c.name },
          )}
        >
          {t(enabled ? "services.capabilities.disable" : "services.capabilities.enable")}
        </button>
      </div>
      <p className="small">
        <span className={`status status-${c.status}`}>{t(STATUS_TEXT[c.status])}</span>
        {health && <span className={`health health-${health}`}> · {t(HEALTH_TEXT[health])}</span>}
        {c.health.message && enabled && <span className="muted"> · {c.health.message}</span>}
        {c.disabledReason === "kill_switch" && (
          <span className="muted"> · {t("services.capabilities.stoppedByKill")}</span>
        )}
      </p>
      {c.lastError && c.status === "failed" && <p className="error-text small">{c.lastError}</p>}
      {c.permissions.length > 0 && (
        <details>
          <summary className="small">
            {t("services.capabilities.permissions", { count: formatNumber(c.permissions.length) })}
          </summary>
          <ul className="perm-list">
            {c.permissions.map((p) => (
              <li key={p.permission} className="small">
                <span aria-hidden="true">{p.granted ? "✓" : "○"}</span> {p.description}
                <span className="sr-only">
                  {" "}
                  {t(
                    p.granted
                      ? "services.capabilities.granted"
                      : "services.capabilities.notGranted",
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.data_categories.length > 0 && (
        <p className="muted small">
          {t("services.capabilities.accesses", { categories: c.data_categories.join(", ") })}
        </p>
      )}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
