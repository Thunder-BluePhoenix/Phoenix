// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { RetrievalInfo } from "../core/types";

/** Reasons Core gives for not using the vector index, in words. */
const SKIPPED_TEXT: Record<string, string> = {
  ai_disabled: "AI is off",
};

/** Says how a search found its results: keyword only, or keyword plus meaning. */
export function RetrievalNote({ info }: { info: RetrievalInfo }) {
  return (
    <p className="muted small">
      {info.mode === "hybrid"
        ? "Found by keywords and by meaning (smart search)."
        : "Found by keywords only."}
      {info.vector_skipped_reason &&
        ` Smart search was not used: ${SKIPPED_TEXT[info.vector_skipped_reason] ?? info.vector_skipped_reason}.`}
      {info.truncated && " The oldest memories were left out to keep this fast."}
    </p>
  );
}
