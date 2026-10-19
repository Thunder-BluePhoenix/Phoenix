// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { formatDate, formatNumber } from "../core/format";
import { useAction, useGraphNeighbors, useGraphNode, useGraphStatus } from "../core/hooks";
import { MAX_QUESTION } from "../core/review";
import type {
  GraphAnswer,
  GraphAsk,
  GraphEdge,
  GraphNode,
  GraphPath,
  GraphProvenance,
  GraphWorldEntity,
  GraphWorldResult,
  GraphTruncation,
} from "../core/types";
import { isMessageKey, useLocale, useT, type MessageKey, type Translate } from "../i18n";
import { intlLocale } from "../i18n/supported";
import { SENSITIVITY_LABEL } from "./AnswerView";
import { Feedback } from "./Feedback";
import { RetrievalNote } from "./RetrievalNote";

export const provenanceHref = (nodeId: string) => `#/provenance/${encodeURIComponent(nodeId)}`;

const SOURCE_KEY: Record<GraphProvenance["source_kind"], MessageKey> = {
  event: "memory.prov.source.event",
  capability: "memory.prov.source.capability",
  memory: "memory.prov.source.memory",
  meeting: "memory.prov.source.meeting",
  meeting_item: "memory.prov.source.meeting_item",
  user: "memory.prov.source.user",
};

const TRUNCATION_KEY: Record<keyof GraphTruncation, MessageKey> = {
  depth: "memory.prov.limit.depth",
  fanout: "memory.prov.limit.fanout",
  visited: "memory.prov.limit.visited",
  time: "memory.prov.limit.time",
  results: "memory.prov.limit.results",
};

const percent = (confidence: number) =>
  formatNumber(confidence, undefined, { style: "percent", maximumFractionDigits: 0 });

/** The entity type in words; a type this version does not know is shown as Core sent it. */
function typeLabel(type: string, t: Translate): string {
  const key = `memory.prov.type.${type}`;
  return isMessageKey(key) ? t(key) : type;
}

/** The relation read as a verb phrase, from the edge's source to its target. */
function relText(rel: string, t: Translate): string {
  const key = `memory.prov.rel.${rel}`;
  return isMessageKey(key) ? t(key) : rel.toLowerCase();
}

function assertorText(asserted: string, t: Translate): string {
  if (asserted.startsWith("ai:")) return t("memory.prov.assertor.ai", { model: asserted.slice(3) });
  if (asserted === "user") return t("memory.prov.assertor.user");
  return asserted === "rule"
    ? t("memory.prov.assertor.rule")
    : t("memory.prov.assertor.capability");
}

/** Stored source words are displayed only when the provenance carries an actual quote. */
function storedQuote(p: GraphProvenance): string | null {
  if (p.source_kind === "meeting_item") return null;
  const text = p.detail.text ?? p.detail.title;
  return typeof text === "string" && text.length > 0 ? text : null;
}

function detailLines(p: GraphProvenance): string[] {
  return Object.entries(p.detail)
    .filter(([key]) => key !== "text" && key !== "title" && key !== "source_quote")
    .map(([key, value]) => `${key}: ${String(value)}`);
}

/** One piece of evidence: where the claim was read, how sure, and the stored words. */
function Evidence({ row }: { row: GraphProvenance }) {
  const t = useT();
  const quote = storedQuote(row);
  const idCode = (
    <code className="break">
      {row.source_kind}:{row.source_id}
    </code>
  );
  return (
    <li className="evidence">
      <p className="small">
        {t.rich(
          row.source_kind === "meeting"
            ? "memory.prov.evidence.lineMeeting"
            : "memory.prov.evidence.line",
          {
            label: <strong>{t("memory.prov.evidence.id")}</strong>,
            id: idCode,
            source: t(SOURCE_KEY[row.source_kind]),
            link: (
              <a href={`#/meetings/${encodeURIComponent(row.source_id)}`}>
                {t("memory.prov.evidence.openMeeting")}
              </a>
            ),
          },
        )}
      </p>
      <p className="small muted">
        {t.rich("memory.prov.evidence.meta", {
          assertor: assertorText(row.asserted_by, t),
          confidence: percent(row.confidence),
          capability: row.capability,
          date: <time dateTime={row.observed_at}>{formatDate(row.observed_at)}</time>,
          sensitivity: SENSITIVITY_LABEL[row.sensitivity],
        })}
      </p>
      {row.source_kind === "meeting_item" ? (
        typeof row.detail.text === "string" && <p className="memory-text">{row.detail.text}</p>
      ) : quote ? (
        <blockquote className="quote">{quote}</blockquote>
      ) : (
        <p className="muted small">{t("memory.prov.evidence.noQuote")}</p>
      )}
      {typeof row.detail.source_quote === "string" && row.detail.source_quote.length > 0 && (
        <p className="small">
          {t.rich("memory.prov.evidence.sourceQuote", {
            label: <strong>{t("memory.prov.evidence.sourceQuoteLabel")}</strong>,
            quote: <q className="memory-text">{row.detail.source_quote}</q>,
          })}
        </p>
      )}
      {detailLines(row).map((line) => (
        <p key={line} className="muted small memory-text">
          {line}
        </p>
      ))}
    </li>
  );
}

/** "Why do you think this?": the evidence behind a node or an edge, opened on request. */
function WhyButton({ label, rows }: { label: string; rows: GraphProvenance[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("memory.prov.whyLabel", { label })}
        onClick={() => setOpen(!open)}
      >
        {t("memory.prov.why")}
      </button>
      <div id={id} hidden={!open}>
        {open &&
          (rows.length === 0 ? (
            <p className="muted small">{t("memory.prov.noEvidence")}</p>
          ) : (
            <ul className="evidence-list" aria-label={t("memory.prov.evidenceFor", { label })}>
              {rows.map((row) => (
                <Evidence
                  key={`${row.source_kind}:${row.source_id}:${row.asserted_by}`}
                  row={row}
                />
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
}

function NodeLink({ node }: { node: Pick<GraphNode, "id" | "type" | "label"> }) {
  const t = useT();
  return (
    <a href={provenanceHref(node.id)}>
      {t("memory.prov.nodeLink", { type: typeLabel(node.type, t), label: node.label })}
    </a>
  );
}

function edgeSentence(edge: GraphEdge, nodes: Record<string, GraphNode>, t: Translate) {
  const label = (id: string) => nodes[id]?.label ?? id;
  return t("memory.prov.edgeSentence", {
    src: label(edge.src),
    rel: relText(edge.rel, t),
    dst: label(edge.dst),
  });
}

function bestConfidence(rows: GraphProvenance[], t: Translate): string {
  return rows.length === 0
    ? t("memory.prov.unknown")
    : percent(Math.max(...rows.map((r) => r.confidence)));
}

function EdgeRow({ edge, nodes }: { edge: GraphEdge; nodes: Record<string, GraphNode> }) {
  const t = useT();
  const sentence = edgeSentence(edge, nodes, t);
  const src = nodes[edge.src];
  const dst = nodes[edge.dst];
  return (
    <li className="edge-row">
      <p className="memory-text">
        {t.rich("memory.prov.edgeRow", {
          src: src ? <NodeLink node={src} /> : edge.src,
          rel: <strong>{relText(edge.rel, t)}</strong>,
          code: edge.rel,
          dst: dst ? <NodeLink node={dst} /> : edge.dst,
        })}
      </p>
      <p className="muted small">
        {t("memory.prov.edge.meta", {
          status:
            edge.status === "proposed"
              ? t("memory.prov.edge.proposed")
              : t("memory.prov.edge.fact"),
          confidence: bestConfidence(edge.provenance, t),
          count: edge.provenance.length,
        })}
      </p>
      <WhyButton label={sentence} rows={edge.provenance} />
    </li>
  );
}

/** A path as numbered steps, each with its relation and confidence. This is the text form of the chain. */
function PathView({ path }: { path: GraphPath }) {
  const t = useT();
  const nodes: Record<string, GraphNode> = {};
  for (const n of path.nodes) nodes[n.id] = n;
  return (
    <div className="path">
      <ol className="path-steps" aria-label={t("memory.prov.chain")}>
        {path.hops.map((hop) => (
          <li key={hop.edge.id}>
            <span className="memory-text">{edgeSentence(hop.edge, nodes, t)}</span>
            <span className="muted small">
              {" "}
              {t(hop.edge.status === "proposed" ? "memory.prov.hopProposed" : "memory.prov.hop", {
                code: hop.edge.rel,
                direction:
                  hop.direction === "forward"
                    ? t("memory.prov.forward")
                    : t("memory.prov.backward"),
                confidence: bestConfidence(hop.edge.provenance, t),
              })}
            </span>
            <WhyButton label={edgeSentence(hop.edge, nodes, t)} rows={hop.edge.provenance} />
          </li>
        ))}
      </ol>
      <p className="muted small memory-text">{path.text}</p>
    </div>
  );
}

function TruncationNote({ truncated }: { truncated: GraphTruncation }) {
  const t = useT();
  const { locale } = useLocale();
  const cut = (Object.keys(truncated) as (keyof GraphTruncation)[]).map((k) =>
    t(TRUNCATION_KEY[k]),
  );
  const list = new Intl.ListFormat(intlLocale(locale), { type: "unit" }).format(cut);
  return cut.length === 0 ? null : (
    <p className="muted small">{t("memory.prov.truncated", { limits: list })}</p>
  );
}

function AnswerSection({ answer }: { answer: GraphAnswer }) {
  const t = useT();
  const subject = answer.subject ? <NodeLink node={answer.subject} /> : t("memory.prov.thisEntity");
  if (answer.kind === "why") {
    return (
      <section aria-label={t("memory.prov.answer.whyLabel")}>
        <h3 className="h4">{t.rich("memory.prov.answer.why", { subject })}</h3>
        {answer.paths.length === 0 ? (
          <p className="muted small">{t("memory.prov.answer.noReason")}</p>
        ) : (
          answer.paths.map((p, i) => <PathView key={i} path={p} />)
        )}
        <TruncationNote truncated={answer.truncated} />
      </section>
    );
  }
  if (answer.kind === "which") {
    return (
      <section aria-label={t("memory.prov.answer.whichLabel")}>
        <h3 className="h4">
          {t.rich("memory.prov.answer.which", { type: typeLabel(answer.type, t), subject })}
        </h3>
        {answer.results.length === 0 ? (
          <p className="muted small">{t("memory.prov.answer.noneFound")}</p>
        ) : (
          <ul className="card-list">
            {answer.results.map((r) => (
              <li key={r.node.id} className="card">
                <p>
                  <NodeLink node={r.node} />
                </p>
                <PathView path={r.path} />
              </li>
            ))}
          </ul>
        )}
        <TruncationNote truncated={answer.truncated} />
      </section>
    );
  }
  return (
    <section aria-label={t("memory.prov.answer.whoLabel")}>
      <h3 className="h4">{t.rich("memory.prov.answer.who", { subject })}</h3>
      {answer.people.length === 0 ? (
        <p className="muted small">{t("memory.prov.answer.noPeople")}</p>
      ) : (
        <ul className="card-list">
          {answer.people.map((p) => (
            <li key={p.person.id} className="card">
              <p>
                <NodeLink node={p.person} />
              </p>
              {p.paths.map((path, i) => (
                <PathView key={i} path={path} />
              ))}
            </li>
          ))}
        </ul>
      )}
      <TruncationNote truncated={answer.truncated} />
    </section>
  );
}

function GraphSearch() {
  const t = useT();
  const { run, busy, error } = useAction();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<GraphAsk | null>(null);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setResult(null);
    const res = await run<GraphAsk>("POST", "/api/graph/ask", { question: q });
    if (res) setResult(res);
  };
  return (
    <section aria-labelledby="graph-ask-h" className="card">
      <h2 id="graph-ask-h" className="h3">
        {t("memory.prov.ask.title")}
      </h2>
      <form className="memory-form" onSubmit={(e) => void submit(e)} role="search">
        <label htmlFor={id} className="small">
          {t("memory.prov.ask.label")}
        </label>
        <div className="memory-row">
          <input
            id={id}
            type="text"
            value={question}
            maxLength={MAX_QUESTION}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
            {t("memory.prov.ask.find")}
          </button>
        </div>
        <Feedback error={error} />
      </form>
      {result && (
        <div aria-live="polite">
          <h3 className="h4">{t("memory.prov.ask.entities")}</h3>
          {result.seeds.length === 0 ? (
            <p className="muted small">{result.notes[0] ?? t("memory.prov.ask.noMatch")}</p>
          ) : (
            <ul className="task-list" aria-label={t("memory.prov.ask.entities")}>
              {result.seeds.map((n) => (
                <li key={n.id}>
                  <NodeLink node={n} />{" "}
                  <span className="muted small">{t("memory.prov.ask.openOrigin")}</span>
                </li>
              ))}
            </ul>
          )}
          {result.answers.map((a, i) => (
            <AnswerSection key={i} answer={a} />
          ))}
          {result.documents.length > 0 && (
            <>
              <h3 className="h4">{t("memory.prov.ask.related")}</h3>
              <ul className="memory-facts">
                {result.documents.map((d) => (
                  <li key={d.id}>
                    <p className="memory-text">{d.text}</p>
                    <p className="muted small memory-text">
                      {d.source}: {d.source_ref}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <RetrievalNote info={result.retrieval} />
        </div>
      )}
    </section>
  );
}
/** An exact failure key, not a free-text guess or a causal diagnosis. */
function FailureSearch() {
  const t = useT();
  const { run, busy, error } = useAction();
  const [key, setKey] = useState("");
  const [asOf, setAsOf] = useState("");
  const [result, setResult] = useState<GraphWorldResult | null>(null);
  const id = useId();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const exact = key.trim();
    if (!exact) return;
    setResult(null);
    const query = asOf.trim() ? `?asOf=${encodeURIComponent(asOf.trim())}` : "";
    const response = await run<GraphWorldResult>(
      "GET",
      `/api/graph/world/failures/${encodeURIComponent(exact)}/chains${query}`,
    );
    if (response) setResult(response);
  };
  return (
    <section className="card" aria-labelledby="failure-search-h">
      <h2 id="failure-search-h" className="h3">
        {t("memory.prov.failure.title")}
      </h2>
      <p className="muted small">{t("memory.prov.failure.intro")}</p>
      <form className="memory-form" onSubmit={(event) => void submit(event)} role="search">
        <label htmlFor={id}>{t("memory.prov.failure.idLabel")}</label>
        <div className="memory-row">
          <input
            id={id}
            type="text"
            className="break"
            maxLength={400}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
            {t("memory.prov.failure.find")}
          </button>
        </div>
        <label htmlFor={`${id}-as-of`}>{t("memory.prov.failure.asOfLabel")}</label>
        <input
          id={`${id}-as-of`}
          type="text"
          maxLength={35}
          value={asOf}
          onChange={(event) => setAsOf(event.target.value)}
          placeholder="2026-10-10T02:00:00Z"
        />
        <Feedback error={error} />
      </form>
      {result && <WorldTrails result={result} />}
    </section>
  );
}

function WorldEntity({ entity, label }: { entity: GraphWorldEntity; label: string }) {
  const t = useT();
  return (
    <div className="memory-text">
      <p>{t.rich("memory.prov.world.entity", { label, node: <NodeLink node={entity.node} /> })}</p>
      <p className="muted small">
        {t.rich("memory.prov.world.entityMeta", {
          confidence: percent(entity.confidence),
          date: <time dateTime={entity.observed_at}>{formatDate(entity.observed_at)}</time>,
          age: entity.age_ms,
        })}
      </p>
      <WhyButton
        label={t("memory.prov.world.entityWhy", { label, node: entity.node.label })}
        rows={entity.provenance}
      />
    </div>
  );
}

function WorldTrails({ result }: { result: GraphWorldResult }) {
  const t = useT();
  return (
    <div aria-live="polite">
      <p className="muted small">
        {t.rich("memory.prov.world.asOf", {
          date: <time dateTime={result.as_of}>{formatDate(result.as_of)}</time>,
          age: result.max_age_ms,
        })}
      </p>
      {!result.subject ? (
        <p>{t("memory.prov.world.noSubject")}</p>
      ) : (
        <>
          <WorldEntity entity={result.subject} label={t("memory.prov.world.failure")} />
          {result.chains.length === 0 ? (
            <p>{t("memory.prov.world.noChains")}</p>
          ) : (
            <ol aria-label={t("memory.prov.failure.title")} className="card-list">
              {result.chains.map((chain, index) => (
                <li className="card" key={index}>
                  <h3 className="h4">
                    {t("memory.prov.world.trail", { n: formatNumber(index + 1) })}
                  </h3>
                  <p className="small">
                    {t("memory.prov.world.trailMeta", {
                      interpretation: chain.interpretation,
                      confidence: percent(chain.confidence),
                    })}
                  </p>
                  <ol
                    aria-label={t("memory.prov.world.trailSteps", { n: formatNumber(index + 1) })}
                    className="path-steps"
                  >
                    {chain.hops.map((hop, step) => {
                      const entity = chain.nodes[step + 1];
                      return (
                        <li key={`${hop.edge.id}:${step}`}>
                          <p className="memory-text">
                            {t("memory.prov.world.hopMeaning", {
                              meaning: hop.meaning,
                              code: hop.edge.rel,
                            })}
                          </p>
                          <p className="muted small memory-text">
                            {t.rich("memory.prov.world.hopMeta", {
                              from: hop.from,
                              to: hop.to,
                              confidence: percent(hop.confidence),
                              date: (
                                <time dateTime={hop.observed_at}>
                                  {formatDate(hop.observed_at)}
                                </time>
                              ),
                              age: hop.age_ms,
                            })}
                          </p>
                          <WhyButton
                            label={t("memory.prov.world.stepLabel", {
                              n: formatNumber(step + 1),
                              meaning: hop.meaning,
                            })}
                            rows={hop.provenance}
                          />
                          {entity && (
                            <WorldEntity
                              entity={entity}
                              label={t("memory.prov.world.stepEntity", {
                                n: formatNumber(step + 1),
                              })}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <TruncationNote truncated={result.truncated} />
    </div>
  );
}

export function ProvenancePage() {
  const t = useT();
  const { data: status, error } = useGraphStatus();
  const types = Object.entries(status?.visible_nodes_by_type ?? {}).filter(([, n]) => n > 0);
  return (
    <div className="meetings provenance">
      <h1>{t("memory.prov.page.title")}</h1>
      <p className="muted">{t("memory.prov.page.intro")}</p>
      <GraphSearch />
      <FailureSearch />
      <section aria-labelledby="graph-status-h" className="card">
        <h2 id="graph-status-h" className="h3">
          {t("memory.prov.page.knows")}
        </h2>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {status && types.length === 0 && (
          <p className="muted small">{t("memory.prov.page.empty")}</p>
        )}
        {types.length > 0 && (
          <ul className="task-list" aria-label={t("memory.prov.page.byType")}>
            {types.map(([type, n]) => (
              <li key={type}>
                {t("memory.prov.page.typeCount", { type: typeLabel(type, t), n: formatNumber(n) })}
              </li>
            ))}
          </ul>
        )}
        {status?.last_ingest && (
          <p className="muted small">
            {t.rich("memory.prov.page.lastRead", {
              date: (
                <time dateTime={status.last_ingest.at}>{formatDate(status.last_ingest.at)}</time>
              ),
            })}
          </p>
        )}
      </section>
    </div>
  );
}

export function ProvenanceNode({ nodeId }: { nodeId: string }) {
  const t = useT();
  const { data, error } = useGraphNode(nodeId);
  const [depth, setDepth] = useState<1 | 2>(1);
  const near = useGraphNeighbors(nodeId, depth);

  if (error && !data) {
    return (
      <div className="meetings">
        <p role="alert">
          {t.rich("memory.prov.node.missing", {
            link: <a href="#/provenance">{t("memory.prov.node.backToSearch")}</a>,
          })}
        </p>
      </div>
    );
  }
  if (!data) return <p className="muted">{t("common.status.loading")}</p>;

  const { node, origin, summary } = data;
  const nodes: Record<string, GraphNode> = {};
  for (const n of near.data?.nodes ?? []) nodes[n.id] = n;
  nodes[node.id] = node;
  const edges = near.data?.edges ?? [];
  const into = edges.filter((e) => e.dst === node.id);
  const out = edges.filter((e) => e.src === node.id);
  const further = edges.filter((e) => e.src !== node.id && e.dst !== node.id);

  return (
    <div className="meetings provenance">
      <p>
        <a href="#/provenance">{t("memory.prov.node.searchGraph")}</a>
      </p>
      <h1 className="memory-text">{node.label}</h1>
      <p className="small">
        <span className="mem-badge">{typeLabel(node.type, t)}</span>{" "}
        <strong>
          {node.status === "proposed" ? t("memory.prov.node.proposed") : t("memory.prov.node.fact")}
        </strong>
      </p>
      <p className="muted small">
        <code className="break">{node.id}</code>
      </p>

      <section aria-labelledby="origin-h" className="card">
        <h2 id="origin-h" className="h3">
          {t("memory.prov.node.originTitle")}
        </h2>
        <p className="small">
          {t("memory.prov.node.originLine", {
            sources: summary.sources,
            assertors: summary.assertors.map((a) => assertorText(a, t)).join("; "),
            visible: data.visible_edges,
          })}
        </p>
        <WhyButton label={node.label} rows={origin} />
      </section>

      <section aria-labelledby="chain-h" className="card">
        <h2 id="chain-h" className="h3">
          {t("memory.prov.node.connectedTitle")}
        </h2>
        <div role="group" aria-label={t("memory.prov.node.depthGroup")} className="chips">
          <button
            type="button"
            className="chip"
            aria-pressed={depth === 1}
            onClick={() => setDepth(1)}
          >
            {t("memory.prov.node.direct")}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={depth === 2}
            onClick={() => setDepth(2)}
          >
            {t("memory.prov.node.twoSteps")}
          </button>
        </div>
        {near.error && (
          <p className="error-text" role="alert">
            {near.error}
          </p>
        )}
        {near.data && edges.length === 0 && (
          <p className="muted small">{t("memory.prov.node.nothing")}</p>
        )}
        {into.length > 0 && (
          <>
            <h3 className="h4">{t("memory.prov.node.from", { n: formatNumber(into.length) })}</h3>
            <ul className="card-list" aria-label={t("memory.prov.node.fromList")}>
              {into.map((e) => (
                <EdgeRow key={e.id} edge={e} nodes={nodes} />
              ))}
            </ul>
          </>
        )}
        {out.length > 0 && (
          <>
            <h3 className="h4">{t("memory.prov.node.to", { n: formatNumber(out.length) })}</h3>
            <ul className="card-list" aria-label={t("memory.prov.node.toList")}>
              {out.map((e) => (
                <EdgeRow key={e.id} edge={e} nodes={nodes} />
              ))}
            </ul>
          </>
        )}
        {further.length > 0 && (
          <>
            <h3 className="h4">
              {t("memory.prov.node.further", { n: formatNumber(further.length) })}
            </h3>
            <ul className="card-list" aria-label={t("memory.prov.node.furtherList")}>
              {further.map((e) => (
                <EdgeRow key={e.id} edge={e} nodes={nodes} />
              ))}
            </ul>
          </>
        )}
        {near.data?.truncated && <p className="muted small">{t("memory.prov.node.cut")}</p>}
        <p className="muted small">{t("memory.prov.node.directionNote")}</p>
      </section>
    </div>
  );
}
