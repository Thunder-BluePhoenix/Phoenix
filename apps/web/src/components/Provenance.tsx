// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useId, useState, type FormEvent } from "react";
import { formatDate } from "../core/format";
import { useAction, useGraphNeighbors, useGraphNode, useGraphStatus } from "../core/hooks";
import { MAX_QUESTION } from "../core/review";
import type {
  GraphAnswer,
  GraphAsk,
  GraphEdge,
  GraphNode,
  GraphPath,
  GraphProvenance,
  GraphTruncation,
} from "../core/types";
import { Feedback } from "./Feedback";
import { RetrievalNote } from "./RetrievalNote";

export const provenanceHref = (nodeId: string) => `#/provenance/${encodeURIComponent(nodeId)}`;

const TYPE_LABEL: Record<string, string> = {
  Person: "Person",
  Project: "Project",
  Repository: "Repository",
  Commit: "Commit",
  Service: "Service",
  Deployment: "Deployment",
  Meeting: "Meeting",
  Decision: "Decision",
  Feature: "Feature",
  Issue: "Issue",
  PullRequest: "Pull request",
  CIRun: "CI run",
  Document: "Document",
};

/** Each relation read as a verb phrase, from the edge's source to its target. */
const REL_TEXT: Record<string, string> = {
  AUTHORED: "authored",
  TOUCHES: "changed",
  PART_OF: "is part of",
  DECIDED_IN: "was decided in",
  MENTIONS: "mentions",
  FIXES: "fixes",
  DEPLOYED_TO: "was deployed to",
  TRIGGERED: "triggered",
  ASSIGNED_TO: "is assigned to",
  REFERENCES: "references",
  PARTICIPATED_IN: "took part in",
};

const SOURCE_TEXT: Record<GraphProvenance["source_kind"], string> = {
  event: "an event Phoenix recorded",
  capability: "a capability",
  memory: "a memory item",
  meeting: "a meeting",
  meeting_item: "a reviewed meeting item",
  user: "you",
};

const TRUNCATION_TEXT: Record<keyof GraphTruncation, string> = {
  depth: "the search depth",
  fanout: "the number of branches per entity",
  visited: "the number of entities looked at",
  time: "the time limit",
  results: "the number of results",
};

const percent = (confidence: number) => `${Math.round(confidence * 100)}%`;

function assertorText(asserted: string): string {
  if (asserted.startsWith("ai:")) return `suggested by AI (${asserted.slice(3)}), not confirmed`;
  if (asserted === "user") return "confirmed by you";
  return `recorded by ${asserted === "rule" ? "a fixed rule" : "a capability"}`;
}

/** The stored words of a provenance row: its quote, as data. Never interpreted as markup. */
function storedQuote(p: GraphProvenance): string | null {
  const text = p.detail.text ?? p.detail.title;
  return typeof text === "string" && text.length > 0 ? text : null;
}

function detailLines(p: GraphProvenance): string[] {
  return Object.entries(p.detail)
    .filter(([key]) => key !== "text" && key !== "title")
    .map(([key, value]) => `${key}: ${String(value)}`);
}

/** One piece of evidence: where the claim was read, how sure, and the stored words. */
function Evidence({ row }: { row: GraphProvenance }) {
  const quote = storedQuote(row);
  return (
    <li className="evidence">
      <p className="small">
        <strong>Evidence id</strong>{" "}
        <code className="break">
          {row.source_kind}:{row.source_id}
        </code>{" "}
        ({SOURCE_TEXT[row.source_kind]}
        {row.source_kind === "meeting" && (
          <>
            {" "}
            · <a href={`#/meetings/${encodeURIComponent(row.source_id)}`}>open the meeting</a>
          </>
        )}
        )
      </p>
      <p className="small muted">
        {assertorText(row.asserted_by)} · confidence {percent(row.confidence)} · capability{" "}
        {row.capability} · seen{" "}
        <time dateTime={row.observed_at}>{formatDate(row.observed_at)}</time> ·{" "}
        {row.sensitivity === "sensitive"
          ? "Sensitive"
          : row.sensitivity === "internal"
            ? "Internal"
            : "Public"}
      </p>
      {quote ? (
        <blockquote className="quote">{quote}</blockquote>
      ) : (
        <p className="muted small">No quote is stored for this evidence.</p>
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
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Why do you think this? ${label}`}
        onClick={() => setOpen(!open)}
      >
        Why do you think this?
      </button>
      <div id={id} hidden={!open}>
        {open &&
          (rows.length === 0 ? (
            <p className="muted small">No evidence is readable for this.</p>
          ) : (
            <ul className="evidence-list" aria-label={`Evidence for ${label}`}>
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
  return (
    <a href={provenanceHref(node.id)}>
      {TYPE_LABEL[node.type] ?? node.type} “{node.label}”
    </a>
  );
}

const relText = (rel: string) => REL_TEXT[rel] ?? rel.toLowerCase();

function edgeSentence(edge: GraphEdge, nodes: Record<string, GraphNode>) {
  const label = (id: string) => nodes[id]?.label ?? id;
  return `${label(edge.src)} ${relText(edge.rel)} ${label(edge.dst)}`;
}

function bestConfidence(rows: GraphProvenance[]): string {
  return rows.length === 0 ? "unknown" : percent(Math.max(...rows.map((r) => r.confidence)));
}

function EdgeRow({ edge, nodes }: { edge: GraphEdge; nodes: Record<string, GraphNode> }) {
  const sentence = edgeSentence(edge, nodes);
  const src = nodes[edge.src];
  const dst = nodes[edge.dst];
  return (
    <li className="edge-row">
      <p className="memory-text">
        {src ? <NodeLink node={src} /> : edge.src} <strong>{relText(edge.rel)}</strong> ({edge.rel}){" "}
        {dst ? <NodeLink node={dst} /> : edge.dst}
      </p>
      <p className="muted small">
        {edge.status === "proposed" ? "Suggested, not a fact" : "Fact"} · confidence{" "}
        {bestConfidence(edge.provenance)} · {edge.provenance.length} source(s)
      </p>
      <WhyButton label={sentence} rows={edge.provenance} />
    </li>
  );
}

/** A path as numbered steps, each with its relation and confidence. This is the text form of the chain. */
function PathView({ path }: { path: GraphPath }) {
  const nodes: Record<string, GraphNode> = {};
  for (const n of path.nodes) nodes[n.id] = n;
  return (
    <div className="path">
      <ol className="path-steps" aria-label="Chain, step by step">
        {path.hops.map((hop) => (
          <li key={hop.edge.id}>
            <span className="memory-text">{edgeSentence(hop.edge, nodes)}</span>
            <span className="muted small">
              {" "}
              ({hop.edge.rel},{" "}
              {hop.direction === "forward" ? "followed forward" : "followed backward"} · confidence{" "}
              {bestConfidence(hop.edge.provenance)}
              {hop.edge.status === "proposed" ? " · suggested, not a fact" : ""})
            </span>
            <WhyButton label={edgeSentence(hop.edge, nodes)} rows={hop.edge.provenance} />
          </li>
        ))}
      </ol>
      <p className="muted small memory-text">{path.text}</p>
    </div>
  );
}

function TruncationNote({ truncated }: { truncated: GraphTruncation }) {
  const cut = (Object.keys(truncated) as (keyof GraphTruncation)[]).map((k) => TRUNCATION_TEXT[k]);
  return cut.length === 0 ? null : (
    <p className="muted small">This answer is incomplete: it stopped at {cut.join(", ")}.</p>
  );
}

function AnswerSection({ answer }: { answer: GraphAnswer }) {
  const subject = answer.subject ? <NodeLink node={answer.subject} /> : "this entity";
  if (answer.kind === "why") {
    return (
      <section aria-label="Why answer">
        <h3 className="h4">Why: what led to {subject}</h3>
        {answer.paths.length === 0 ? (
          <p className="muted small">The graph has no reason on record.</p>
        ) : (
          answer.paths.map((p, i) => <PathView key={i} path={p} />)
        )}
        <TruncationNote truncated={answer.truncated} />
      </section>
    );
  }
  if (answer.kind === "which") {
    return (
      <section aria-label="Which answer">
        <h3 className="h4">
          Which {TYPE_LABEL[answer.type] ?? answer.type} is closest to {subject}
        </h3>
        {answer.results.length === 0 ? (
          <p className="muted small">None found in the graph.</p>
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
    <section aria-label="Who answer">
      <h3 className="h4">Who is connected to {subject}</h3>
      {answer.people.length === 0 ? (
        <p className="muted small">No people found in the graph.</p>
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
        Find an entity or ask why
      </h2>
      <form className="memory-form" onSubmit={(e) => void submit(e)} role="search">
        <label htmlFor={id} className="small">
          Name a commit, pull request, issue, meeting, decision, file or person. For example “why
          ADR-0020” or “which commits touched core/api/src/server.ts”.
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
            Find
          </button>
        </div>
        <Feedback error={error} />
      </form>
      {result && (
        <div aria-live="polite">
          <h3 className="h4">Entities found</h3>
          {result.seeds.length === 0 ? (
            <p className="muted small">
              {result.notes[0] ?? "Nothing in the graph matches the question exactly."}
            </p>
          ) : (
            <ul className="task-list" aria-label="Entities found">
              {result.seeds.map((n) => (
                <li key={n.id}>
                  <NodeLink node={n} /> <span className="muted small">· open its origin</span>
                </li>
              ))}
            </ul>
          )}
          {result.answers.map((a, i) => (
            <AnswerSection key={i} answer={a} />
          ))}
          {result.documents.length > 0 && (
            <>
              <h3 className="h4">Related text (retrieved, not graph facts)</h3>
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

export function ProvenancePage() {
  const { data: status, error } = useGraphStatus();
  const types = Object.entries(status?.visible_nodes_by_type ?? {}).filter(([, n]) => n > 0);
  return (
    <div className="meetings provenance">
      <h1>Where things came from</h1>
      <p className="muted">
        Pick a commit, pull request, issue, meeting or decision to see where Phoenix learned about
        it, how sure it is, and what it is connected to. Everything is written out as text.
      </p>
      <GraphSearch />
      <section aria-labelledby="graph-status-h" className="card">
        <h2 id="graph-status-h" className="h3">
          What the graph knows
        </h2>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {status && types.length === 0 && (
          <p className="muted small">
            The graph is empty. It fills from your commits, pull requests, issues and reviewed
            meetings.
          </p>
        )}
        {types.length > 0 && (
          <ul className="task-list" aria-label="Entities by type">
            {types.map(([type, n]) => (
              <li key={type}>
                {TYPE_LABEL[type] ?? type}: {n}
              </li>
            ))}
          </ul>
        )}
        {status?.last_ingest && (
          <p className="muted small">
            Last read from memory and meetings{" "}
            <time dateTime={status.last_ingest.at}>{formatDate(status.last_ingest.at)}</time>.
          </p>
        )}
      </section>
    </div>
  );
}

export function ProvenanceNode({ nodeId }: { nodeId: string }) {
  const { data, error } = useGraphNode(nodeId);
  const [depth, setDepth] = useState<1 | 2>(1);
  const near = useGraphNeighbors(nodeId, depth);

  if (error && !data) {
    return (
      <div className="meetings">
        <p role="alert">
          Phoenix has no readable record of this entity (it may not exist, or it may have been
          removed). <a href="#/provenance">Back to search</a>
        </p>
      </div>
    );
  }
  if (!data) return <p className="muted">Loading…</p>;

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
        <a href="#/provenance">← Search the graph</a>
      </p>
      <h1 className="memory-text">{node.label}</h1>
      <p className="small">
        <span className="mem-badge">{TYPE_LABEL[node.type] ?? node.type}</span>{" "}
        <strong>
          {node.status === "proposed"
            ? "Suggested by AI, not confirmed: this is not a fact"
            : "Recorded fact"}
        </strong>
      </p>
      <p className="muted small">
        <code className="break">{node.id}</code>
      </p>

      <section aria-labelledby="origin-h" className="card">
        <h2 id="origin-h" className="h3">
          Where it came from
        </h2>
        <p className="small">
          {summary.sources} source(s) · {summary.assertors.map(assertorText).join("; ")} ·{" "}
          {data.visible_edges} connection(s) you can see.
        </p>
        <WhyButton label={node.label} rows={origin} />
      </section>

      <section aria-labelledby="chain-h" className="card">
        <h2 id="chain-h" className="h3">
          What it is connected to
        </h2>
        <div role="group" aria-label="How far to look" className="chips">
          <button
            type="button"
            className="chip"
            aria-pressed={depth === 1}
            onClick={() => setDepth(1)}
          >
            Direct
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={depth === 2}
            onClick={() => setDepth(2)}
          >
            Two steps out
          </button>
        </div>
        {near.error && (
          <p className="error-text" role="alert">
            {near.error}
          </p>
        )}
        {near.data && edges.length === 0 && (
          <p className="muted small">Nothing is connected to this yet.</p>
        )}
        {into.length > 0 && (
          <>
            <h3 className="h4">Connected from ({into.length})</h3>
            <ul className="card-list" aria-label="Connections pointing at this">
              {into.map((e) => (
                <EdgeRow key={e.id} edge={e} nodes={nodes} />
              ))}
            </ul>
          </>
        )}
        {out.length > 0 && (
          <>
            <h3 className="h4">Connected to ({out.length})</h3>
            <ul className="card-list" aria-label="Connections this points to">
              {out.map((e) => (
                <EdgeRow key={e.id} edge={e} nodes={nodes} />
              ))}
            </ul>
          </>
        )}
        {further.length > 0 && (
          <>
            <h3 className="h4">Further out ({further.length})</h3>
            <ul className="card-list" aria-label="Connections further out">
              {further.map((e) => (
                <EdgeRow key={e.id} edge={e} nodes={nodes} />
              ))}
            </ul>
          </>
        )}
        {near.data?.truncated && (
          <p className="muted small">The list was cut short to stay readable.</p>
        )}
        <p className="muted small">
          Each line reads in the direction Phoenix stored it: “A is part of B” starts at A.
          “Connected from” lists lines that end at this entity, “Connected to” lines that start at
          it.
        </p>
      </section>
    </div>
  );
}
