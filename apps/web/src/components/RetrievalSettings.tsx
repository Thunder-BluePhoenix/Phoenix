// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState } from "react";
import { formatAgo } from "../core/format";
import { useAction, useRetrievalSettings, useRetrievalStatus } from "../core/hooks";
import type { RetrievalSettings as Settings, RetrievalStatus } from "../core/types";
import { Feedback } from "./Feedback";

const INACTIVE_TEXT: Record<string, string> = {
  retrieval_disabled: "Smart search is off.",
  ai_disabled: "Smart search is on, but AI is off, so it is not used. Turn AI on below.",
};

const bytes = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

function StatusLines({ status }: { status: RetrievalStatus }) {
  return (
    <dl className="approval-facts small" aria-label="Smart search status">
      <dt>State</dt>
      <dd>
        {status.active
          ? "Working: searches use keywords and meaning."
          : (INACTIVE_TEXT[status.inactive_reason ?? ""] ?? "Not in use.")}
      </dd>
      <dt>Index size</dt>
      <dd>
        {status.embedded} of {status.total} memories indexed ({status.unembedded} waiting,{" "}
        {status.failures} failed) · {bytes(status.payload_bytes)}
      </dd>
      <dt>Model</dt>
      <dd className="memory-text">
        {status.provider} / {status.model}
      </dd>
      <dt>Last build</dt>
      <dd>
        {status.last_run ? (
          <>
            {formatAgo(status.last_run.at)}: {status.last_run.embedded} added,{" "}
            {status.last_run.failed} failed, {status.last_run.remaining} left
            {status.last_run.capped && " (stopped at its limit; it continues on the next run)"}
          </>
        ) : (
          "Not built since Phoenix started."
        )}
      </dd>
      <dt>Fallback</dt>
      <dd>
        {status.last_run && status.last_run.degraded.length > 0
          ? `Keywords only for some of it: ${status.last_run.degraded.join("; ")}`
          : "None: no fallback reason was reported."}
      </dd>
      {status.other_models.length > 0 && (
        <>
          <dt>Old vectors</dt>
          <dd className="memory-text">
            Kept but never used:{" "}
            {status.other_models.map((m) => `${m.model} (${m.vectors})`).join(", ")}
          </dd>
        </>
      )}
    </dl>
  );
}

function RetrievalForm({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) {
  const { data: status, error: statusError, reload: reloadStatus } = useRetrievalStatus();
  const { run, busy, error } = useAction();
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = async () => {
    await reload();
    await reloadStatus();
  };

  const toggle = async () => {
    setSaved(null);
    const on = !settings.enabled;
    const res = await run<Settings>("POST", "/api/retrieval/settings", { enabled: on });
    if (res) {
      setSaved(
        on
          ? "Smart search is on. It builds its index on this computer whenever AI is also on."
          : "Smart search is off. Searches use keywords only.",
      );
    }
    await refresh();
  };

  // Core has no rebuild route. Turning it off and on again is what starts an indexing run, and
  // an indexing run only embeds memories that have no vector yet.
  const update = async () => {
    setSaved(null);
    const off = await run<Settings>("POST", "/api/retrieval/settings", { enabled: false });
    if (off) {
      const on = await run<Settings>("POST", "/api/retrieval/settings", { enabled: true });
      if (on) setSaved("Indexing started for memories that are not indexed yet.");
    }
    await refresh();
  };

  return (
    <>
      <label className="choice">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={() => void toggle()}
        />
        Smart search (keywords and meaning)
      </label>
      <p className="muted small">
        Off by default. When on, Phoenix turns your memories into number lists (embeddings) with{" "}
        <code>{settings.model}</code> through <strong>{settings.provider}</strong> to find things
        you word differently. Your search questions are embedded too, and they are treated as
        sensitive: they stay on this computer and are never sent to a cloud service unless you
        yourself chose that for sensitive data in the AI settings below. It also needs AI turned on.
      </p>
      {status && <StatusLines status={status} />}
      {statusError && !status && <Feedback error={statusError} />}
      <div className="button-row wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || !status?.active}
          aria-describedby="retrieval-update-note"
          onClick={() => void update()}
        >
          Update the index now
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
          Refresh status
        </button>
      </div>
      <p id="retrieval-update-note" className="muted small">
        {status?.active ? "" : "Update is available once smart search is on and AI is on. "}
        “Update” embeds the memories that are not indexed yet; it briefly switches smart search off
        and on to do that. Phoenix cannot re-embed everything from scratch.
      </p>
      <Feedback error={error} saved={saved} />
    </>
  );
}

/** Retrieval settings and status (Phase 37), on the Settings page. */
export function RetrievalSettingsSection() {
  const { data, error, reload } = useRetrievalSettings();
  return (
    <section aria-labelledby="retrieval-h" className="card">
      <h2 id="retrieval-h" className="h3">
        Smart search
      </h2>
      {data ? (
        <RetrievalForm settings={data} reload={reload} />
      ) : (
        <Feedback error={error ?? null} />
      )}
    </section>
  );
}
