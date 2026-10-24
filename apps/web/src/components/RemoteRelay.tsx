// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useState } from "react";
import { useClient } from "../core/context";
import { formatDate } from "../core/format";
import { useAction } from "../core/hooks";
import { groupFingerprint, safeDeviceName, type PhoneDevice } from "../core/phone";
import {
  cleanRelayText,
  MAX_RELAY_URL,
  REMOTE_RELAY_PATH,
  relayUrlProblem,
  useRemoteRelay,
  type RelayUrlProblem,
  type RemoteRelayStatus,
} from "../core/remote-relay";
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const URL_PROBLEM: Record<RelayUrlProblem, MessageKey> = {
  empty: "relay.url.empty",
  tooLong: "relay.url.tooLong",
  notUrl: "relay.url.notUrl",
  https: "relay.url.https",
  credentials: "relay.url.credentials",
};

/**
 * Phase 87: the remote access relay. Off by default. Everything here is read from, and changed
 * through, the session-token `/api/remote-relay` routes; the relay's private key never leaves Core's
 * secret store, so it is never on this screen. The route id and Core's public key are shown only
 * while the "details" panel is open, held in no state beyond "which route is open", and hidden again
 * when the panel is closed, the relay is turned off or the route changes. Text that comes from the
 * relay or from a phone (an error, a device name) is cleaned and rendered as text.
 */
export function RemoteRelaySection() {
  const t = useT();
  const { load, applyStatus } = useRemoteRelay();
  return (
    <section className="card" aria-labelledby="remote-relay-h">
      <h2 id="remote-relay-h">{t("relay.title")}</h2>
      {load.phase === "loading" && <p className="small">{t("common.status.loading")}</p>}
      {load.phase === "absent" && <p className="small">{t("relay.notAvailable")}</p>}
      {load.phase === "failed" && <Feedback error={load.message ?? t("relay.loadFailed")} />}
      {load.phase === "ready" && <Relay status={load.status} onStatus={applyStatus} />}
    </section>
  );
}

function Relay({
  status,
  onStatus,
}: {
  status: RemoteRelayStatus;
  onStatus: (status: RemoteRelayStatus) => void;
}) {
  const t = useT();
  const ids = useId();
  const { run, busy, error } = useAction();
  const [draft, setDraft] = useState("");
  const [confirmingOff, setConfirmingOff] = useState(false);
  // The route whose details are open. Another route (or none) closes the panel.
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const detailsOpen = status.enabled && status.route !== null && openRoute === status.route;
  useEffect(() => {
    if (openRoute !== null && !detailsOpen) setOpenRoute(null);
  }, [openRoute, detailsOpen]);

  const draftText = draft.trim();
  const problem = draftText === "" ? null : relayUrlProblem(draftText);

  const enable = async () => {
    setMessage(null);
    if (relayUrlProblem(draftText) !== null) return;
    const next = await run<RemoteRelayStatus>("POST", REMOTE_RELAY_PATH, { url: draftText });
    if (next) {
      setDraft("");
      setOpenRoute(null);
      setMessage(t("relay.saved.on"));
      onStatus(next);
    }
  };
  const disable = async () => {
    setMessage(null);
    const next = await run<RemoteRelayStatus>("DELETE", REMOTE_RELAY_PATH);
    if (next) {
      setConfirmingOff(false);
      setOpenRoute(null);
      setMessage(t("relay.saved.off"));
      onStatus(next);
    }
  };

  return (
    <div>
      <p>{t("relay.intro")}</p>
      <div className="small">
        <p>
          <strong>{t("relay.privacy.title")}</strong>
        </p>
        <ul>
          <li>{t("relay.privacy.cannot")}</li>
          <li>{t("relay.privacy.sees")}</li>
          <li>{t("relay.privacy.tls")}</li>
        </ul>
      </div>

      <h3 className="h4">{t("relay.status.title")}</h3>
      <p role="status">
        {!status.enabled
          ? t("relay.status.off")
          : status.connected
            ? t("relay.status.connected")
            : t("relay.status.connecting")}
      </p>
      {status.enabled && status.url !== null && (
        <p className="small">
          {t("relay.status.url")} <code className="phone-mono">{status.url}</code>
        </p>
      )}
      {status.last_error !== null && cleanRelayText(status.last_error) !== "" && (
        <p className="error-text small">
          {t("relay.status.lastError", { message: cleanRelayText(status.last_error) })}
        </p>
      )}

      {!status.enabled ? (
        <div>
          <label className="field" htmlFor={`${ids}-url`}>
            {t("relay.enable.label")}
            <input
              id={`${ids}-url`}
              type="url"
              value={draft}
              maxLength={MAX_RELAY_URL + 1}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={problem !== null}
              aria-describedby={`${ids}-url-hint`}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <p id={`${ids}-url-hint`} className="muted small">
            {t("relay.enable.hint")}
          </p>
          {problem !== null && (
            <p className="error-text small" role="status">
              {t(URL_PROBLEM[problem])}
            </p>
          )}
          <p className="muted small">{t("relay.enable.note")}</p>
          <button
            type="button"
            className="btn"
            disabled={busy || draftText === "" || problem !== null}
            onClick={() => void enable()}
          >
            {t("relay.enable.button")}
          </button>
        </div>
      ) : confirmingOff ? (
        <div role="group" aria-label={t("relay.disable.ask")}>
          <p className="small">{t("relay.disable.ask")}</p>
          <div className="button-row wrap">
            <button type="button" className="btn" disabled={busy} onClick={() => void disable()}>
              {t("relay.disable.yes")}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmingOff(false)}>
              {t("relay.disable.no")}
            </button>
          </div>
        </div>
      ) : (
        <div className="button-row wrap">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => setConfirmingOff(true)}
          >
            {t("relay.disable.button")}
          </button>
          {status.route !== null && (
            <button
              type="button"
              className="btn"
              aria-expanded={detailsOpen}
              onClick={() => setOpenRoute(detailsOpen ? null : status.route)}
            >
              {detailsOpen ? t("relay.details.hide") : t("relay.details.show")}
            </button>
          )}
        </div>
      )}

      {detailsOpen && status.enabled && (
        <div role="region" aria-labelledby={`${ids}-details-h`}>
          <h3 id={`${ids}-details-h`} className="h4">
            {t("relay.details.title")}
          </h3>
          <p className="small">{t("relay.details.intro")}</p>
          <dl className="phone-facts small">
            <dt>{t("relay.details.url")}</dt>
            <dd>
              <code className="phone-mono">{status.url}</code>
            </dd>
            <dt>{t("relay.details.route")}</dt>
            <dd>
              <code className="phone-mono">{status.route}</code>
            </dd>
            <dt>{t("relay.details.key")}</dt>
            <dd>
              <code className="phone-mono">{status.core_public_key}</code>
            </dd>
          </dl>
          <p className="muted small">{t("relay.details.warn")}</p>
        </div>
      )}

      <Devices relayOn={status.enabled} onMessage={setMessage} />
      <Feedback error={error} saved={message} />
    </div>
  );
}

type DevicesLoad =
  { phase: "loading" } | { phase: "failed" } | { phase: "ready"; list: PhoneDevice[] };

function Devices({
  relayOn,
  onMessage,
}: {
  relayOn: boolean;
  onMessage: (message: string | null) => void;
}) {
  const t = useT();
  const client = useClient();
  const { run, busy, error } = useAction();
  const [load, setLoad] = useState<DevicesLoad>({ phase: "loading" });

  const reload = useCallback(async () => {
    try {
      const body = await client.request<{ devices: PhoneDevice[] }>("GET", "/api/phone/devices");
      setLoad({ phase: "ready", list: body.devices });
    } catch {
      setLoad({ phase: "failed" });
    }
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload, relayOn]);

  const name = (raw: string) => safeDeviceName(raw) || t("relay.devices.unnamed");
  const push = async (device: PhoneDevice) => {
    onMessage(null);
    const result = await run(
      "POST",
      `${REMOTE_RELAY_PATH}/devices/${encodeURIComponent(device.id)}/approvals`,
    );
    if (result) onMessage(t("relay.devices.pushed", { name: name(device.name) }));
  };

  return (
    <div>
      <h3 className="h4">{t("relay.devices.title")}</h3>
      {load.phase === "failed" && <Feedback error={t("relay.devices.loadFailed")} />}
      {load.phase === "ready" &&
        (load.list.length === 0 ? (
          <p className="muted small">{t("relay.devices.none")}</p>
        ) : (
          <>
            <p className="muted small">{t("relay.devices.note")}</p>
            <ul className="phone-devices">
              {load.list.map((device) => (
                <li key={device.id} className="phone-device">
                  <p>
                    <strong>{name(device.name)}</strong>
                  </p>
                  <p className="small">
                    {t("relay.devices.fingerprint")}{" "}
                    <code className="phone-mono">{groupFingerprint(device.key_fingerprint)}</code>
                  </p>
                  {device.revoked_at ? (
                    <p className="small">
                      {t("relay.devices.revoked", { date: formatDate(device.revoked_at) })}
                    </p>
                  ) : (
                    relayOn && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void push(device)}
                      >
                        {t("relay.devices.push", { name: name(device.name) })}
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          </>
        ))}
      <Feedback error={error} />
    </div>
  );
}
