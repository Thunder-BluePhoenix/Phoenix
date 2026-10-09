// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { useAction, useAiStatus, useMemorySettings } from "../core/hooks";
import { MAX_QUESTION } from "../core/review";
import type { MeetingAnswer, MeetingSearchHit, MeetingSearchResult } from "../core/types";
import { formatDate } from "../core/format";
import { Feedback } from "./Feedback";
import { RetrievalNote } from "./RetrievalNote";

const meetingLink = (id: string) => `#/meetings/${encodeURIComponent(id)}`;

const ORIGIN_TEXT: Record<MeetingSearchHit["origin"], string> = {
  reviewed: "Reviewed by you",
  kage: "From Kage's summary, not reviewed here",
};

/** Search and questions over the meetings Phoenix may read (Phase 35). Results are stored text. */
export function MeetingSearch() {
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

  return (
    <section aria-labelledby="msearch-h" className="card">
      <h2 id="msearch-h" className="h3">
        Search and ask across meetings
      </h2>
      {blocked && (
        <p className="review-notice small" role="note">
          <strong>Meeting content is not allowed in memory,</strong> so there is nothing to search.
          To allow it, turn on “Include meeting summaries marked sensitive” in{" "}
          <a href="#/settings">Settings</a>.
        </p>
      )}
      <form className="memory-form" onSubmit={(e) => void doSearch(e)} role="search">
        <label htmlFor={searchId} className="small">
          Search meetings
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
            Search
          </button>
        </div>
        <Feedback error={search.error} />
      </form>
      {found && (
        <div aria-live="polite">
          {found.hits.length === 0 ? (
            <p className="muted small">
              {blocked
                ? "No results: meeting content is not allowed in memory."
                : `No meeting matched “${found.query}”. Only reviewed items and Kage's summaries are searched.`}
            </p>
          ) : (
            <>
              <p className="small">
                {found.total} result(s) for “{found.query}”.
              </p>
              <ul className="memory-facts" aria-label="Search results">
                {found.hits.map((h) => (
                  <li key={h.memory_id}>
                    <p className="memory-text">{h.text}</p>
                    <p className="muted small">
                      {h.part.replace("_", " ")} · {ORIGIN_TEXT[h.origin]} ·{" "}
                      <a href={meetingLink(h.meeting_id)}>Meeting {h.meeting_id}</a> ·{" "}
                      <time dateTime={h.observed_at}>{formatDate(h.observed_at)}</time>
                      {h.freshness === "stale" && " · may be out of date"}
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
          Ask about your meetings
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
            Ask
          </button>
        </div>
        <p className="muted small">
          {aiOn
            ? "Stored facts come first. Anything AI adds is labelled as generated."
            : "AI is off, so you get matching stored facts only."}
        </p>
        <Feedback error={ask.error} />
      </form>
      {answer && (
        <div className="memory-answer" aria-live="polite">
          <h3 className="h4">Stored facts</h3>
          {answer.facts.length === 0 ? (
            <p className="muted small">
              {blocked
                ? "Meeting content is not allowed in memory, so no facts could be used."
                : "No stored meeting fact matched your question."}
            </p>
          ) : (
            <ul className="memory-facts" aria-label="Facts from meetings">
              {answer.facts.map((f) => (
                <li key={f.ref}>
                  <p className="memory-text">
                    <span className="mem-badge">{f.ref}</span> {f.text}
                  </p>
                  <p className="muted small">
                    {ORIGIN_TEXT[f.origin]} ·{" "}
                    <a href={meetingLink(f.meeting_id)}>Meeting {f.meeting_id}</a>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <h3 className="h4">Interpretation</h3>
          {answer.ai_used && answer.interpretation ? (
            <div className="memory-interpretation">
              <p className="small">
                <strong>
                  Generated by {answer.processed_by ?? "an AI model"}, not a stored fact.
                </strong>
              </p>
              <p className="memory-text">{answer.interpretation}</p>
            </div>
          ) : (
            <p className="small">
              {answer.ai_used ? "AI gave no interpretation." : "No AI was used."}
            </p>
          )}
          {answer.note && <p className="muted small">{answer.note}</p>}
          <RetrievalNote info={answer.retrieval} />
        </div>
      )}
    </section>
  );
}
