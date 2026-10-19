// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { formatDate } from "../core/format";
import { useAction, useAiStatus, useMemorySettings } from "../core/hooks";
import { MAX_QUESTION } from "../core/review";
import type { MeetingAnswer, MeetingSearchHit, MeetingSearchResult } from "../core/types";
import { isMessageKey, useT, type MessageKey } from "../i18n";
import { Feedback } from "./Feedback";
import { RetrievalNote } from "./RetrievalNote";

const meetingLink = (id: string) => `#/meetings/${encodeURIComponent(id)}`;

const ORIGIN_KEY: Record<MeetingSearchHit["origin"], MessageKey> = {
  reviewed: "memory.msearch.origin.reviewed",
  kage: "memory.msearch.origin.kage",
  notetaker: "memory.msearch.origin.notetaker",
};

/** Search and questions over the meetings Phoenix may read (Phase 35). Results are stored text. */
export function MeetingSearch() {
  const t = useT();
  const { data: ai } = useAiStatus();
  const { data: memorySettings } = useMemorySettings();
  const search = useAction();
  const ask = useAction();
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [found, setFound] = useState<MeetingSearchResult | null>(null);
  const [answer, setAnswer] = useState<MeetingAnswer | null>(null);
  const searchId = useId();
  const askId = useId();
  const aiOn = ai?.enabled === true;
  const blocked = memorySettings !== null && !memorySettings.allow_sensitive_meetings;

  const doSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setFound(null);
    const res = await search.run<MeetingSearchResult>(
      "GET",
      `/api/meetings/search?q=${encodeURIComponent(q)}&limit=20`,
    );
    if (res) setFound(res);
  };

  const doAsk = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setAnswer(null);
    const res = await ask.run<MeetingAnswer>("POST", "/api/meetings/ask", { question: q });
    if (res) setAnswer(res);
  };

  /** The kind of text that matched, in words; a kind this version does not know is shown as sent. */
  const partText = (part: string) => {
    const key = `memory.msearch.part.${part}`;
    return isMessageKey(key) ? t(key) : part.replace("_", " ");
  };

  return (
    <section aria-labelledby="msearch-h" className="card">
      <h2 id="msearch-h" className="h3">
        {t("memory.msearch.title")}
      </h2>
      {blocked && (
        <p className="review-notice small" role="note">
          {t.rich("memory.msearch.blocked.body", {
            lead: <strong>{t("memory.msearch.blocked.lead")}</strong>,
            setting: t("memory.common.includeSensitive"),
            settings: <a href="#/settings">{t("memory.common.settings")}</a>,
          })}
        </p>
      )}
      <form className="memory-form" onSubmit={(e) => void doSearch(e)} role="search">
        <label htmlFor={searchId} className="small">
          {t("memory.msearch.searchLabel")}
        </label>
        <div className="memory-row">
          <input
            id={searchId}
            type="text"
            value={query}
            maxLength={MAX_QUESTION}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={search.busy || !query.trim()}>
            {t("memory.common.search")}
          </button>
        </div>
        <Feedback error={search.error} />
      </form>
      {found && (
        <div aria-live="polite">
          {found.hits.length === 0 ? (
            <p className="muted small">
              {blocked
                ? t("memory.msearch.noneBlocked")
                : t("memory.msearch.noneFound", { query: found.query })}
            </p>
          ) : (
            <>
              <p className="small">
                {t("memory.msearch.total", { count: found.total, query: found.query })}
              </p>
              <ul className="memory-facts" aria-label={t("memory.common.searchResults")}>
                {found.hits.map((h) => (
                  <li key={h.memory_id}>
                    <p className="memory-text">{h.text}</p>
                    <p className="muted small">
                      {t.rich(
                        h.freshness === "stale"
                          ? "memory.msearch.hitMetaStale"
                          : "memory.msearch.hitMeta",
                        {
                          part: partText(h.part),
                          origin: t(ORIGIN_KEY[h.origin]),
                          meeting: (
                            <a href={meetingLink(h.meeting_id)}>
                              {t("memory.msearch.meetingLink", { id: h.meeting_id })}
                            </a>
                          ),
                          date: <time dateTime={h.observed_at}>{formatDate(h.observed_at)}</time>,
                        },
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <RetrievalNote info={found.retrieval} />
        </div>
      )}
      <form className="memory-form" onSubmit={(e) => void doAsk(e)}>
        <label htmlFor={askId} className="small">
          {t("memory.msearch.askLabel")}
        </label>
        <div className="memory-row">
          <input
            id={askId}
            type="text"
            value={question}
            maxLength={MAX_QUESTION}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={ask.busy || !question.trim()}>
            {t("memory.common.ask")}
          </button>
        </div>
        <p className="muted small">
          {aiOn ? t("memory.msearch.aiOn") : t("memory.common.aiOffFactsOnly")}
        </p>
        <Feedback error={ask.error} />
      </form>
      {answer && (
        <div className="memory-answer" aria-live="polite">
          <h3 className="h4">{t("memory.common.storedFacts")}</h3>
          {answer.facts.length === 0 ? (
            <p className="muted small">
              {blocked ? t("memory.msearch.factsNoneBlocked") : t("memory.msearch.factsNone")}
            </p>
          ) : (
            <ul className="memory-facts" aria-label={t("memory.msearch.facts.title")}>
              {answer.facts.map((f) => (
                <li key={f.ref}>
                  <p className="memory-text">
                    <span className="mem-badge">{f.ref}</span> {f.text}
                  </p>
                  <p className="muted small">
                    {t.rich("memory.msearch.factMeta", {
                      origin: t(ORIGIN_KEY[f.origin]),
                      meeting: (
                        <a href={meetingLink(f.meeting_id)}>
                          {t("memory.msearch.meetingLink", { id: f.meeting_id })}
                        </a>
                      ),
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <h3 className="h4">{t("memory.msearch.interpretation")}</h3>
          {answer.ai_used && answer.interpretation ? (
            <div className="memory-interpretation">
              <p className="small">
                <strong>
                  {t("memory.msearch.generatedBy", {
                    model: answer.processed_by ?? t("memory.msearch.anAiModel"),
                  })}
                </strong>
              </p>
              <p className="memory-text">{answer.interpretation}</p>
            </div>
          ) : (
            <p className="small">
              {answer.ai_used
                ? t("memory.msearch.aiNoInterpretation")
                : t("memory.msearch.noAiUsed")}
            </p>
          )}
          {answer.note && <p className="muted small">{answer.note}</p>}
          <RetrievalNote info={answer.retrieval} />
        </div>
      )}
    </section>
  );
}
