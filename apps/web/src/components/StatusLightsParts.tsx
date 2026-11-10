// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import type { ProvisionedLight } from "../core/schedule";
import {
  deviceText,
  LIFX_DISCOVER_PATH,
  luxaforTokenPath,
  readLifxFound,
  validQuietHours,
  type LifxFound,
  type LightAction,
  type LightErrorKey,
  type QuietHours,
} from "../core/status-lights";
import { useT } from "../i18n";

/**
 * Luxafor's webhook token. The field is write-only: Core never returns the token, so this page has
 * nothing to show, and what is typed is dropped from the page as soon as it has been sent (whether
 * or not Core accepted it). Removing the light is what deletes the stored token.
 */
export function LuxaforToken({ light, action }: { light: ProvisionedLight; action: LightAction }) {
  const t = useT();
  const [token, setToken] = useState("");
  const [stored, setStored] = useState(false);
  const { run, busy } = action;
  const shown = deviceText(light.id);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const sent = token;
    setToken("");
    if (sent === "") return;
    const done = await run(
      "PUT",
      luxaforTokenPath(light.id),
      { token: sent },
      "statusLights.error.luxaforToken",
    );
    setStored(done !== undefined);
  };

  return (
    <form onSubmit={(event) => void save(event)} className="small">
      <label>
        {t("statusLights.luxafor.token")}{" "}
        <input
          type="password"
          value={token}
          autoComplete="off"
          spellCheck={false}
          aria-label={t("statusLights.luxafor.tokenNamed", { name: shown })}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>{" "}
      <button type="submit" className="btn" disabled={busy || token === ""}>
        {t("statusLights.luxafor.save")}
      </button>
      <span className="muted" role="status">
        {" "}
        {stored ? t("statusLights.luxafor.saved") : null}
      </span>
      <div className="muted">{t("statusLights.luxafor.writeOnly")}</div>
    </form>
  );
}

/** Adds a Luxafor light: the machine that runs the Luxafor app, by IPv4 literal. The token is a separate step. */
export function LuxaforAdd({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd(light: ProvisionedLight): Promise<boolean>;
}) {
  const t = useT();
  const [id, setId] = useState("");
  const [address, setAddress] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const added: ProvisionedLight = {
      id: id.trim(),
      kind: "luxafor",
      address: address.trim(),
      port: null,
    };
    if (await onAdd(added)) {
      setId("");
      setAddress("");
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <label>
        {t("statusLights.luxafor.name")}{" "}
        <input type="text" value={id} onChange={(event) => setId(event.target.value)} />
      </label>{" "}
      <label>
        {t("statusLights.luxafor.address")}{" "}
        <input type="text" value={address} onChange={(event) => setAddress(event.target.value)} />
      </label>{" "}
      <button type="submit" className="btn" disabled={busy}>
        {t("statusLights.luxafor.add")}
      </button>
    </form>
  );
}

/**
 * LIFX discovery: one button, one broadcast, a list. Everything listed is text. A light is added
 * only by its own explicit button; discovery itself provisions nothing and sends no colour.
 */
export function LifxDiscovery({
  action,
  lights,
  onAdd,
}: {
  action: LightAction;
  lights: readonly ProvisionedLight[];
  onAdd(light: ProvisionedLight): Promise<boolean>;
}) {
  const t = useT();
  const { run, busy } = action;
  const [found, setFound] = useState<LifxFound[] | null>(null);

  const discover = async () => {
    const raw = await run<unknown>("POST", LIFX_DISCOVER_PATH, {}, "statusLights.error.lifx");
    if (raw === undefined) return;
    const list = readLifxFound(raw);
    if (list === null) action.fail("statusLights.error.lifx");
    else setFound(list);
  };

  return (
    <div role="group" aria-labelledby="status-lights-lifx-h">
      <h3 className="h3" id="status-lights-lifx-h">
        {t("statusLights.lifx.title")}
      </h3>
      <p className="small">{t("statusLights.lifx.intro")}</p>
      <button type="button" className="btn" disabled={busy} onClick={() => void discover()}>
        {t("statusLights.lifx.discover")}
      </button>
      {found !== null &&
        (found.length === 0 ? (
          <p className="muted small">{t("statusLights.lifx.none")}</p>
        ) : (
          <ul className="card-list">
            {found.map((light) => {
              const serial = deviceText(light.mac);
              return (
                <li key={light.mac}>
                  <span>
                    {t("statusLights.lifx.line", {
                      serial,
                      address: deviceText(light.address),
                    })}
                  </span>{" "}
                  {light.provisioned ||
                  lights.some((l) => l.kind === "lifx" && l.mac === light.mac) ? (
                    <span className="muted small">{t("statusLights.lifx.added")}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      aria-label={t("statusLights.lifx.enableNamed", { serial })}
                      onClick={() =>
                        void onAdd({
                          id: `lifx-${light.mac}`,
                          kind: "lifx",
                          address: light.address,
                          port: light.port,
                          mac: light.mac,
                        })
                      }
                    >
                      {t("statusLights.lifx.enable")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}

/** Quiet hours: lights stay dark between start and end in a time zone. Stored in the capability's config. */
export function QuietHoursControl({
  current,
  busy,
  disabled,
  onSave,
  onFail,
}: {
  current: QuietHours | null;
  busy: boolean;
  disabled: boolean;
  onSave(hours: QuietHours | null): Promise<void>;
  onFail(key: LightErrorKey): void;
}) {
  const t = useT();
  const zoneId = useId();
  const [timezone, setTimezone] = useState(
    current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  );
  const [start, setStart] = useState(current?.start ?? "22:00");
  const [end, setEnd] = useState(current?.end ?? "07:00");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const next = { timezone: timezone.trim(), start, end };
    if (!validQuietHours(next)) {
      onFail("statusLights.error.quietInvalid");
      return;
    }
    await onSave(next);
  };

  return (
    <div role="group" aria-labelledby="status-lights-quiet-h">
      <h3 className="h3" id="status-lights-quiet-h">
        {t("statusLights.quiet.title")}
      </h3>
      <p className="small">{t("statusLights.quiet.intro")}</p>
      <p className="small" role="status">
        {current === null
          ? t("statusLights.quiet.off")
          : t("statusLights.quiet.on", {
              start: current.start,
              end: current.end,
              timezone: deviceText(current.timezone),
            })}
      </p>
      <form onSubmit={(event) => void save(event)}>
        <label>
          {t("statusLights.quiet.start")}{" "}
          <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
        </label>{" "}
        <label>
          {t("statusLights.quiet.end")}{" "}
          <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>{" "}
        <label htmlFor={zoneId}>{t("statusLights.quiet.timezone")}</label>{" "}
        <input
          id={zoneId}
          type="text"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        />{" "}
        <button type="submit" className="btn" disabled={busy || disabled}>
          {t("statusLights.quiet.save")}
        </button>{" "}
        {current !== null && (
          <button
            type="button"
            className="btn"
            disabled={busy || disabled}
            onClick={() => void onSave(null)}
          >
            {t("statusLights.quiet.clear")}
          </button>
        )}
      </form>
    </div>
  );
}
