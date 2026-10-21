// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useRef, useState } from "react";
import { formatTime } from "../core/format";
import { useCapabilities, useCommandAction, useCommandResult } from "../core/hooks";
import {
  readRecoveryStatus,
  type BatteryReading,
  type PendingChange,
  type RecoveryFloors,
  type RecoveryStatus,
  type ThermalReading,
} from "../core/power";
import { useT, type MessageKey, type Translate } from "../i18n";

const KIND_TEXT: Record<string, MessageKey> = {
  "pmset.disablesleep": "power.recovery.journal.kind.disablesleep",
  "pmset.lowpowermode": "power.recovery.journal.kind.lowpowermode",
};

const LID_TEXT: Record<RecoveryStatus["lid"]["state"], MessageKey> = {
  open: "power.recovery.lid.open",
  closed: "power.recovery.lid.closed",
  unknown: "power.recovery.lid.unknown",
  unsupported: "power.recovery.lid.unsupported",
};

const THERMAL_TEXT: Record<string, MessageKey> = {
  nominal: "power.recovery.floors.thermal.nominal",
  fair: "power.recovery.floors.thermal.fair",
  serious: "power.recovery.floors.thermal.serious",
  critical: "power.recovery.floors.thermal.critical",
};

/** A thermal level in the language on screen; a level this UI does not know is shown as the text it is. */
function levelText(t: Translate, level: string): string {
  const key = Object.hasOwn(THERMAL_TEXT, level) ? THERMAL_TEXT[level] : undefined;
  return key ? t(key) : level;
}

function timeText(ms: number): string {
  return ms > 0 ? formatTime(new Date(ms).toISOString()) : "";
}

interface ActionProps {
  command: string;
  label: string;
  input: Record<string, unknown>;
  disabled: boolean;
  primary?: boolean;
  onDone: () => void;
}

/**
 * One approval-gated command: a button that sends it once, the wait for the user's approval, and
 * the error if it failed. The status is reloaded when the command succeeds.
 */
function RecoveryAction({ command, label, input, disabled, primary, onDone }: ActionProps) {
  const t = useT();
  const action = useCommandAction("awake", command);
  // The parent passes a fresh callback each render; only the state change may trigger it.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (action.state === "succeeded") done.current();
  }, [action.state]);
  return (
    <>
      <button
        type="button"
        className={primary ? "btn btn-primary" : "btn"}
        disabled={disabled || action.busy}
        onClick={() => void action.submit(input)}
      >
        {label}
      </button>
      {action.state === "waiting" && (
        <p role="status" className="muted small">
          {t("power.recovery.waiting")}
        </p>
      )}
      {action.state === "failed" && action.error && (
        <p role="alert" className="error-text small">
          {action.error}
        </p>
      )}
    </>
  );
}

function PendingItem({ change }: { change: PendingChange }) {
  const t = useT();
  const when = timeText(change.at);
  return (
    <li>
      <span>
        {t(
          Object.hasOwn(KIND_TEXT, change.kind)
            ? (KIND_TEXT[change.kind] ?? "power.recovery.journal.kind.other")
            : "power.recovery.journal.kind.other",
        )}
      </span>
      {when && (
        <span className="muted small"> {t("power.recovery.journal.at", { time: when })}</span>
      )}
    </li>
  );
}

function batteryText(t: Translate, b: BatteryReading): string {
  if (b.kind === "none") return t("power.recovery.floors.battery.none");
  if (b.kind === "unknown" || b.percent === null) return t("power.recovery.floors.battery.unknown");
  if (b.on_battery === null)
    return t("power.recovery.floors.battery.level", { percent: b.percent });
  return t(
    b.on_battery
      ? "power.recovery.floors.battery.unplugged"
      : "power.recovery.floors.battery.plugged",
    { percent: b.percent },
  );
}

function thermalText(t: Translate, h: ThermalReading): string {
  if (h.kind === "level")
    return t("power.recovery.floors.thermal.level", { level: levelText(t, h.level) });
  return t(
    h.kind === "unsupported"
      ? "power.recovery.floors.thermal.unsupported"
      : "power.recovery.floors.thermal.unknown",
  );
}

function Floors({ floors }: { floors: RecoveryFloors }) {
  const t = useT();
  if (!floors.enabled) return <p className="muted small">{t("power.recovery.floors.off")}</p>;
  return (
    <>
      <p className="small">
        {t("power.recovery.floors.rule", {
          low: floors.low_power_percent,
          end: floors.end_percent,
          heatLow: levelText(t, floors.thermal_low_power_level),
          heatEnd: levelText(t, floors.thermal_end_level),
        })}
      </p>
      {floors.low_power_active && (
        <p className="small">{t("power.recovery.floors.lowPowerActive")}</p>
      )}
      {floors.last && (
        <p className="muted small">
          {batteryText(t, floors.last.battery)} · {thermalText(t, floors.last.thermal)}
        </p>
      )}
    </>
  );
}

function Journal({ status, onDone }: { status: RecoveryStatus; onDone: () => void }) {
  const t = useT();
  const { pending, untrusted } = status.journal;
  return (
    <div className="power-recovery-journal">
      {pending.length === 0 ? (
        <p className="muted small">{t("power.recovery.journal.clean")}</p>
      ) : (
        <div role="alert" className="power-recovery-warning">
          <p className="warning-text">
            {t("power.recovery.journal.pending", { count: pending.length })}
          </p>
          <ul>
            {pending.map((change, i) => (
              <PendingItem key={`${change.id}-${i}`} change={change} />
            ))}
          </ul>
          <RecoveryAction
            command="recovery.undo_now"
            label={t("power.recovery.journal.undo")}
            input={{}}
            disabled={false}
            onDone={onDone}
          />
        </div>
      )}
      {untrusted > 0 && (
        <p className="warning-text small">
          {t("power.recovery.journal.untrusted", { count: untrusted })}
        </p>
      )}
      {!status.can_quit && (
        <p className="warning-text small">{t("power.recovery.journal.cannotQuit")}</p>
      )}
    </div>
  );
}

function Safety({ status, onDone }: { status: RecoveryStatus; onDone: () => void }) {
  const t = useT();
  const [understood, setUnderstood] = useState(false);
  if (status.safety.acknowledged) {
    return <p className="muted small">{t("power.recovery.safety.done")}</p>;
  }
  return (
    <div className="power-recovery-safety">
      <p className="warning-text">{t("power.recovery.safety.warning")}</p>
      <label>
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />{" "}
        {t("power.recovery.safety.understand")}
      </label>
      <div>
        <RecoveryAction
          command="safety.acknowledge"
          label={t("power.recovery.safety.acknowledge")}
          input={{ acknowledge: true, version: status.safety.version }}
          disabled={!understood}
          onDone={onDone}
        />
      </div>
    </div>
  );
}

function LidControls({ status, onDone }: { status: RecoveryStatus; onDone: () => void }) {
  const t = useT();
  const engaged = status.lid_closed.engaged;
  const since = status.lid_closed.since ? formatTime(status.lid_closed.since) : "";
  const canStart =
    status.safety.acknowledged &&
    status.helper_installed === true &&
    status.session_active &&
    status.lid.supported &&
    !engaged;
  return (
    <div className="power-recovery-controls">
      {engaged ? (
        <>
          <p className="small">
            {since
              ? t("power.recovery.engagedSince", { time: since })
              : t("power.recovery.engaged")}
          </p>
          <RecoveryAction
            command="lid_closed.end"
            label={t("power.recovery.end")}
            input={{}}
            disabled={false}
            onDone={onDone}
          />
        </>
      ) : (
        <>
          {status.safety.acknowledged && !status.session_active && (
            <p className="muted small">{t("power.recovery.needsSession")}</p>
          )}
          <RecoveryAction
            command="lid_closed.start"
            label={t("power.recovery.start")}
            input={{}}
            disabled={!canStart}
            primary
            onDone={onDone}
          />
        </>
      )}
    </div>
  );
}

function helperText(t: Translate, installed: boolean | null): string {
  if (installed === null) return t("power.recovery.helper.unknown");
  return t(installed ? "power.recovery.helper.installed" : "power.recovery.helper.missing");
}

function RecoverySection() {
  const t = useT();
  const { data, error, reload } = useCommandResult<unknown>(
    "awake",
    "recovery.status",
    true,
    (type) => type.startsWith("awake."),
  );
  const status = readRecoveryStatus(data);
  const refresh = () => void reload();
  return (
    <section aria-labelledby="power-recovery-h" className="power-recovery">
      <h3 id="power-recovery-h">{t("power.recovery.heading")}</h3>
      {error && <p className="error-text small">{error}</p>}
      {data === null && !error && (
        <p className="muted small">{t("services.common.notYetLoaded")}</p>
      )}
      {data !== null && status === null && (
        <p className="warning-text small">{t("power.recovery.unreadable")}</p>
      )}
      {status && (
        <>
          <Journal status={status} onDone={refresh} />
          <p className="small">{t(LID_TEXT[status.lid.state])}</p>
          <p className="small">{helperText(t, status.helper_installed)}</p>
          {status.floors && <Floors floors={status.floors} />}
          <Safety status={status} onDone={refresh} />
          <LidControls status={status} onDone={refresh} />
        </>
      )}
    </section>
  );
}

/** Lid-closed mode and the undo journal. Renders nothing while the Keep awake capability is off. */
export function PowerRecoveryGlance() {
  const { data: caps } = useCapabilities();
  if (caps.find((c) => c.id === "awake")?.status !== "enabled") return null;
  return <RecoverySection />;
}
