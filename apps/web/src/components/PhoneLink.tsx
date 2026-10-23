// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useState } from "react";
import { useClient } from "../core/context";
import { formatAgo, formatDate, formatTime } from "../core/format";
import { useAction } from "../core/hooks";
import {
  groupCode,
  groupFingerprint,
  hostPort,
  parsePhonePort,
  PHONE_POLL_MS,
  safeDeviceName,
  usePhoneNow,
  type PhoneDevice,
  type PhonePairingCode,
  type PhoneStatus,
} from "../core/phone";
import { useT } from "../i18n";
import { formatRemaining } from "./AgentApprovals";
import { Feedback } from "./Feedback";
import { QrImage } from "./QrImage";

/**
 * Phone link: lets a phone on the local network pair with this computer and approve things.
 * Off by default. The pairing code lives only in this component's state: it is never stored,
 * logged or sent anywhere else, and it is dropped when it expires, is cancelled or is used.
 */
export function PhoneLink() {
  const t = useT();
  const client = useClient();
  const { run, busy, error } = useAction();
  const ids = useId();
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [devices, setDevices] = useState<PhoneDevice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState<PhonePairingCode | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pickedAddress, setPickedAddress] = useState<string | null>(null);
  const [portDraft, setPortDraft] = useState<string | null>(null);

  const lockedIso = status?.locked_out_until ?? null;
  const now = usePhoneNow(code !== null || lockedIso !== null || status?.pairing != null);
  const locked = lockedIso !== null && Date.parse(lockedIso) > now;
  const codeLeft = code ? Date.parse(code.expires_at) - now : 0;
  const codeExpired = code !== null && !(codeLeft > 0);

  const reload = useCallback(async () => {
    try {
      setStatus(await client.request<PhoneStatus>("GET", "/api/phone/status"));
      setLoadError(null);
    } catch {
      setLoadError(t("phone.unavailable"));
    }
  }, [client, t]);
  const reloadDevices = useCallback(async () => {
    try {
      const list = await client.request<{ devices: PhoneDevice[] }>("GET", "/api/phone/devices");
      setDevices(list.devices);
    } catch {
      // The device list is secondary; the status above reports an unreachable Core.
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);
  const deviceCount = status?.devices;
  useEffect(() => {
    void reloadDevices();
  }, [reloadDevices, deviceCount]);

  const pending = status?.pending_pair ?? null;
  const polling =
    status !== null && (status.pairing !== null || pending !== null || code !== null || locked);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => void reload(), PHONE_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, reload]);

  // A code that ran out, a request that arrived (the code is spent) or a closed listener: forget it.
  const listening = status?.listening === true && !status.kill_switch;
  useEffect(() => {
    if (codeExpired) {
      setCode(null);
      setMessage(t("phone.pair.expired"));
    }
  }, [codeExpired, t]);
  const spent = pending !== null || !listening;
  useEffect(() => {
    if (spent) setCode(null);
  }, [spent]);

  const change = async (body: object, success: string): Promise<boolean> => {
    setMessage(null);
    const next = await run<PhoneStatus>("POST", "/api/phone/settings", body);
    if (!next) return false;
    setStatus(next);
    setMessage(success);
    // A new address or port reopens the listener: a code shown for the old one no longer works.
    if ("port" in body || "address" in body) setCode(null);
    return true;
  };
  const showCode = async () => {
    setMessage(null);
    const issued = await run<PhonePairingCode>("POST", "/api/phone/pairing");
    if (issued) {
      setCode(issued);
      await reload();
    }
  };
  const cancelCode = async () => {
    setMessage(null);
    const result = await run("DELETE", "/api/phone/pairing");
    if (result) {
      setCode(null);
      setMessage(t("phone.pair.cancelled"));
      await reload();
    }
  };
  const decide = async (confirmationId: string, approve: boolean) => {
    setMessage(null);
    const result = await run("POST", `/api/confirmations/${encodeURIComponent(confirmationId)}`, {
      approve,
    });
    if (result) {
      setMessage(t(approve ? "phone.pending.approved" : "phone.pending.rejected"));
      await reload();
      await reloadDevices();
    }
  };
  const revoke = async (id: string) => {
    setMessage(null);
    const result = await run("DELETE", `/api/phone/devices/${encodeURIComponent(id)}`);
    if (result) {
      setRevoking(null);
      setMessage(t("phone.devices.revokedDone"));
      await reload();
      await reloadDevices();
    }
  };

  const portText = portDraft ?? String(status?.configured_port ?? "");
  const portValue = parsePhonePort(portText);
  const savePort = async () => {
    if (portValue === null) return;
    const saved = await change({ port: portValue }, t("phone.saved.port", { port: portValue }));
    if (saved) setPortDraft(null);
  };
  const addressGone =
    status !== null &&
    status.enabled &&
    !status.kill_switch &&
    !status.listening &&
    status.off_reason === "address_changed";
  const addressChoice =
    pickedAddress !== null && status?.addresses.includes(pickedAddress)
      ? pickedAddress
      : (status?.addresses[0] ?? null);
  const useAddress = async () => {
    if (addressChoice === null) return;
    await change({ address: addressChoice }, t("phone.saved.address"));
  };

  const name = (raw: string) => safeDeviceName(raw) || t("phone.device.unnamed");
  const warningId = `${ids}-warning`;

  return (
    <section aria-labelledby={`${ids}-h`} className="card phone-link">
      <h2 id={`${ids}-h`} className="h3">
        {t("phone.title")}
      </h2>
      <p className="muted small">{t("phone.intro")}</p>
      {loadError && <Feedback error={loadError} />}
      {status && (
        <>
          <div id={warningId} className="phone-warning small">
            <p>
              <strong>{t("phone.warning.title")}</strong>
            </p>
            <ul>
              <li>{t("phone.warning.network")}</li>
              <li>{t("phone.warning.pairing")}</li>
              <li>{t("phone.warning.trust")}</li>
              <li>{t("phone.warning.presence")}</li>
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
                  t(e.target.checked ? "phone.saved.on" : "phone.saved.off"),
                )
              }
            />
            {t("phone.enable.label")}
          </label>

          {status.kill_switch && (
            <p className="error-text small" role="status">
              {t("phone.killSwitch")}
            </p>
          )}
          {locked && lockedIso && (
            <p className="error-text small" role="status">
              {t("phone.lockedOut", { time: formatTime(lockedIso) })}
            </p>
          )}
          {addressGone ? (
            <div className="card phone-address-changed" role="alert">
              <p>
                <strong>{t("phone.addressChanged.title")}</strong>
              </p>
              <p className="small">{t("phone.addressChanged")}</p>
              <p className="small">{t("phone.addressChanged.mayNotReach")}</p>
              {status.addresses.length > 0 && addressChoice !== null ? (
                <div className="button-row wrap">
                  <label className="small">
                    {t("phone.addressChanged.pick")}{" "}
                    <select
                      value={addressChoice}
                      disabled={busy}
                      onChange={(e) => setPickedAddress(e.target.value)}
                    >
                      {status.addresses.map((address) => (
                        <option key={address} value={address}>
                          {address}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => void useAddress()}
                  >
                    {t("phone.addressChanged.use")}
                  </button>
                </div>
              ) : (
                <p className="small">{t("phone.addressChanged.none")}</p>
              )}
              <p className="muted small">{t("phone.addressChanged.repair")}</p>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => void change({ enabled: false }, t("phone.saved.off"))}
              >
                {t("phone.addressChanged.off")}
              </button>
            </div>
          ) : (
            status.enabled &&
            !status.kill_switch &&
            !status.listening && (
              <p className="small" role="status">
                {t("phone.notListening")}
              </p>
            )
          )}

          {listening && (
            <dl className="phone-facts small">
              <dt>{t("phone.listen.address")}</dt>
              <dd>
                <code className="phone-mono">
                  {status.address ? hostPort(status.address, status.port) : ""}
                </code>
              </dd>
              <dt>{t("phone.listen.fingerprint")}</dt>
              <dd>
                <code className="phone-mono">
                  {status.fingerprint ? groupFingerprint(status.fingerprint) : ""}
                </code>
              </dd>
            </dl>
          )}

          <div aria-live="assertive" aria-atomic="true" className="phone-pending-region">
            {pending && (
              <div className="card phone-pending">
                <p>
                  <strong>{t("phone.pending.question", { name: name(pending.name) })}</strong>
                </p>
                <p className="small">
                  {t("phone.pending.fingerprint")}{" "}
                  <code className="phone-mono">{groupFingerprint(pending.key_fingerprint)}</code>
                </p>
                {pending.confirmation_id ? (
                  <div className="button-row wrap">
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(pending.confirmation_id!, true)}
                    >
                      {t("phone.pending.yes")}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(pending.confirmation_id!, false)}
                    >
                      {t("phone.pending.no")}
                    </button>
                  </div>
                ) : (
                  <p className="muted small">{t("phone.pending.waiting")}</p>
                )}
              </div>
            )}
          </div>

          {listening && (
            <div className="phone-pairing">
              {code && codeLeft > 0 ? (
                <>
                  <p className="small">{t("phone.pair.instruction")}</p>
                  <p className="phone-code" aria-label={t("phone.pair.codeLabel")}>
                    <code className="phone-mono phone-code-text">{groupCode(code.code)}</code>
                  </p>
                  <p className="small">
                    <span role="timer">
                      {t("phone.pair.remaining", { time: formatRemaining(codeLeft) })}
                    </span>
                  </p>
                  <p className="small">
                    {t("phone.pair.fingerprint")}{" "}
                    <code className="phone-mono">{groupFingerprint(code.fingerprint)}</code>
                  </p>
                  <div className="phone-qr">
                    <QrImage
                      text={code.uri}
                      label={t("phone.pair.qrLabel")}
                      fallback={t("phone.pair.qrUnavailable")}
                    />
                    <p className="muted small">{t("phone.pair.qrHint")}</p>
                  </div>
                  <p className="small">
                    {t("phone.pair.link")} <code className="phone-mono phone-uri">{code.uri}</code>
                  </p>
                </>
              ) : (
                status.pairing &&
                Date.parse(status.pairing.expires_at) > now && (
                  <p className="small">
                    {t("phone.pair.hiddenActive", { time: formatTime(status.pairing.expires_at) })}
                  </p>
                )
              )}
              <div className="button-row wrap">
                <button
                  className="btn"
                  type="button"
                  disabled={busy || locked}
                  onClick={() => void showCode()}
                >
                  {t("phone.pair.show")}
                </button>
                {(code || (status.pairing && Date.parse(status.pairing.expires_at) > now)) && (
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelCode()}
                  >
                    {t("phone.pair.cancel")}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="phone-port">
            <label className="small" htmlFor={`${ids}-port`}>
              {t("phone.port.label")}
            </label>{" "}
            <input
              id={`${ids}-port`}
              type="text"
              inputMode="numeric"
              value={portText}
              disabled={busy}
              aria-invalid={portValue === null}
              aria-describedby={`${ids}-port-note`}
              onChange={(e) => setPortDraft(e.target.value)}
            />{" "}
            <button
              className="btn"
              type="button"
              disabled={busy || portValue === null || portValue === status.configured_port}
              onClick={() => void savePort()}
            >
              {t("phone.port.save")}
            </button>
            {portValue === null && (
              <p className="error-text small" role="status">
                {t("phone.port.invalid")}
              </p>
            )}
            <p id={`${ids}-port-note`} className="muted small">
              {t("phone.port.note")}
            </p>
          </div>

          <label className="choice">
            <input
              type="checkbox"
              checked={status.require_user_verification}
              disabled={busy}
              aria-describedby={`${ids}-verify`}
              onChange={(e) =>
                void change(
                  { require_user_verification: e.target.checked },
                  t(e.target.checked ? "phone.saved.verifyOn" : "phone.saved.verifyOff"),
                )
              }
            />
            {t("phone.verify.label")}
          </label>
          <p id={`${ids}-verify`} className="muted small">
            {t("phone.verify.note")}
          </p>

          <h3 className="h4">{t("phone.devices.title")}</h3>
          {devices.length === 0 ? (
            <p className="muted small">{t("phone.devices.none")}</p>
          ) : (
            <ul className="phone-devices">
              {devices.map((device) => (
                <li key={device.id} className="phone-device">
                  <p>
                    <strong>{name(device.name)}</strong>
                  </p>
                  <p className="small">
                    {t("phone.devices.fingerprint")}{" "}
                    <code className="phone-mono">{groupFingerprint(device.key_fingerprint)}</code>
                  </p>
                  <p className="muted small">
                    {t("phone.devices.created", { date: formatDate(device.created_at) })}
                    {" · "}
                    {device.last_seen_at
                      ? t("phone.devices.lastSeen", { when: formatAgo(device.last_seen_at) })
                      : t("phone.devices.neverSeen")}
                  </p>
                  {device.revoked_at ? (
                    <p className="small">
                      {t("phone.devices.revoked", { date: formatDate(device.revoked_at) })}
                    </p>
                  ) : revoking === device.id ? (
                    <div
                      role="group"
                      aria-label={t("phone.devices.revokeAsk", { name: name(device.name) })}
                    >
                      <p className="small">
                        {t("phone.devices.revokeAsk", { name: name(device.name) })}
                      </p>
                      <div className="button-row wrap">
                        <button
                          className="btn"
                          type="button"
                          disabled={busy}
                          onClick={() => void revoke(device.id)}
                        >
                          {t("phone.devices.revokeYes")}
                        </button>
                        <button className="btn" type="button" onClick={() => setRevoking(null)}>
                          {t("phone.devices.revokeNo")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() => setRevoking(device.id)}
                    >
                      {t("phone.devices.revoke", { name: name(device.name) })}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Feedback error={error} saved={message} />
    </section>
  );
}
