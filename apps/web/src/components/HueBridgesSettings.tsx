// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import type { ProvisionedLight } from "../core/schedule";
import {
  deviceText,
  formatFingerprint,
  HUE_BRIDGES_PATH,
  HUE_INSPECT_PATH,
  hueBridgeLightsPath,
  hueBridgePath,
  readBridgeLights,
  readBridges,
  readInspection,
  type HueBridge,
  type HueBridgeLight,
  type HueInspection,
  type LightAction,
} from "../core/status-lights";
import { useCoreResource } from "../core/schedule";
import { useT } from "../i18n";

const BRIDGE_NAME = /^[a-zA-Z0-9_.:-]{1,160}$/;

/**
 * Philips Hue (Phase 88). Pairing is two explicit steps. Step 1 asks Core to read the bridge's
 * certificate (nothing is sent to the bridge) and shows its address and SHA-256 fingerprint as text.
 * Step 2 happens only after the owner has pressed the link button on the bridge and ticked that
 * they checked the fingerprint; only then is the fingerprint pinned. The application key is stored
 * by Core and is never sent to, or shown in, this page. Names a bridge reports are shown as inert text.
 */
export function HueBridgesSettings({
  action,
  lights,
  addLight,
}: {
  action: LightAction;
  lights: readonly ProvisionedLight[];
  addLight(light: ProvisionedLight): Promise<boolean>;
}) {
  const t = useT();
  const { data: bridges, status, reload } = useCoreResource(HUE_BRIDGES_PATH, readBridges);
  const { run, busy } = action;
  const confirmId = useId();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [inspected, setInspected] = useState<HueInspection | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [found, setFound] = useState<{ bridge: string; lights: HueBridgeLight[] } | null>(null);

  const lookUp = async (event: FormEvent) => {
    event.preventDefault();
    setInspected(null);
    setConfirmed(false);
    if (!BRIDGE_NAME.test(name.trim())) {
      action.fail("statusLights.error.hueName");
      return;
    }
    const raw = await run<unknown>(
      "POST",
      HUE_INSPECT_PATH,
      { address: address.trim() },
      "statusLights.error.hueInspect",
    );
    if (raw === undefined) return;
    const next = readInspection(raw);
    if (next === null) action.fail("statusLights.error.hueInspect");
    else setInspected(next);
  };

  const pair = async () => {
    // The gate: nothing is pinned or paired unless the owner ticked the confirmation for THIS fingerprint.
    if (inspected === null || !confirmed) return;
    const saved = await run(
      "POST",
      HUE_BRIDGES_PATH,
      {
        id: name.trim(),
        address: inspected.address,
        port: inspected.port,
        fingerprint: inspected.fingerprint,
      },
      "statusLights.error.huePair",
    );
    if (saved === undefined) return;
    setInspected(null);
    setConfirmed(false);
    setName("");
    setAddress("");
    await reload();
  };

  const cancel = () => {
    setInspected(null);
    setConfirmed(false);
  };

  const remove = async (bridge: HueBridge) => {
    const done = await run("DELETE", hueBridgePath(bridge.id), {}, "statusLights.error.hueRemove");
    if (done === undefined) return;
    if (found?.bridge === bridge.id) setFound(null);
    await reload();
  };

  const findLights = async (bridge: HueBridge) => {
    const raw = await run<unknown>(
      "GET",
      hueBridgeLightsPath(bridge.id),
      undefined,
      "statusLights.error.hueLights",
    );
    if (raw === undefined) return;
    const list = readBridgeLights(raw);
    if (list === null) action.fail("statusLights.error.hueLights");
    else setFound({ bridge: bridge.id, lights: list });
  };

  const addHueLight = (bridge: string, light: HueBridgeLight) =>
    addLight({
      id: `hue-${bridge}-${light.id.slice(0, 8)}`,
      kind: "hue",
      bridge,
      resource: light.id,
    });

  return (
    <div aria-labelledby="status-lights-hue-h" role="group">
      <h3 className="h3" id="status-lights-hue-h">
        {t("statusLights.hue.title")}
      </h3>
      {status === "absent" && <p className="muted small">{t("statusLights.hue.notAvailable")}</p>}
      {status === "failed" && bridges === null && (
        <p className="error-text small" role="alert">
          {t("statusLights.hue.loadFailed")}
        </p>
      )}
      {bridges !== null && (
        <>
          <p className="small">{t("statusLights.hue.intro")}</p>
          {bridges.length === 0 ? (
            <p className="muted small">{t("statusLights.hue.empty")}</p>
          ) : (
            <ul className="card-list">
              {bridges.map((bridge) => {
                const shown = deviceText(bridge.id);
                const here = found?.bridge === bridge.id ? found.lights : null;
                return (
                  <li key={bridge.id}>
                    <strong>{shown}</strong>{" "}
                    <span className="small">
                      {t("statusLights.hue.bridgeLine", {
                        address: deviceText(bridge.address),
                        port: bridge.port,
                      })}
                    </span>
                    <div className="small">
                      {t("statusLights.hue.fingerprint")}{" "}
                      <code>{formatFingerprint(bridge.fingerprint)}</code>
                    </div>{" "}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={t("statusLights.hue.findNamed", { name: shown })}
                      onClick={() => void findLights(bridge)}
                    >
                      {t("statusLights.hue.find")}
                    </button>{" "}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={t("statusLights.hue.removeNamed", { name: shown })}
                      onClick={() => void remove(bridge)}
                    >
                      {t("statusLights.hue.remove")}
                    </button>
                    {here !== null &&
                      (here.length === 0 ? (
                        <p className="muted small">{t("statusLights.hue.noLights")}</p>
                      ) : (
                        <ul className="card-list">
                          {here.map((light) => {
                            const label = deviceText(light.name) || deviceText(light.id);
                            const added = lights.some(
                              (l) =>
                                l.kind === "hue" &&
                                l.bridge === bridge.id &&
                                l.resource === light.id,
                            );
                            return (
                              <li key={light.id}>
                                <span>{label}</span>{" "}
                                {added ? (
                                  <span className="muted small">
                                    {t("statusLights.hue.alreadyAdded")}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={busy}
                                    aria-label={t("statusLights.hue.addNamed", { name: label })}
                                    onClick={() => void addHueLight(bridge.id, light)}
                                  >
                                    {t("statusLights.hue.add")}
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="small">{t("statusLights.hue.removeNote")}</p>
          <h4 className="h3">{t("statusLights.hue.pairTitle")}</h4>
          <form onSubmit={(event) => void lookUp(event)}>
            <label>
              {t("statusLights.hue.name")}{" "}
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
            </label>{" "}
            <label>
              {t("statusLights.hue.address")}{" "}
              <input
                type="text"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setInspected(null);
                  setConfirmed(false);
                }}
              />
            </label>{" "}
            <button type="submit" className="btn" disabled={busy}>
              {t("statusLights.hue.lookup")}
            </button>
          </form>
          {inspected !== null && (
            <div role="group" aria-label={t("statusLights.hue.confirmGroup")}>
              <p>
                {t("statusLights.hue.found", {
                  address: deviceText(inspected.address),
                  port: inspected.port,
                })}
              </p>
              <p>
                {t("statusLights.hue.fingerprint")}{" "}
                <code data-testid="hue-fingerprint">
                  {formatFingerprint(inspected.fingerprint)}
                </code>
              </p>
              {inspected.commonName !== null && (
                <p className="small">
                  {t("statusLights.hue.certName", { name: deviceText(inspected.commonName) })}
                </p>
              )}
              <p className="warning-text small" role="note">
                {t("statusLights.hue.linkStep")}
              </p>
              <p>
                <input
                  id={confirmId}
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />{" "}
                <label htmlFor={confirmId}>{t("statusLights.hue.confirm")}</label>
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !confirmed}
                onClick={() => void pair()}
              >
                {t("statusLights.hue.pair")}
              </button>{" "}
              <button type="button" className="btn" disabled={busy} onClick={cancel}>
                {t("statusLights.hue.cancel")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
