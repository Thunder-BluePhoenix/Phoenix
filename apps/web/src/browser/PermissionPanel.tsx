// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId } from "react";
import { useT, type MessageKey } from "../i18n";
import { secondsLeft, type PermissionPrompts } from "./permissions";
import type { PermissionKind } from "./shell";
import { displayText } from "./unsafe-text";

const KIND_TEXT: Record<PermissionKind, MessageKey> = {
  microphone: "browser.permission.kind.microphone",
  camera: "browser.permission.kind.camera",
  geolocation: "browser.permission.kind.geolocation",
  notifications: "browser.permission.kind.notifications",
  "clipboard-read": "browser.permission.kind.clipboard-read",
  "display-capture": "browser.permission.kind.display-capture",
  midi: "browser.permission.kind.midi",
  sensors: "browser.permission.kind.sensors",
  "media-key-system-access": "browser.permission.kind.media-key-system-access",
  "local-fonts": "browser.permission.kind.local-fonts",
  "window-management": "browser.permission.kind.window-management",
  "pointer-lock": "browser.permission.kind.pointer-lock",
  "automatic-downloads": "browser.permission.kind.automatic-downloads",
  "file-system-access": "browser.permission.kind.file-system-access",
  autoplay: "browser.permission.kind.autoplay",
  other: "browser.permission.kind.other",
};

/**
 * One permission request at a time (oldest first). The site and the permission are shown as text;
 * the only answers are Allow once and Deny, and the shell denies on its own after 30 seconds.
 */
export function PermissionPanel({ prompts }: { prompts: PermissionPrompts }) {
  const t = useT();
  const titleId = useId();
  const current = prompts.queue[0];
  if (!current) return null;
  const more = prompts.queue.length - 1;
  return (
    <section
      className="browser-panel browser-permission"
      role="alertdialog"
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{t("browser.permission.title")}</h2>
      <p className="browser-panel-url">
        {t("browser.permission.origin", { origin: displayText(current.origin) })}
      </p>
      <p>{t("browser.permission.asks", { permission: t(KIND_TEXT[current.permission]) })}</p>
      <p className="browser-hint">
        {t("browser.permission.countdown", { seconds: secondsLeft(current, prompts.now) })}
      </p>
      {more > 0 && <p className="browser-hint">{t("browser.permission.more", { count: more })}</p>}
      <div className="browser-panel-buttons">
        <button
          type="button"
          className="browser-button"
          onClick={() => prompts.answer(current.requestId, true)}
        >
          {t("browser.permission.allow")}
        </button>
        <button
          type="button"
          className="browser-button"
          onClick={() => prompts.answer(current.requestId, false)}
        >
          {t("browser.permission.deny")}
        </button>
      </div>
    </section>
  );
}
