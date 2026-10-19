// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { formatDate, formatNumber } from "../core/format";
import { useAction, useMemoryBrowser, useMemorySearch, type MemorySearch } from "../core/hooks";
import type { MemoryAnswer, MemoryItem } from "../core/types";
import { useT, type MessageKey, type Translate } from "../i18n";
import { AnswerView, SENSITIVITY_LABEL } from "./AnswerView";
import { Feedback } from "./Feedback";

/** Characters of a memory shown before "Show more". */
const PREVIEW_CHARS = 200;
const ASK_MAX_CHARS = 500;

const KIND_KEY: Record<MemoryItem["kind"], MessageKey> = {
  fact: "memory.panel.kind.fact",
  interpretation: "memory.panel.kind.interpretation",
};

/** One line saying how long a memory is kept; never colour alone. */
function retentionLine(item: MemoryItem, t: Translate): string {
  if (!item.expires_at) return t("memory.panel.retention.forever");
  const date = formatDate(item.expires_at);
  return item.retention_days === null
    ? t("memory.panel.retention.expires", { date })
    : t("memory.panel.retention.days", { days: item.retention_days, date });
}

function MemoryCard({
  item,
  onForgotten,
}: {
  item: MemoryItem;
  onForgotten: (item: MemoryItem) => void;
}) {
  const t = useT();
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

  const detail = [
    retentionLine(item, t),
    item.confidence < 1
      ? t("memory.panel.confidence", {
          percent: formatNumber(item.confidence, undefined, { style: "percent" }),
        })
      : "",
    item.redacted ? t("memory.panel.redacted") : "",
  ].filter(Boolean);

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
          {expanded ? t("memory.panel.showLess") : t("memory.panel.showMore")}
        </button>
      )}
      <p className="memory-meta small">
        <span className={`mem-badge mem-kind-${item.kind}`}>{t(KIND_KEY[item.kind])}</span>
        <span className={`mem-badge mem-sens-${item.sensitivity}`}>
          {SENSITIVITY_LABEL[item.sensitivity]}
        </span>
        <span className="muted">
          {t.rich(item.source_ref ? "memory.panel.metaRef" : "memory.panel.meta", {
            domain: item.domain,
            source: item.source,
            ref: item.source_ref ?? "",
            date: <time dateTime={item.observed_at}>{formatDate(item.observed_at)}</time>,
          })}
        </span>
      </p>
      <p className="muted small">{detail.join(" · ")}</p>
      {confirming ? (
        <div className="button-row wrap">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => void forget()}
          >
            {t("memory.panel.confirmForget")}
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            {t("common.button.cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-danger-outline"
          onClick={() => setConfirming(true)}
        >
          {t("memory.panel.forget")}
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
  const t = useT();
  const domains = Object.keys(counts)
    .filter((d) => counts[d]! > 0 || d === domain)
    .sort();
  return (
    <div className="chips wrap" role="group" aria-label={t("memory.panel.domainGroup")}>
      <button
        type="button"
        className="chip"
        aria-pressed={domain === null}
        onClick={() => onChange(null)}
      >
        {t("memory.common.countChip", {
          label: t("memory.common.all"),
          count: formatNumber(everything),
        })}
      </button>
      {domains.map((d) => (
        <button
          key={d}
          type="button"
          className="chip"
          aria-pressed={domain === d}
          onClick={() => onChange(d)}
        >
          {t("memory.common.countChip", { label: d, count: formatNumber(counts[d]!) })}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ search, domain }: { search: MemorySearch; domain: string | null }) {
  const t = useT();
  const [text, setText] = useState("");
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q) void search.search(q, domain);
    else search.clear();
  };
  return (
    <form
      className="memory-form"
      onSubmit={submit}
      role="search"
      aria-label={t("memory.panel.searchForm")}
    >
      <label htmlFor={id} className="small">
        {t("memory.panel.searchLabel")}
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
          {t("memory.common.search")}
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
            {t("memory.panel.clearSearch")}
          </button>
        )}
      </div>
      <Feedback error={search.error} />
    </form>
  );
}

function AskBox({ aiEnabled }: { aiEnabled: boolean }) {
  const t = useT();
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
        {t("memory.panel.askLabel")}
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
          {t("memory.common.ask")}
        </button>
      </div>
      <p className="muted small">
        {aiEnabled ? t("memory.panel.aiOn") : t("memory.common.aiOffFactsOnly")}
      </p>
      <Feedback error={error} />
      {answer && (
        <div aria-live="polite">
          <AnswerView answer={answer} />
        </div>
      )}
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
  const t = useT();
  const { run, busy, error } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const remove = async () => {
    const res = (await run(
      "POST",
      "/api/memory/delete",
      domain === null ? { confirm: true } : { domain, confirm: true },
    )) as { deleted: number } | undefined;
    setConfirming(false);
    if (res) {
      setSaved(t("memory.panel.deleted", { count: res.deleted }));
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
            {domain === null
              ? t("memory.panel.confirmDeleteAll")
              : t("memory.panel.confirmDeleteDomain", { domain })}
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            {t("common.button.cancel")}
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
          {domain === null
            ? t("memory.panel.deleteAll")
            : t("memory.panel.deleteDomain", { domain })}
        </button>
      )}
      <Feedback error={error} saved={saved} />
    </div>
  );
}

/** Pet Panel "Memory" tab (Phase 29): browse, search, ask, forget and delete what Fawkes remembers. */
export function MemoryPanel() {
  const t = useT();
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
          {t("memory.panel.results", { count: search.hits.length, query: search.query ?? "" })}
        </p>
      ) : (
        browser.loaded && (
          <p className="muted small" role="status">
            {domain
              ? t("memory.panel.totalIn", { count: browser.total, domain })
              : t("memory.panel.total", { count: browser.total })}
          </p>
        )
      )}
      {items.length === 0 ? (
        browser.loaded && (
          <p className="muted">
            {searching ? t("memory.panel.noMatch") : t("memory.panel.nothing")}
          </p>
        )
      ) : (
        <ul
          className="memory-list"
          aria-label={searching ? t("memory.common.searchResults") : t("memory.panel.listMemories")}
        >
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
          {t("memory.panel.loadMore")}
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
