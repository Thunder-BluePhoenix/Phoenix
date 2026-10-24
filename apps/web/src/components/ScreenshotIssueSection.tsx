// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useMemo, useState } from "react";
import { useClient } from "../core/context";
import { useCapabilities } from "../core/hooks";
import {
  captureUnavailable,
  createCoreIssueClient,
  createCoreRegionCapture,
} from "../core/screen-region";
import { ScreenshotDraft } from "../core/screenshot";
import { useT } from "../i18n";
import { ScreenshotIssue } from "./ScreenshotIssue";

/**
 * Mounts the capture / annotate / redact `ScreenshotIssue` over Core. The region selector is the
 * operating system's (macOS), opened only by the capture button and only after Core's own
 * confirmation. Pressing Esc in it is a notice here, not an error. The image stays on this page and
 * is not part of the issue: the issue is created as text only, through the `github` capability.
 */
export function ScreenshotIssueSection() {
  const t = useT();
  const ids = useId();
  const client = useClient();
  const caps = useCapabilities();
  const [cancelled, setCancelled] = useState(false);
  const workflow = useMemo(
    () =>
      new ScreenshotDraft(
        createCoreRegionCapture(client, {
          onStart: () => setCancelled(false),
          onCancelled: () => setCancelled(true),
        }),
        createCoreIssueClient(client),
      ),
    [client],
  );
  const unavailable = captureUnavailable(caps.data);
  return (
    <section className="card" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="h3">
        {t("screenRegion.title")}
      </h2>
      <p className="small">{t("screenRegion.intro")}</p>
      {unavailable ? (
        <p className="warning-text small" role="note">
          {t("screenRegion.unavailable")}
        </p>
      ) : (
        <ScreenshotIssue workflow={workflow} />
      )}
      {cancelled && (
        <p className="muted small" role="status">
          {t("screenRegion.cancelled")}
        </p>
      )}
    </section>
  );
}
