// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState } from "react";
import type {
  FocusController,
  FocusNotification,
  FocusSnapshot,
} from "../../../../core/runtime/src/focus";
import { useT } from "../i18n";

/** The host supplies its notification-delivery controller and read-only OS DND adapter. */
export function FocusMode({ controller }: { controller: FocusController<FocusNotification> }) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<FocusSnapshot>(() => controller.snapshot());
  const [minutes, setMinutes] = useState("");
  useEffect(() => {
    const update = () => setSnapshot(controller.snapshot());
    const unsubscribe = controller.subscribe(update);
    void controller.refreshDnd();
    return unsubscribe;
  }, [controller]);
  const timed = snapshot.manual && snapshot.remainingMs !== null;
  useEffect(() => {
    if (!timed) return;
    const interval = window.setInterval(() => setSnapshot(controller.snapshot()), 30_000);
    return () => window.clearInterval(interval);
  }, [controller, timed]);
  return (
    <section aria-label={t("focus.title")}>
      <h2>{t("focus.title")}</h2>
      <p role="status">{t(snapshot.active ? "focus.active" : "focus.inactive")}</p>
      <p>{t("focus.held", { count: snapshot.held })}</p>
      {snapshot.osDnd === true && <p>{t("focus.osDnd")}</p>}
      {snapshot.osDnd === null && <p>{t("focus.osUnknown")}</p>}
      {snapshot.manual && snapshot.remainingMs !== null && (
        <p>{t("focus.remaining", { count: Math.ceil(snapshot.remainingMs / 60_000) })}</p>
      )}
      <button type="button" onClick={() => void controller.refreshDnd()}>
        {t("focus.refresh")}
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
      {snapshot.manual ? (
        <button type="button" onClick={() => controller.stop()}>
          {t("focus.stop")}
        </button>
      ) : (
        <button
          type="button"
          disabled={
            minutes !== "" &&
            (!Number.isInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 1440)
          }
          onClick={() => controller.start(minutes === "" ? undefined : Number(minutes))}
        >
          {t("focus.start")}
        </button>
      )}
    </section>
  );
}
