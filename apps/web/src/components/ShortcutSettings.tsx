// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { acceleratorFromEvent, isComposing } from "../commands/keys";
import {
  SHORTCUT_ACTIONS,
  ShortcutRefused,
  tauriShortcuts,
  type ShortcutAction,
  type ShortcutReport,
  type ShortcutsShell,
  type ShortcutState,
} from "../commands/shortcuts-shell";
import { useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";

const ACTION_LABEL: Record<ShortcutAction, MessageKey> = {
  open_chat: "shell.shortcuts.action.open_chat",
  jump_to_alert: "shell.shortcuts.action.jump_to_alert",
  jump_to_terminal: "shell.shortcuts.action.jump_to_terminal",
  switch_pills: "shell.shortcuts.action.switch_pills",
  mute: "shell.shortcuts.action.mute",
  send_to_desktop: "shell.shortcuts.action.send_to_desktop",
  wardrobe: "shell.shortcuts.action.wardrobe",
};

const STATE_TEXT: Record<ShortcutState, MessageKey> = {
  active: "shell.shortcuts.state.active",
  off: "shell.shortcuts.state.off",
  unbound: "shell.shortcuts.state.unbound",
  rejected: "shell.shortcuts.state.rejected",
  unavailable: "shell.shortcuts.state.unavailable",
};

/** Why the shell refused, by its error code. A code this build does not know says so plainly. */
const REASON_TEXT: Record<string, MessageKey> = {
  invalid: "shell.shortcuts.reason.invalid",
  needs_modifiers: "shell.shortcuts.reason.needs_modifiers",
  needs_third_modifier: "shell.shortcuts.reason.needs_third_modifier",
  reserved: "shell.shortcuts.reason.reserved",
  dictation_chord: "shell.shortcuts.reason.dictation_chord",
  conflict: "shell.shortcuts.reason.conflict",
  unavailable: "shell.shortcuts.reason.unavailable",
  forbidden: "shell.shortcuts.reason.forbidden",
  unknown_action: "shell.shortcuts.reason.unknown_action",
};

/**
 * Settings: the desktop app's global shortcuts and mute switch. Everything goes through the
 * ShortcutsShell, so in a plain browser (no shell) this is only a note; a test passes a fake.
 */
export function ShortcutSettings({ shell: given }: { shell?: ShortcutsShell | null }) {
  // Looked up once: the Tauri global does not change while the page is open.
  const [own] = useState(() => tauriShortcuts());
  const shell = given === undefined ? own : given;
  const t = useT();
  const headingId = useId();
  if (!shell) {
    return (
      <section aria-labelledby={headingId} className="card">
        <h2 id={headingId} className="h3">
          {t("shell.shortcuts.title")}
        </h2>
        <p className="muted small">{t("shell.shortcuts.desktopOnly")}</p>
      </section>
    );
  }
  return <DesktopShortcuts shell={shell} headingId={headingId} />;
}

function DesktopShortcuts({ shell, headingId }: { shell: ShortcutsShell; headingId: string }) {
  const t = useT();
  const [report, setReport] = useState<ShortcutReport | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const warnId = useId();
  const changeButtons = useRef<Partial<Record<ShortcutAction, HTMLButtonElement | null>>>({});

  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    shell.list().then(
      (next) => alive && setReport(next),
      () => alive && setLoadFailed(true),
    );
    // The shell re-registers bindings itself (the tray menu, a failed registration): follow it.
    shell
      .onStatus((next) => alive && setReport(next))
      .then(
        (unlisten) => {
          if (alive) off = unlisten;
          else unlisten();
        },
        () => {},
      );
    return () => {
      alive = false;
      off?.();
    };
  }, [shell]);

  const reasonFor = useCallback(
    (err: unknown): string => {
      const key = err instanceof ShortcutRefused ? REASON_TEXT[err.code] : undefined;
      return t(key ?? "shell.shortcuts.reason.unknown");
    },
    [t],
  );

  /** Runs one change; the shell's answer replaces the whole report. */
  const change = async (
    call: () => Promise<ShortcutReport>,
    done?: (next: ShortcutReport) => string | null,
  ) => {
    setError(null);
    setSaved(null);
    try {
      const next = await call();
      setReport(next);
      setSaved(done?.(next) ?? null);
      return next;
    } catch (err) {
      setError(reasonFor(err));
      return null;
    }
  };

  const stopCapture = (action: ShortcutAction) => {
    setCapturing(null);
    // The edit field disappears: give focus back to the button that opened it.
    queueMicrotask(() => changeButtons.current[action]?.focus());
  };

  const onCaptureKey = (action: ShortcutAction, e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e.nativeEvent)) return;
    if (e.key === "Tab") return;
    e.preventDefault();
    if (e.key === "Escape") {
      stopCapture(action);
      return;
    }
    const captured = acceleratorFromEvent(e.nativeEvent);
    if (captured.kind === "pending") return;
    if (captured.kind === "unsupported") {
      setSaved(null);
      setError(t("shell.shortcuts.reason.unsupportedKey"));
      return;
    }
    const label = t(ACTION_LABEL[action]);
    void change(
      () => shell.set(action, captured.text),
      (next) => {
        const entry = next.shortcuts.find((s) => s.action === action);
        if (entry && (entry.state === "unavailable" || entry.state === "rejected")) {
          setError(t("shell.shortcuts.reason.unavailable"));
          return null;
        }
        return t("shell.shortcuts.saved", {
          action: label,
          keys: entry?.accelerator ?? captured.text,
        });
      },
    ).then((next) => {
      if (next) stopCapture(action);
    });
  };

  return (
    <section aria-labelledby={headingId} className="card shortcut-settings">
      <h2 id={headingId} className="h3">
        {t("shell.shortcuts.title")}
      </h2>
      <p className="small">{t("shell.shortcuts.intro")}</p>
      {loadFailed && (
        <p className="error-text small" role="alert">
          {t("shell.shortcuts.loadFailed")}
        </p>
      )}
      {!report && !loadFailed && <p className="muted small">{t("shell.shortcuts.loading")}</p>}
      {report && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={report.enabled}
              aria-describedby={warnId}
              onChange={(e) => void change(() => shell.setEnabled(e.target.checked))}
            />{" "}
            {t("shell.shortcuts.enable")}
          </label>
          <p id={warnId} className="warning-text small">
            {t("shell.shortcuts.warning")}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={report.muted}
              onChange={(e) => void change(() => shell.setMuted(e.target.checked))}
            />{" "}
            {t("shell.shortcuts.mute")}
          </label>
          <p className="muted small">{t("shell.shortcuts.muteHelp")}</p>
          <ul className="shortcut-list" aria-label={t("shell.shortcuts.list")}>
            {SHORTCUT_ACTIONS.map((action) => {
              const status = report.shortcuts.find((s) => s.action === action);
              const label = t(ACTION_LABEL[action]);
              return (
                <li key={action} className="shortcut-row">
                  <div className="shortcut-name">
                    <strong>{label}</strong>
                    <span className="muted small">{status ? t(STATE_TEXT[status.state]) : ""}</span>
                  </div>
                  <div className="shortcut-binding">
                    {capturing === action ? (
                      <input
                        className="shortcut-capture"
                        type="text"
                        readOnly
                        autoFocus
                        aria-label={t("shell.shortcuts.captureFor", { action: label })}
                        aria-describedby={`${warnId}-capture`}
                        placeholder={t("shell.shortcuts.capture")}
                        onKeyDown={(e) => onCaptureKey(action, e)}
                        onBlur={() => setCapturing((now) => (now === action ? null : now))}
                      />
                    ) : (
                      <kbd className="palette-keys">
                        {status?.accelerator ?? t("shell.shortcuts.binding.none")}
                      </kbd>
                    )}
                    {capturing === action && (
                      <span id={`${warnId}-capture`} className="muted small">
                        {t("shell.shortcuts.captureHelp")}
                      </span>
                    )}
                    {status?.defaultAccelerator && (
                      <span className="muted small">
                        {t("shell.shortcuts.default", { keys: status.defaultAccelerator })}
                      </span>
                    )}
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="btn"
                      ref={(el) => {
                        changeButtons.current[action] = el;
                      }}
                      aria-label={t("shell.shortcuts.changeFor", { action: label })}
                      onClick={() => {
                        setError(null);
                        setSaved(null);
                        setCapturing(action);
                      }}
                    >
                      {t("common.button.edit")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={t("shell.shortcuts.resetFor", { action: label })}
                      onClick={() =>
                        void change(
                          () => shell.reset(action),
                          () => t("shell.shortcuts.resetDone", { action: label }),
                        )
                      }
                    >
                      {t("common.button.reset")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="button-row wrap">
            <button
              type="button"
              className="btn"
              onClick={() =>
                void change(
                  () => shell.reset(),
                  () => t("shell.shortcuts.resetAllDone"),
                )
              }
            >
              {t("shell.shortcuts.resetAll")}
            </button>
          </div>
        </>
      )}
      <Feedback error={error} saved={saved} />
    </section>
  );
}
