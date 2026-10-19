// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatDate, formatNumber, safeHttpUrl } from "../core/format";
import type {
  MemoryAnswer,
  MemoryEvidence,
  MemoryFact,
  MemorySensitivity,
  MemoryStoredInterpretation,
} from "../core/types";
import { useT, type MessageKey } from "../i18n";
import { translate } from "../i18n/store";

const SENSITIVITY_KEY: Record<MemorySensitivity, MessageKey> = {
  public: "capture.answer.sensitivity.public",
  internal: "capture.answer.sensitivity.internal",
  sensitive: "capture.answer.sensitivity.sensitive",
};

/**
 * The sensitivity words in the language on screen, for components that read them without `useT()`
 * (the value is looked up each time; the component re-renders on a language change through its own
 * `useT()`).
 */
export const SENSITIVITY_LABEL: Record<MemorySensitivity, string> = Object.defineProperties(
  {} as Record<MemorySensitivity, string>,
  {
    public: { enumerable: true, get: () => translate(SENSITIVITY_KEY.public) },
    internal: { enumerable: true, get: () => translate(SENSITIVITY_KEY.internal) },
    sensitive: { enumerable: true, get: () => translate(SENSITIVITY_KEY.sensitive) },
  },
);

const CLASSIFICATION_KEY: Record<
  (MemoryFact | MemoryEvidence | MemoryStoredInterpretation)["classification"],
  MessageKey
> = {
  stored_fact: "capture.answer.classification.storedFact",
  retrieved_evidence: "capture.answer.classification.retrievedEvidence",
  stored_interpretation: "capture.answer.classification.storedInterpretation",
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
  const t = useT();
  return (
    <li>
      <p className="memory-text">{item.text}</p>
      <p className="muted small memory-text">
        {t.rich("capture.answer.record", {
          classification: t(CLASSIFICATION_KEY[item.classification]),
          id: <code className="break">{item.id}</code>,
          domain: item.domain,
          source: item.source,
          ref: <SourceRef sourceRef={item.source_ref} />,
          observed: <time dateTime={item.observed_at}>{formatDate(item.observed_at)}</time>,
          sensitivity: t(SENSITIVITY_KEY[item.sensitivity]),
          freshness: t(
            item.freshness === "stale"
              ? "capture.answer.freshness.stale"
              : "capture.answer.freshness.fresh",
          ),
          confidence:
            item.confidence === null
              ? t("capture.answer.confidenceUnknown")
              : formatNumber(Math.round(item.confidence * 100) / 100, undefined, {
                  style: "percent",
                  maximumFractionDigits: 0,
                }),
        })}
      </p>
    </li>
  );
}

/** At least 0.01 shows cents; smaller amounts keep up to six significant digits, never exponent form. */
function formatCost(amount: number): string {
  const digits = (fraction: number, max = fraction): string =>
    formatNumber(Number(amount.toFixed(max)), undefined, {
      minimumFractionDigits: fraction,
      maximumFractionDigits: max,
      useGrouping: false,
    });
  if (amount >= 0.01) return digits(2);
  if (amount <= 0) return formatNumber(0);
  const decimals = Math.min(20, Math.max(0, 5 - Math.floor(Math.log10(amount))));
  return digits(0, decimals);
}

/** Exactly one line saying who answered, where, and what it cost; nothing for older answers. */
function Attribution({ answer }: { answer: MemoryAnswer }) {
  const t = useT();
  const { provider, locality } = answer;
  if (!provider || !locality) return null;
  const where = t(
    locality === "local"
      ? "capture.answer.attribution.whereLocal"
      : "capture.answer.attribution.whereCloud",
  );
  let cost = t("capture.answer.attribution.costUnknown");
  if (locality === "local") cost = t("capture.answer.attribution.costFree");
  else if (answer.cost && Number.isFinite(answer.cost.amount))
    cost = t("capture.answer.attribution.costAbout", { amount: formatCost(answer.cost.amount) });
  return (
    <p className="small memory-attribution">
      {t("capture.answer.attribution.line", {
        model: answer.model ?? t("capture.answer.attribution.defaultModel"),
        provider: answer.provider_label ?? provider,
        where,
        cost,
      })}
    </p>
  );
}

/** Core keeps assertions, retrieved material, previous interpretations and generated text apart. */
export function AnswerView({ answer }: { answer: MemoryAnswer }) {
  const t = useT();
  return (
    <div className="memory-answer">
      <h4>{t("capture.answer.facts.heading")}</h4>
      {answer.facts.length === 0 ? (
        <p className="muted small">{t("capture.answer.facts.empty")}</p>
      ) : (
        <ul className="memory-facts">
          {answer.facts.map((item) => (
            <AnswerRecord key={item.id} item={item} />
          ))}
        </ul>
      )}
      <h4>{t("capture.answer.evidence.heading")}</h4>
      {answer.retrieved_evidence.length === 0 ? (
        <p className="muted small">{t("capture.answer.evidence.empty")}</p>
      ) : (
        <ul className="memory-facts">
          {answer.retrieved_evidence.map((item) => (
            <AnswerRecord key={item.id} item={item} />
          ))}
        </ul>
      )}
      <h4>{t("capture.answer.interpretations.heading")}</h4>
      {answer.stored_interpretations.length === 0 ? (
        <p className="muted small">{t("capture.answer.interpretations.empty")}</p>
      ) : (
        <ul className="memory-facts">
          {answer.stored_interpretations.map((item) => (
            <AnswerRecord key={item.id} item={item} />
          ))}
        </ul>
      )}
      <h4>{t("capture.answer.hypothesis.heading")}</h4>
      {answer.ai_used && answer.interpretation ? (
        <div className="memory-interpretation">
          <p className="small">
            <strong>
              {t("capture.answer.hypothesis.label", {
                by: answer.processed_by ?? t("capture.answer.hypothesis.anAiModel"),
              })}
            </strong>
          </p>
          <Attribution answer={answer} />
          <p className="memory-text">{answer.interpretation}</p>
        </div>
      ) : (
        <p className="small">
          {answer.ai_used
            ? t("capture.answer.hypothesis.noInterpretation")
            : t("capture.answer.hypothesis.noAi")}
        </p>
      )}
      {answer.note && <p className="muted small">{answer.note}</p>}
    </div>
  );
}
