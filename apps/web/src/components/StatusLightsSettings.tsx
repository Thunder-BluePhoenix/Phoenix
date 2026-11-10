// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState, type FormEvent } from "react";
import { useCapabilities } from "../core/hooks";
import {
  consentedIds,
  lightBody,
  readLights,
  STATUS_LIGHTS_PATH,
  useCoreResource,
  type ProvisionedLight,
} from "../core/schedule";
import { deviceText, readQuietHours, useLightAction, type QuietHours } from "../core/status-lights";
import { useT } from "../i18n";
import { HueBridgesSettings } from "./HueBridgesSettings";
import { LifxDiscovery, LuxaforAdd, LuxaforToken, QuietHoursControl } from "./StatusLightsParts";

const CAPABILITY_PATH = "/api/capabilities/status-lights";

/**
 * Status lights (Phase 88). Where a light is (an address on this network, or a paired Hue bridge)
 * and whether Fawkes may use it are two separate settings: the light list here, and the `devices`
 * setting of the status-lights capability. Nothing is contacted until both exist and the capability
 * is enabled. No credential is shown anywhere in this section: Hue keys and Luxafor tokens are
 * write-only, and every error is a fixed, translated text (never Core's or a device's own words).
 */
export function StatusLightsSection() {
  const t = useT();
  const { data: lights, status, apply } = useCoreResource(STATUS_LIGHTS_PATH, readLights);
  const { data: capabilities, reload: reloadCapabilities } = useCapabilities();
  const action = useLightAction();
  const { run, busy, error } = action;
  const [id, setId] = useState("");
  const [address, setAddress] = useState("");

  const capability = capabilities.find((c) => c.id === "status-lights");
  const enabled = capability?.status === "enabled";
  const consented = consentedIds(capability?.config);
  const quiet = readQuietHours(capability?.config);

  const replace = async (next: readonly ProvisionedLight[]) => {
    const saved = await run(
      "PUT",
      STATUS_LIGHTS_PATH,
      { lights: next.map(lightBody) },
      "statusLights.error.save",
    );
    if (saved === undefined) return false;
    apply(saved);
    return true;
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const added: ProvisionedLight = {
      id: id.trim(),
      kind: "key-light",
      address: address.trim(),
      port: null,
    };
    if (await replace([...(lights ?? []), added])) {
      setId("");
      setAddress("");
    }
  };

  const restart = async () => {
    // A running capability reads its settings when it starts, so it is restarted to apply a change.
    if (!enabled) return;
    if (
      (await run("POST", `${CAPABILITY_PATH}/disable`, {}, "statusLights.error.capability")) !==
      undefined
    )
      await run("POST", `${CAPABILITY_PATH}/enable`, {}, "statusLights.error.capability");
  };

  const allow = async (lightId: string, on: boolean) => {
    if (capability === undefined) return;
    const devices = on
      ? [...consented.filter((other) => other !== lightId), lightId]
      : consented.filter((other) => other !== lightId);
    const saved = await run(
      "POST",
      `${CAPABILITY_PATH}/config`,
      { config: { ...capability.config, devices } },
      "statusLights.error.capability",
    );
    if (saved !== undefined) await restart();
    reloadCapabilities();
  };

  const saveQuiet = async (hours: QuietHours | null) => {
    if (capability === undefined) return;
    const { quiet_hours: _old, ...rest } = capability.config ?? {};
    const saved = await run(
      "POST",
      `${CAPABILITY_PATH}/config`,
      { config: hours === null ? rest : { ...rest, quiet_hours: hours } },
      "statusLights.error.capability",
    );
    if (saved !== undefined) await restart();
    reloadCapabilities();
  };

  const enable = async () => {
    await run("POST", `${CAPABILITY_PATH}/enable`, {}, "statusLights.error.capability");
    reloadCapabilities();
  };

  const lineKey = (light: ProvisionedLight) =>
    light.kind === "lifx"
      ? "awakeSchedule.lights.lineLifx"
      : light.kind === "luxafor"
        ? "statusLights.line.luxafor"
        : light.kind === "hue"
          ? "statusLights.line.hue"
          : "awakeSchedule.lights.line";

  return (
    <section className="card" aria-labelledby="status-lights-h">
      <h2 id="status-lights-h">{t("awakeSchedule.lights.title")}</h2>
      {status === "absent" && <p className="muted">{t("awakeSchedule.lights.notAvailable")}</p>}
      {status === "failed" && lights === null && (
        <p className="error-text small" role="alert">
          {t("awakeSchedule.lights.loadFailed")}
        </p>
      )}
      {status === "loading" && <p className="muted small">{t("awakeSchedule.loading")}</p>}
      {lights !== null && (
        <>
          <p>{t("awakeSchedule.lights.intro")}</p>
          <p className="small">{t("statusLights.limits")}</p>
          {!enabled && (
            <p className="warning-text small" role="note">
              {t("awakeSchedule.lights.capabilityOff")}{" "}
              {capability !== undefined && capability.status !== "disconnected" && (
                <button type="button" className="btn" disabled={busy} onClick={() => void enable()}>
                  {t("awakeSchedule.lights.enable")}
                </button>
              )}
            </p>
          )}
          {lights.length === 0 ? (
            <p className="muted small">{t("awakeSchedule.lights.empty")}</p>
          ) : (
            <ul className="card-list">
              {lights.map((light) => {
                const name = deviceText(light.id);
                return (
                  <li key={light.id}>
                    <strong>{name}</strong>{" "}
                    <span className="small">
                      {t(lineKey(light), {
                        address: light.kind === "hue" ? "" : deviceText(light.address),
                        bridge: light.kind === "hue" ? deviceText(light.bridge) : "",
                      })}
                    </span>{" "}
                    <label>
                      <input
                        type="checkbox"
                        checked={consented.includes(light.id)}
                        disabled={busy || capability === undefined}
                        aria-label={t("awakeSchedule.lights.allowNamed", { name })}
                        onChange={(event) => void allow(light.id, event.target.checked)}
                      />{" "}
                      {t("awakeSchedule.lights.allow")}
                    </label>{" "}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={t("awakeSchedule.lights.removeNamed", { name })}
                      onClick={() => void replace(lights.filter((other) => other.id !== light.id))}
                    >
                      {t("awakeSchedule.lights.remove")}
                    </button>
                    {light.kind === "luxafor" && <LuxaforToken light={light} action={action} />}
                  </li>
                );
              })}
            </ul>
          )}
          <h3 className="h3">{t("awakeSchedule.lights.add.title")}</h3>
          <form onSubmit={(event) => void add(event)}>
            <label>
              {t("awakeSchedule.lights.add.id")}{" "}
              <input type="text" value={id} onChange={(event) => setId(event.target.value)} />
            </label>{" "}
            <label>
              {t("awakeSchedule.lights.add.address")}{" "}
              <input
                type="text"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>{" "}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t("awakeSchedule.lights.add.submit")}
            </button>
          </form>
          <HueBridgesSettings
            action={action}
            lights={lights}
            addLight={(light) => replace([...lights, light])}
          />
          <h3 className="h3">{t("statusLights.luxafor.title")}</h3>
          <p className="small">{t("statusLights.luxafor.intro")}</p>
          <LuxaforAdd busy={busy} onAdd={(light) => replace([...lights, light])} />
          <LifxDiscovery
            action={action}
            lights={lights}
            onAdd={(light) => replace([...lights, light])}
          />
          <QuietHoursControl
            key={quiet === null ? "none" : `${quiet.timezone}|${quiet.start}|${quiet.end}`}
            current={quiet}
            busy={busy}
            disabled={capability === undefined}
            onSave={saveQuiet}
            onFail={action.fail}
          />
        </>
      )}
      {error !== null && (
        <p className="error-text small" role="alert">
          {t(error)}
        </p>
      )}
    </section>
  );
}
