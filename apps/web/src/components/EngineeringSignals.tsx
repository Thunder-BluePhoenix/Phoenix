// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState } from "react";
import { useClient } from "../core/context";
import { readSignalsSnapshot, type SignalsSnapshot, type SignalKind } from "../core/signals";
import { useT, type MessageKey } from "../i18n";

const labels: Record<SignalKind, MessageKey> = {
  advisory: "signals.advisory",
  flaky_test: "signals.flaky_test",
  duration_trend: "signals.duration_trend",
  config_drift: "signals.config_drift",
};
/** Read-only signal dashboard; repository watches require an explicit user action. */
export function EngineeringSignals() {
  const t = useT();
  const client = useClient();
  const [snapshot, setSnapshot] = useState<SignalsSnapshot | null>(null);
  const [root, setRoot] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const data = readSignalsSnapshot(await client.request("GET", "/api/engineering-signals"));
      if (!data) throw new Error("Invalid response");
      setSnapshot(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const updateRoots = async (roots: string[]) => {
    setBusy(true);
    try {
      const data = readSignalsSnapshot(
        await client.request("PUT", "/api/engineering-signals/watched-roots", {
          watchedRoots: roots,
        }),
      );
      if (!data) throw new Error("Invalid response");
      setSnapshot(data);
      setRoot("");
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={t("signals.title")}>
      <h2>{t("signals.title")}</h2>
      <p>{t("signals.intro")}</p>
      <p>{t("signals.privacy")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (snapshot && root.trim()) void updateRoots([...snapshot.watchedRoots, root.trim()]);
        }}
      >
        <label htmlFor="signals-root">{t("signals.root")}</label>
        <input
          id="signals-root"
          value={root}
          onChange={(event) => setRoot(event.target.value)}
          disabled={busy || !snapshot}
        />
        <button type="submit" disabled={busy || !snapshot || !root.trim()}>
          {t("signals.add")}
        </button>
      </form>
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        {t("signals.refresh")}
      </button>
      {error && <p role="alert">{t("signals.error")}</p>}
      {snapshot && (
        <>
          <ul>
            {snapshot.watchedRoots.map((path) => (
              <li key={path}>
                {path}{" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void updateRoots(snapshot.watchedRoots.filter((item) => item !== path))
                  }
                >
                  {t("signals.remove")}
                </button>
              </li>
            ))}
          </ul>
          {snapshot.watchedRoots.length === 0 ? (
            <p>{t("signals.unconfigured")}</p>
          ) : (
            <>
              {!snapshot.availability.advisories.available && (
                <p role="status">
                  {t("signals.unknown.advisories")} {snapshot.availability.advisories.reason ?? ""}
                </p>
              )}
              {!snapshot.availability.history.available && (
                <p role="status">
                  {t("signals.unknown.history")} {snapshot.availability.history.reason ?? ""}
                </p>
              )}
              {snapshot.signals.length === 0 ? (
                snapshot.availability.advisories.available &&
                snapshot.availability.history.available && <p>{t("signals.empty")}</p>
              ) : (
                <ul>
                  {snapshot.signals.map((signal) => (
                    <li key={signal.id}>
                      <strong>{t(labels[signal.kind])}</strong>: {signal.repo} — {signal.subject}:{" "}
                      {signal.detail}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p>{t("signals.optin")}</p>
        </>
      )}
    </section>
  );
}
