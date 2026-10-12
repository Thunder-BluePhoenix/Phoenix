// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatDate, safeHttpUrl } from "../core/format";
import type { MemoryAnswer, MemoryFact, MemorySensitivity } from "../core/types";

export const SENSITIVITY_LABEL: Record<MemorySensitivity, string> = {
  public: "Public",
  internal: "Internal",
  sensitive: "Sensitive",
};

/** A source reference as text; a link only when it is a plain http(s) URL. Never HTML. */
export function SourceRef({ sourceRef }: { sourceRef: string | null }) {
  if (!sourceRef) return null;
  const href = safeHttpUrl(sourceRef);
  return (
    <>
      {" ("}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {sourceRef}
        </a>
      ) : (
        sourceRef
      )}
      {")"}
    </>
  );
}

/** Each source belongs to this record alone, never to the generated interpretation. */
function AnswerRecord({
  item,
}: {
  item:
    | MemoryFact
    | MemoryAnswer["retrieved_evidence"][number]
    | MemoryAnswer["stored_interpretations"][number];
}) {
  return (
    <li>
      <p className="memory-text">{item.text}</p>
      <p className="muted small memory-text">
        {item.classification === "stored_fact"
          ? "Stored fact"
          : item.classification === "retrieved_evidence"
            ? "Retrieved evidence, not an asserted fact"
            : "Stored interpretation, not a fact"}
        {" · source id "}
        <code className="break">{item.id}</code>
        {" · "}
        {item.domain} · from {item.source}
        <SourceRef sourceRef={item.source_ref} />
        {" · observed "}
        <time dateTime={item.observed_at}>{formatDate(item.observed_at)}</time>
        {" · "}
        {SENSITIVITY_LABEL[item.sensitivity]}
        {" · "}
        {item.freshness === "stale" ? "Stale observation" : "Fresh observation"}
        {" · confidence "}
        {item.confidence === null ? "unknown" : `${Math.round(item.confidence * 100)}%`}
      </p>
    </li>
  );
}

/** Core keeps assertions, retrieved material, previous interpretations and generated text apart. */
export function AnswerView({ answer }: { answer: MemoryAnswer }) {
  return (
    <div className="memory-answer">
      <h4>Stored facts</h4>
      {answer.facts.length === 0 ? (
        <p className="muted small">No stored facts matched your question.</p>
      ) : (
        <ul className="memory-facts">
          {answer.facts.map((item) => (
            <AnswerRecord key={item.id} item={item} />
          ))}
        </ul>
      )}
      <h4>Retrieved evidence (not stored facts)</h4>
      {answer.retrieved_evidence.length === 0 ? (
        <p className="muted small">No retrieved evidence matched.</p>
      ) : (
        <ul className="memory-facts">
          {answer.retrieved_evidence.map((item) => (
            <AnswerRecord key={item.id} item={item} />
          ))}
        </ul>
      )}
      <h4>Previous stored interpretations (not facts)</h4>
      {answer.stored_interpretations.length === 0 ? (
        <p className="muted small">No previous interpretations matched.</p>
      ) : (
        <ul className="memory-facts">
          {answer.stored_interpretations.map((item) => (
            <AnswerRecord key={item.id} item={item} />
          ))}
        </ul>
      )}
      <h4>Generated hypothesis</h4>
      {answer.ai_used && answer.interpretation ? (
        <div className="memory-interpretation">
          <p className="small">
            <strong>
              Generated hypothesis by {answer.processed_by ?? "an AI model"}, not a stored fact or
              established conclusion.
            </strong>
          </p>
          <p className="memory-text">{answer.interpretation}</p>
        </div>
      ) : (
        <p className="small">
          {answer.ai_used ? "AI was used but gave no interpretation." : "No AI was used."}
        </p>
      )}
      {answer.note && <p className="muted small">{answer.note}</p>}
    </div>
  );
}
