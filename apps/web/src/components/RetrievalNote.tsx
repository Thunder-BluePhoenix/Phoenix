// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { RetrievalInfo } from "../core/types";
import { useT, type MessageKey } from "../i18n";

/** Reasons Core gives for not using the vector index, in words. */
const SKIPPED_TEXT: Record<string, MessageKey> = {
  ai_disabled: "capture.retrieval.skipped.aiDisabled",
};

/** Says how a search found its results: keyword only, or keyword plus meaning. */
export function RetrievalNote({ info }: { info: RetrievalInfo }) {
  const t = useT();
  const reason = info.vector_skipped_reason;
  const known = reason && Object.hasOwn(SKIPPED_TEXT, reason) ? SKIPPED_TEXT[reason] : undefined;
  return (
    <p className="muted small">
      {info.mode === "hybrid" ? t("capture.retrieval.hybrid") : t("capture.retrieval.keywordsOnly")}
      {reason && ` ${t("capture.retrieval.notUsed", { reason: known ? t(known) : reason })}`}
      {info.truncated && ` ${t("capture.retrieval.truncated")}`}
    </p>
  );
}
