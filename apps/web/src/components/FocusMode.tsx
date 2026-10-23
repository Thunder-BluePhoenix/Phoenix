// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useState } from "react";
import { useAction } from "../core/hooks";
import { useClient } from "../core/context";
import { useT } from "../i18n";

interface FocusSnapshot {
  manual: boolean;
  osDnd: boolean | null;
  active: boolean;
  remainingMs: number | null;
  held: number;
}

const isFocusSnapshot = (value: unknown): value is FocusSnapshot => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (
    !("manual" in value) ||
    !("osDnd" in value) ||
    !("active" in value) ||
    !("remainingMs" in value) ||
    !("held" in value)
  ) {
    return false;
  }
  return (
    typeof value.manual === "boolean" &&
    (value.osDnd === null || typeof value.osDnd === "boolean") &&
    typeof value.active === "boolean" &&
    (value.remainingMs === null || typeof value.remainingMs === "number") &&
    typeof value.held === "number"
  );
};

/** Settings controls for Phoenix's own notification delivery gate; it does not control system DND. */
export function FocusMode() {
  const client = useClient();
  const t = useT();
  const { run, busy, error } = useAction();
  const [snapshot, setSnapshot] = useState<FocusSnapshot | null>(null);
  const [minutes, setMinutes] = useState("25");

  const reload = useCallback(async () => {
    const response = await client.request<unknown>("GET", "/api/focus");
    if (isFocusSnapshot(response)) setSnapshot(response);
  }, [client]);

  useEffect(() => {
    void reload().catch(() => undefined);
    // A reconnect (also after a Core restart) re-reads the status; the session is kept by Core.
    const offStatus = client.statusChanged.on(
      (s) => s === "online" && void reload().catch(() => undefined),
    );
    const update = window.setInterval(() => void reload().catch(() => undefined), 30_000);
    return () => {
      offStatus();
      window.clearInterval(update);
    };
  }, [client, reload]);

  const start = async (pomodoro: boolean) => {
    const value = pomodoro ? Number(minutes) : undefined;
    const response = await run("POST", "/api/focus", value === undefined ? {} : { minutes: value });
    if (isFocusSnapshot(response)) setSnapshot(response);
  };
  const stop = async () => {
    const response = await run("DELETE", "/api/focus");
    if (isFocusSnapshot(response)) setSnapshot(response);
  };
  const validPomodoro =
    Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 1440;

  return (
    <section className="card" aria-labelledby="focus-h">
      <h2 id="focus-h">{t("focus.title")}</h2>
      <p>{t("focus.systemUnavailable")}</p>
      {snapshot !== null && (
        <>
          <p role="status">{t(snapshot.active ? "focus.active" : "focus.inactive")}</p>
          <p>{t("focus.held", { count: snapshot.held })}</p>
          {snapshot.manual && snapshot.remainingMs !== null && (
            <p>{t("focus.remaining", { count: Math.ceil(snapshot.remainingMs / 60_000) })}</p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {snapshot?.manual ? (
        <button type="button" disabled={busy} onClick={() => void stop()}>
          {t("focus.stop")}
        </button>
      ) : (
        <>
          <button type="button" disabled={busy} onClick={() => void start(false)}>
            {t("focus.start")}
          </button>
          <label>
            {t("focus.minutes")}
            <input
              type="number"
              min="1"
              max="1440"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </label>
          <button type="button" disabled={busy || !validPomodoro} onClick={() => void start(true)}>
            {t("focus.pomodoro")}
          </button>
        </>
      )}
    </section>
  );
}
