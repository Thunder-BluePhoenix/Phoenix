// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState } from "react";
import { useCommandAction } from "../core/hooks";
import {
  readMachineModels,
  readMachineSnapshot,
  useMachineAvailability,
  type MachineProvider,
} from "../core/machine";
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const HEALTH_FIELDS: {
  key: "diskFreeBytes" | "memoryFreeBytes" | "cpuPercent" | "batteryPercent" | "temperatureCelsius";
  label: MessageKey;
  unit: string;
  divisor: number;
}[] = [
  { key: "diskFreeBytes", label: "machine.disk", unit: "GiB", divisor: 1024 ** 3 },
  { key: "memoryFreeBytes", label: "machine.memory", unit: "GiB", divisor: 1024 ** 3 },
  { key: "cpuPercent", label: "machine.cpu", unit: "%", divisor: 1 },
  { key: "batteryPercent", label: "machine.battery", unit: "%", divisor: 1 },
  { key: "temperatureCelsius", label: "machine.thermal", unit: "°C", divisor: 1 },
];
export function MachineHealth() {
  const t = useT();
  const id = useId();
  const availability = useMachineAvailability();
  const health = useCommandAction("machine", "health_snapshot");
  const list = useCommandAction("machine", "list_models");
  const fit = useCommandAction("machine", "check_fit");
  const download = useCommandAction("machine", "download_model");
  const remove = useCommandAction("machine", "remove_model");
  const run = useCommandAction("machine", "run_model");
  const cleanup = useCommandAction("machine", "suggest_cleanup");
  const [provider, setProvider] = useState<MachineProvider>("ollama");
  const [name, setName] = useState("");
  const [pending, setPending] = useState<{
    action: "download" | "remove" | "run";
    provider: MachineProvider;
    name: string;
  } | null>(null);
  const snapshot = readMachineSnapshot(health.result);
  const models = readMachineModels(list.result);
  if (availability === "absent") return null;
  const busy =
    health.busy ||
    list.busy ||
    fit.busy ||
    download.busy ||
    remove.busy ||
    run.busy ||
    cleanup.busy;
  const suggestion =
    cleanup.result !== null && typeof cleanup.result === "object"
      ? Reflect.get(cleanup.result, "suggestions")
      : null;
  const suggestedModels = Array.isArray(suggestion) ? readMachineModels(suggestion) : null;
  const fitResult = fit.result !== null && typeof fit.result === "object" ? fit.result : null;
  const fitReason = fitResult ? Reflect.get(fitResult, "reason") : null;
  const fitText: MessageKey =
    fitReason === "disk"
      ? "machine.fit.disk"
      : fitReason === "memory"
        ? "machine.fit.memory"
        : fitReason === "unknown"
          ? "machine.fit.unknown"
          : "machine.fit.ok";
  function confirm() {
    if (!pending) return;
    const args = { provider: pending.provider, name: pending.name };
    if (pending.action === "download") void download.submit(args);
    else if (pending.action === "remove") void remove.submit(args);
    else void run.submit(args);
    setPending(null);
  }
  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="h3">
        {t("machine.title")}
      </h2>
      <p className="muted small">{t("machine.intro")}</p>
      {availability === "disabled" ? (
        <p role="status">{t("machine.disabled")}</p>
      ) : (
        <>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void health.submit({})}
          >
            {t("machine.refresh")}
          </button>
          <Feedback
            error={
              health.error ??
              (health.state === "succeeded" && !snapshot ? t("machine.failed") : null)
            }
          />
          {snapshot && (
            <>
              <dl>
                {HEALTH_FIELDS.map(({ key, label, unit, divisor }) => (
                  <div key={key}>
                    <dt>{t(label)}</dt>
                    <dd>
                      {snapshot.reading[key] === null
                        ? t("machine.unavailable")
                        : `${(snapshot.reading[key] / divisor).toFixed(1)} ${unit}`}
                    </dd>
                  </div>
                ))}
              </dl>
              {snapshot.warnings.length > 0 && (
                <p role="alert">
                  {t("machine.warning", {
                    warnings: snapshot.warnings
                      .map((warning) =>
                        t(
                          HEALTH_FIELDS.find((item) => item.label.endsWith(warning))?.label ??
                            "machine.unavailable",
                        ),
                      )
                      .join(", "),
                  })}
                </p>
              )}
            </>
          )}
          <label htmlFor={`${id}-provider`}>{t("machine.provider")}</label>
          <select
            id={`${id}-provider`}
            value={provider}
            disabled={busy}
            onChange={(event) => {
              setProvider(event.target.value === "lmstudio" ? "lmstudio" : "ollama");
              fit.reset();
              list.reset();
              cleanup.reset();
            }}
          >
            <option value="ollama">{t("machine.ollama")}</option>
            <option value="lmstudio">{t("machine.lmstudio")}</option>
          </select>
          <h3>{t("machine.models")}</h3>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void list.submit({ provider })}
          >
            {t("machine.list")}
          </button>
          <Feedback
            error={
              list.error ?? (list.state === "succeeded" && !models ? t("machine.failed") : null)
            }
          />
          {models?.length === 0 && <p>{t("machine.none")}</p>}
          {models && (
            <ul>
              {models.map((model) => (
                <li key={model.name}>
                  <span>
                    {model.name} —{" "}
                    {t("machine.size", { size: (model.sizeBytes / 1024 ** 3).toFixed(2) })}{" "}
                    {model.loaded && t("machine.loaded")}
                  </span>{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPending({ action: "run", provider, name: model.name })}
                  >
                    {t("machine.run")}
                  </button>{" "}
                  {provider === "ollama" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPending({ action: "remove", provider, name: model.name })}
                    >
                      {t("machine.remove")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <label htmlFor={`${id}-model`}>{t("machine.name")}</label>
          <input
            id={`${id}-model`}
            value={name}
            maxLength={180}
            onChange={(event) => {
              setName(event.target.value);
              fit.reset();
            }}
          />
          <div className="button-row wrap">
            <button
              type="button"
              disabled={busy || !name}
              onClick={() => void fit.submit({ provider, name })}
            >
              {t("machine.fit")}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !name ||
                fit.state !== "succeeded" ||
                !fitResult ||
                Reflect.get(fitResult, "fits") !== true
              }
              onClick={() => setPending({ action: "download", provider, name })}
            >
              {t("machine.download")}
            </button>
            <button type="button" disabled={busy} onClick={() => void cleanup.submit({ provider })}>
              {t("machine.cleanup")}
            </button>
          </div>
          {fit.state === "succeeded" && fitResult && <p role="status">{t(fitText)}</p>}
          <Feedback
            error={fit.error ?? download.error ?? remove.error ?? run.error ?? cleanup.error}
          />
          {(download.state === "succeeded" ||
            remove.state === "succeeded" ||
            run.state === "succeeded") && <p role="status">{t("machine.done")}</p>}
          {suggestedModels && (
            <ul>
              {suggestedModels.map((model) => (
                <li key={model.name}>
                  {model.name} —{" "}
                  {t("machine.size", { size: (model.sizeBytes / 1024 ** 3).toFixed(2) })}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">{t("machine.cleanup.note")}</p>
          <p className="muted small">{t("machine.note")}</p>
          {pending && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("machine.confirm", { action: pending.action, name: pending.name })}
            >
              <p>{t("machine.confirm", { action: pending.action, name: pending.name })}</p>
              <button type="button" onClick={confirm}>
                {t("machine.confirm", { action: pending.action, name: pending.name })}
              </button>
              <button type="button" onClick={() => setPending(null)}>
                {t("machine.cancel")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
