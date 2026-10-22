// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState } from "react";
import { useClient } from "../core/context";
import { useAction } from "../core/hooks";
import { useT } from "../i18n";
import { Feedback } from "./Feedback";

const POLICY_PATH = "/api/events/source-policy";

/** Whether the local API may carry events that claim to come from the terminal. Off by default. */
export function EventSourcePolicySection() {
  const t = useT();
  const client = useClient();
  const { run, busy, error } = useAction();
  const [reserved, setReserved] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    client.request<{ reserveTerminal?: unknown }>("GET", POLICY_PATH).then(
      (policy) => {
        if (active) setReserved(policy.reserveTerminal === true);
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  const change = async (next: boolean) => {
    const saved = await run<{ reserveTerminal?: unknown }>("PUT", POLICY_PATH, {
      reserveTerminal: next,
    });
    if (saved) setReserved(saved.reserveTerminal === true);
  };

  return (
    <section className="card" aria-labelledby="event-source-h">
      <h2 id="event-source-h">{t("settings.eventSource.title")}</h2>
      <p>{t("settings.eventSource.intro")}</p>
      {loadFailed ? (
        <p className="error-text small" role="alert">
          {t("settings.eventSource.loadFailed")}
        </p>
      ) : (
        <label>
          <input
            type="checkbox"
            checked={reserved === true}
            disabled={busy || reserved === null}
            onChange={(event) => void change(event.target.checked)}
          />{" "}
          {t("settings.eventSource.reserve")}
        </label>
      )}
      <p className="small">{t("settings.eventSource.note")}</p>
      <Feedback error={error} />
    </section>
  );
}
