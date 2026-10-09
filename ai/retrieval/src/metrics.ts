// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Retrieval relevance metrics for the evaluation harness. A query lists the SOURCES that answer
// it (a retrieved item counts as relevant when its `source:sourceRef` key is listed), because
// document chunks and commits have no stable id across rebuilds. Metrics are over the ranked
// list of distinct source keys: a second chunk of an already-seen source is not counted twice.
//
//   recall@k = |relevant ∩ top-k| / |relevant|
//   MRR      = 1 / rank of the first relevant result (0 if none)
//   nDCG@k   = DCG@k / IDCG@k, binary gain, discount 1/log2(rank+1)
export interface EvalQuery {
  id: string;
  query: string;
  /** Keys of the relevant sources, "<source>:<sourceRef>". At least one. */
  relevant: readonly string[];
  /** Free-form tag for slicing results, for example "exact" or "paraphrase". */
  kind?: string;
}

/** A retriever under test: ranked source keys, best first. */
export type RetrieveFn = (query: EvalQuery) => Promise<readonly string[]>;

export interface QueryMetrics {
  id: string;
  kind?: string;
  recall: number;
  reciprocalRank: number;
  ndcg: number;
  /** The first relevant source's 1-based rank, or null. */
  firstRelevantRank: number | null;
  returned: string[];
}

export interface RetrievalEvaluation {
  k: number;
  queries: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  perQuery: QueryMetrics[];
}

export function sourceKey(item: { source: string; sourceRef: string }): string {
  return `${item.source}:${item.sourceRef}`;
}

/** First occurrence of each key, in order. */
export function distinctKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

export function metricsForQuery(
  query: EvalQuery,
  returnedRaw: readonly string[],
  k: number,
): QueryMetrics {
  const relevant: Record<string, true> = {};
  for (const key of query.relevant) relevant[key] = true;
  const wanted = Object.keys(relevant).length;
  const returned = distinctKeys(returnedRaw);
  const top = returned.slice(0, k);
  const hits = top.filter((key) => relevant[key] === true).length;
  const first = returned.findIndex((key) => relevant[key] === true);
  let dcg = 0;
  top.forEach((key, i) => {
    if (relevant[key] === true) dcg += 1 / Math.log2(i + 2);
  });
  let idcg = 0;
  for (let i = 0; i < Math.min(wanted, k); i++) idcg += 1 / Math.log2(i + 2);
  return {
    id: query.id,
    kind: query.kind,
    recall: wanted === 0 ? 0 : hits / wanted,
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    ndcg: idcg === 0 ? 0 : dcg / idcg,
    firstRelevantRank: first < 0 ? null : first + 1,
    returned: returned.slice(0, Math.max(k, 10)),
  };
}

const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Runs `retrieve` for every query and averages the metrics. A query with no relevant source is rejected. */
export async function evaluateRetrieval(
  queries: readonly EvalQuery[],
  retrieve: RetrieveFn,
  k = 5,
): Promise<RetrievalEvaluation> {
  if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be a positive integer");
  const perQuery: QueryMetrics[] = [];
  for (const q of queries) {
    if (q.relevant.length === 0) throw new RangeError(`Query ${q.id} lists no relevant source`);
    perQuery.push(metricsForQuery(q, await retrieve(q), k));
  }
  return {
    k,
    queries: queries.length,
    recallAtK: mean(perQuery.map((m) => m.recall)),
    mrr: mean(perQuery.map((m) => m.reciprocalRank)),
    ndcgAtK: mean(perQuery.map((m) => m.ndcg)),
    perQuery,
  };
}

/** Averages for the queries with a given `kind`. */
export function sliceByKind(evaluation: RetrievalEvaluation, kind: string): RetrievalEvaluation {
  const perQuery = evaluation.perQuery.filter((m) => m.kind === kind);
  return {
    k: evaluation.k,
    queries: perQuery.length,
    recallAtK: mean(perQuery.map((m) => m.recall)),
    mrr: mean(perQuery.map((m) => m.reciprocalRank)),
    ndcgAtK: mean(perQuery.map((m) => m.ndcg)),
    perQuery,
  };
}
