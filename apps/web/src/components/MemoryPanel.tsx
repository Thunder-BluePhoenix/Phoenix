// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { formatDate } from "../core/format";
import {
  useAction,
  useMemoryBrowser,
  useMemorySearch,
  type MemorySearch,
} from "../core/hooks";
import type { MemoryAnswer, MemoryItem, MemorySensitivity } from "../core/types";
import { Feedback } from "./Feedback";

/** Characters of a memory shown before "Show more". */
const PREVIEW_CHARS = 200;
const ASK_MAX_CHARS = 500;

const SENSITIVITY_LABEL: Record<MemorySensitivity, string> = {
  public: "Public",
  internal: "Internal",
  sensitive: "Sensitive",
};

const KIND_LABEL: Record<MemoryItem["kind"], string> = {
  fact: "Stored fact",
  interpretation: "Generated interpretation",
};

/** One line saying how long a memory is kept; never colour alone. */
function retentionLine(item: MemoryItem): string {
  if (item.expires_at) {
    const days = item.retention_days === null ? "" : `${item.retention_days} days, `;
    return `Kept ${days}expires ${formatDate(item.expires_at)}`;
  }
  return "Kept until you delete it";
}

function MemoryCard({
  item,
  onForgotten,
}: {
  item: MemoryItem;
  onForgotten: (item: MemoryItem) => void;
}) {
  const { run, busy, error } = useAction();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const long = item.text.length > PREVIEW_CHARS;
  const shown = long && !expanded ? `${item.text.slice(0, PREVIEW_CHARS)}…` : item.text;

  const forget = async () => {
    const res = await run("POST", `/api/memory/${encodeURIComponent(item.id)}/forget`, {});
    setConfirming(false);
    if (res !== undefined) onForgotten(item);
  };

  return (
    <li className="memory-item">
      <p className="memory-text">{shown}</p>
      {long && (
        <button
          type="button"
          className="link-button small"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      <p className="memory-meta small">
        <span className={`mem-badge mem-kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
        <span className={`mem-badge mem-sens-${item.sensitivity}`}>
          {SENSITIVITY_LABEL[item.sensitivity]}
        </span>
        <span className="muted">
          {item.domain} · from {item.source}
          {item.source_ref ? ` (${item.source_ref})` : ""} ·{" "}
          <time dateTime={item.observed_at}>{formatDate(item.observed_at)}</time>
        </span>
      </p>
      <p className="muted small">
        {retentionLine(item)}
        {item.confidence < 1 ? ` · confidence ${Math.round(item.confidence * 100)}%` : ""}
        {item.redacted ? " · parts were redacted" : ""}
      </p>
      {confirming ? (
        <div className="button-row wrap">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => void forget()}
          >
            Confirm: forget this memory
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-danger-outline"
          onClick={() => setConfirming(true)}
        >
          Forget…
        </button>
      )}
      <Feedback error={error} />
    </li>
  );
}

function DomainFilter({
  counts,
  everything,
  domain,
  onChange,
}: {
  counts: Record<string, number>;
  everything: number;
  domain: string | null;
  onChange: (domain: string | null) => void;
}) {
  const domains = Object.keys(counts)
    .filter((d) => counts[d]! > 0 || d === domain)
    .sort();
  return (
    <div className="chips wrap" role="group" aria-label="Memory domain">
      <button
        type="button"
        className="chip"
        aria-pressed={domain === null}
        onClick={() => onChange(null)}
      >
        All ({everything})
      </button>
      {domains.map((d) => (
        <button
          key={d}
          type="button"
          className="chip"
          aria-pressed={domain === d}
          onClick={() => onChange(d)}
        >
          {d} ({counts[d]})
        </button>
      ))}
    </div>
  );
}

function SearchBox({
  search,
  domain,
}: {
  search: MemorySearch;
  domain: string | null;
}) {
  const [text, setText] = useState("");
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q) void search.search(q, domain);
    else search.clear();
  };
  return (
    <form className="memory-form" onSubmit={submit} role="search" aria-label="Memory search">
      <label htmlFor={id} className="small">
        Search memory
      </label>
      <div className="memory-row">
        <input
          id={id}
          type="search"
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn" disabled={search.busy}>
          Search
        </button>
        {search.query !== null && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setText("");
              search.clear();
            }}
          >
            Clear search
          </button>
        )}
      </div>
      <Feedback error={search.error} />
    </form>
  );
}

function Answer({ answer }: { answer: MemoryAnswer }) {
  return (
    <div className="memory-answer" aria-live="polite">
      <h4>Stored facts</h4>
      {answer.facts.length === 0 ? (
        <p className="muted small">No stored facts matched your question.</p>
      ) : (
        <ul className="memory-facts">
          {answer.facts.map((f) => (
            <li key={f.id}>
              <p className="memory-text">{f.text}</p>
              <p className="muted small">
                {f.domain} · from {f.source}
                {f.source_ref ? ` (${f.source_ref})` : ""} ·{" "}
                <time dateTime={f.observed_at}>{formatDate(f.observed_at)}</time> ·{" "}
                {SENSITIVITY_LABEL[f.sensitivity]}
              </p>
            </li>
          ))}
        </ul>
      )}
      <h4>Interpretation</h4>
      {answer.ai_used && answer.interpretation ? (
        <div className="memory-interpretation">
          <p className="small">
            <strong>Generated by {answer.processed_by ?? "an AI model"}, not a stored fact.</strong>
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

function AskBox({ aiEnabled }: { aiEnabled: boolean }) {
  const { run, busy, error } = useAction();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<MemoryAnswer | null>(null);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setAnswer(null);
    const res = (await run("POST", "/api/memory/ask", { question: q })) as MemoryAnswer | undefined;
    if (res) setAnswer(res);
  };
  return (
    <form className="memory-form" onSubmit={(e) => void submit(e)}>
      <label htmlFor={id} className="small">
        Ask Fawkes
      </label>
      <div className="memory-row">
        <input
          id={id}
          type="text"
          value={question}
          maxLength={ASK_MAX_CHARS}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
          Ask
        </button>
      </div>
      <p className="muted small">
        {aiEnabled
          ? "Answers list stored facts first. Anything AI adds is labelled as generated."
          : "AI is off, so you get matching stored facts only."}
      </p>
      <Feedback error={error} />
      {answer && <Answer answer={answer} />}
    </form>
  );
}

/** Deleting memory in bulk: everything, or one domain, each behind a literal second click. */
function DeleteMemory({
  domain,
  total,
  onDeleted,
}: {
  domain: string | null;
  total: number;
  onDeleted: () => void;
}) {
  const { run, busy, error } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const label = domain === null ? "all memory" : `${domain} memory`;
  const remove = async () => {
    const res = (await run(
      "POST",
      "/api/memory/delete",
      domain === null ? {} : { domain },
    )) as { deleted: number } | undefined;
    setConfirming(false);
    if (res) {
      setSaved(`Deleted ${res.deleted} ${res.deleted === 1 ? "memory" : "memories"}.`);
      onDeleted();
    }
  };
  return (
    <div className="memory-delete">
      {confirming ? (
        <div className="button-row wrap">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            Confirm: delete {label}
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-danger-outline"
          disabled={total === 0}
          onClick={() => {
            setSaved(null);
            setConfirming(true);
          }}
        >
          Delete {label}…
        </button>
      )}
      <Feedback error={error} saved={saved} />
    </div>
  );
}

/** Pet Panel "Memory" tab (Phase 29): browse, search, ask, forget and delete what Fawkes remembers. */
export function MemoryPanel() {
  const [domain, setDomain] = useState<string | null>(null);
  const browser = useMemoryBrowser(domain);
  const search = useMemorySearch();
  const [loadingMore, setLoadingMore] = useState(false);

  const changeDomain = (next: string | null) => {
    search.clear();
    setDomain(next);
  };
  const forgotten = (item: MemoryItem) => {
    browser.remove(item);
    search.remove(item.id);
  };
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await browser.loadMore();
    } finally {
      setLoadingMore(false);
    }
  };

  const searching = search.query !== null;
  const items: MemoryItem[] = searching ? search.hits : browser.items;
  const everything = Object.values(browser.counts).reduce((a, b) => a + b, 0);

  return (
    <div className="memory">
      <AskBox aiEnabled={browser.aiEnabled} />
      <SearchBox search={search} domain={domain} />
      <DomainFilter
        counts={browser.counts}
        everything={everything}
        domain={domain}
        onChange={changeDomain}
      />
      <Feedback error={browser.error} />
      {searching ? (
        <p className="small" role="status">
          {search.hits.length} {search.hits.length === 1 ? "result" : "results"} for “
          {search.query}”.
        </p>
      ) : (
        browser.loaded && (
          <p className="muted small" role="status">
            {browser.total} {browser.total === 1 ? "memory" : "memories"}
            {domain ? ` in ${domain}` : ""}.
          </p>
        )
      )}
      {items.length === 0 ? (
        browser.loaded && (
          <p className="muted">
            {searching ? "Nothing in memory matches that search." : "Nothing is remembered yet."}
          </p>
        )
      ) : (
        <ul className="memory-list" aria-label={searching ? "Search results" : "Memories"}>
          {items.map((item) => (
            <MemoryCard key={item.id} item={item} onForgotten={forgotten} />
          ))}
        </ul>
      )}
      {!searching && browser.items.length < browser.total && (
        <button
          type="button"
          className="btn"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          Load more
        </button>
      )}
      {domain !== null && (
        <DeleteMemory
          key={domain}
          domain={domain}
          total={browser.total}
          onDeleted={() => {
            search.clear();
            setDomain(null);
          }}
        />
      )}
      <DeleteMemory
        domain={null}
        total={everything}
        onDeleted={() => {
          search.clear();
          if (domain !== null) setDomain(null);
          else void browser.reload();
        }}
      />
    </div>
  );
}
