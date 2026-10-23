// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CoreClient } from "./client";
import { CoreError, NoAnswerError, UsageError } from "./errors";
import { clean, isRecord } from "./format";

/** The longest question Core accepts (`MAX_QUESTION_CHARS` in core/api/src/memory-routes.ts). */
export const MAX_QUESTION = 500;
/** A model can take a while on a local machine; the default 10 s request limit would cut it off. */
export const ASK_TIMEOUT_MS = 120_000;

const MAX_ANSWER_CHARS = 8000;
const MAX_ANSWER_LINES = 200;
const MAX_EVIDENCE = 10;
const EVIDENCE_TEXT = 240;

export interface AskEvidence {
  kind: "fact" | "retrieved_evidence";
  id: string;
  source: string;
  sourceRef: string;
  observedAt: string;
  text: string;
}

export interface AskAnswer {
  /** Generated text. A hypothesis, never a stored fact. */
  answer: string;
  provider: string;
  model: string;
  locality: "local" | "cloud" | null;
  evidence: AskEvidence[];
  note: string | null;
}

/** The words after `ask`, joined as one question; quoting is optional. */
export function parseQuestion(words: readonly (string | undefined)[]): string {
  const question = words
    .filter((w) => w !== undefined)
    .join(" ")
    .trim();
  if (question === "") throw new UsageError('Usage: phoenix ask "<question>"');
  if (question.length > MAX_QUESTION) {
    throw new UsageError(`The question must be at most ${MAX_QUESTION} characters`);
  }
  return question;
}

const bad = (): CoreError =>
  new CoreError("protocol", "Core answered the question in an unexpected shape");

const str = (value: unknown): string => (typeof value === "string" ? value : "");

function evidence(value: unknown, kind: AskEvidence["kind"]): AskEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw bad();
  return value.filter(isRecord).map((item) => ({
    kind,
    id: str(item.id),
    source: str(item.source),
    sourceRef: str(item.source_ref),
    observedAt: str(item.observed_at),
    text: str(item.text),
  }));
}

/**
 * Reads Core's memory answer. Core answers 200 with facts but no generated text when AI is off, no
 * provider is allowed, or nothing matched. A command that promises an AI answer must not present
 * those facts as one, so that case is a failure carrying Core's own explanation.
 */
export function parseAnswer(value: unknown): AskAnswer {
  if (!isRecord(value) || typeof value.ai_used !== "boolean") throw bad();
  const note = typeof value.note === "string" && value.note !== "" ? clean(value.note, 300) : null;
  const text = typeof value.interpretation === "string" ? value.interpretation.trim() : "";
  if (!value.ai_used || text === "") {
    throw new NoAnswerError(
      note ?? "Core produced no AI answer (AI may be off or nothing in memory matched).",
    );
  }
  const locality = value.locality === "local" || value.locality === "cloud" ? value.locality : null;
  return {
    answer: text,
    provider: str(value.provider_label) || str(value.provider),
    model: str(value.model),
    locality,
    evidence: [
      ...evidence(value.facts, "fact"),
      ...evidence(value.retrieved_evidence, "retrieved_evidence"),
    ],
    note,
  };
}

/** Asks Core's memory question route; the same one the Pet Panel chat uses. */
export async function ask(
  client: CoreClient,
  question: string,
  signal: AbortSignal,
): Promise<AskAnswer> {
  return parseAnswer(await client.request("POST", "/api/memory/ask", { question }, signal));
}

/** Model text is untrusted: one line at a time, with control and bidi characters removed. */
function answerLines(answer: string): string[] {
  const lines = answer
    .slice(0, MAX_ANSWER_CHARS)
    .split(/\r\n|\r|\n/)
    .map((line) => clean(line, 2000));
  const kept: string[] = [];
  for (const line of lines) {
    if (line === "" && (kept.length === 0 || kept[kept.length - 1] === "")) continue;
    kept.push(line);
  }
  while (kept[kept.length - 1] === "") kept.pop();
  if (kept.length > MAX_ANSWER_LINES) return [...kept.slice(0, MAX_ANSWER_LINES), "…"];
  return kept;
}

export function renderAnswer(view: AskAnswer): string {
  const where = view.locality ? ` · ${view.locality}` : "";
  const by = [view.provider, view.model].filter(Boolean).map((s) => clean(s, 60));
  const header = `Generated answer (a hypothesis, not a stored fact)${
    by.length > 0 ? ` · ${by.join(" / ")}` : ""
  }${where}`;
  const lines = [header, "", ...answerLines(view.answer)];
  if (view.evidence.length > 0) {
    lines.push("", "Evidence from memory:");
    for (const item of view.evidence.slice(0, MAX_EVIDENCE)) {
      const label = item.kind === "fact" ? "fact" : "evidence";
      lines.push(`  - [${label}] ${clean(item.source, 40)}: ${clean(item.text, EVIDENCE_TEXT)}`);
    }
    if (view.evidence.length > MAX_EVIDENCE) {
      lines.push(`  … ${view.evidence.length - MAX_EVIDENCE} more`);
    }
  }
  if (view.note) lines.push("", `Note: ${view.note}`);
  return `${lines.join("\n")}\n`;
}

/** The machine-readable form: the same data, with the generated text clearly labelled. */
export function answerJson(view: AskAnswer): Record<string, unknown> {
  return {
    answer: view.answer.slice(0, MAX_ANSWER_CHARS),
    classification: "hypothesis",
    provider: view.provider,
    model: view.model,
    locality: view.locality,
    evidence: view.evidence.slice(0, MAX_EVIDENCE),
    note: view.note,
  };
}
