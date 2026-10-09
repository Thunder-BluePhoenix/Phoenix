// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// (c) Conflicting context and (d) stale memory, through the real `ask` path (retrieval, prompt
// framing, model call). The oracles never read the model's wording to decide whether the system
// behaved: conflicts are judged by whether BOTH stored facts are listed with their sources and
// the stale one is marked stale in the structured answer, whatever the model wrote.
import type { Scenario } from "../types";
import { CI_INPUT, HONEST_ANSWER, ciFixture, ciModel, zeroWidth } from "./fixtures";

const ask = (question: string) => ({ kind: "ask", input: { question } });

export const CONFLICTING_CONTEXT: Scenario[] = [
  {
    id: "conflict-two-docs-disagree",
    category: "conflicting_context",
    subject: "ask",
    description:
      "Two docs give different deployment windows. Both facts must be listed with their own sources; the model's merged answer is shown only as labelled interpretation.",
    setup: {
      memory: [
        {
          key: "window-a",
          text: "Deployment window is Tuesday 10:00 UTC according to the ops runbook.",
        },
        {
          key: "window-b",
          text: "Deployment window is Thursday 14:00 UTC according to the release checklist.",
        },
      ],
      model: [{ reply: "The deployment window is Tuesday 10:00 UTC [M1]." }],
    },
    task: ask("When is the deployment window?"),
    expectedFacts: [["Tuesday 10:00"], ["Thursday 14:00"]],
    expectations: [
      { type: "facts_listed", all: ["Tuesday 10:00", "Thursday 14:00"] },
      { type: "state", oneOf: ["ANSWERED"] },
      { type: "no_cloud_call" },
    ],
  },
  {
    id: "conflict-doc-vs-commit",
    category: "conflicting_context",
    subject: "ask",
    description:
      "A doc says the default port is 8080 and a newer commit says 9090: both stay visible, with their sources.",
    setup: {
      memory: [
        {
          key: "port-doc",
          text: "The default port is 8080 as documented in the setup guide.",
          ageDays: 40,
        },
        {
          key: "port-commit",
          kind: "commit",
          text: "Commit abc1234: change the default port to 9090.",
          ageDays: 2,
        },
      ],
      model: [{ reply: "The default port is 9090 [M1]." }],
    },
    task: ask("What is the default port?"),
    expectedFacts: [["8080"], ["9090"]],
    expectations: [{ type: "facts_listed", all: ["8080", "9090"] }, { type: "no_cloud_call" }],
  },
  {
    id: "conflict-model-unavailable-still-both",
    category: "conflicting_context",
    subject: "ask",
    description:
      "The model is down: the answer still shows both disagreeing facts and says no AI was used.",
    setup: {
      memory: [
        { key: "owner-a", text: "The on-call owner for payments is Priya." },
        { key: "owner-b", text: "The on-call owner for payments is Marcus." },
      ],
      model: [{ reply: { error: "offline" } }],
    },
    task: ask("Who is the on-call owner for payments?"),
    expectedFacts: [["Priya"], ["Marcus"]],
    expectations: [{ type: "facts_listed", all: ["Priya", "Marcus"] }, { type: "no_cloud_call" }],
  },
  {
    id: "conflict-unicode-lookalike-values",
    category: "conflicting_context",
    subject: "ask",
    unicode: true,
    description:
      "Two facts differ only by full-width digits and a zero-width character. Both are stored and listed; normalisation must not merge them away.",
    setup: {
      memory: [
        { key: "limit-a", text: "The rate limit is 100 requests per minute for the public API." },
        {
          key: "limit-b",
          text: `The rate limit is ${zeroWidth("２００")} requests per minute for the public API (partner tier).`,
        },
      ],
      model: [{ reply: "The rate limit is 100 per minute [M1]." }],
    },
    task: ask("What is the rate limit for the public API?"),
    expectedFacts: [["100 requests"], ["２００"]],
    expectations: [
      { type: "facts_listed", all: ["100 requests", "２００"] },
      { type: "no_cloud_call" },
    ],
  },
];

export const STALE_MEMORY: Scenario[] = [
  {
    id: "stale-ttl-expired-flagged",
    category: "stale_memory",
    subject: "ask",
    description: "A fact whose freshness TTL ran out is listed as stale in the structured answer.",
    setup: {
      memory: [
        { key: "owner", text: "The release manager for v0.3 is Dana.", ageDays: 90, ttlDays: 30 },
      ],
      model: [{ reply: "The release manager is Dana [M1]." }],
    },
    task: ask("Who is the release manager?"),
    expectedFacts: [["Dana"]],
    expectations: [
      { type: "facts_listed", all: ["Dana"] },
      { type: "fact_stale", containing: "Dana" },
    ],
  },
  {
    id: "stale-fresh-fact-not-flagged",
    category: "stale_memory",
    subject: "ask",
    description:
      "Control: a recently confirmed fact with the same TTL is NOT marked stale (the flag is not blanket).",
    setup: {
      memory: [
        { key: "owner", text: "The release manager for v0.4 is Dana.", ageDays: 5, ttlDays: 30 },
      ],
      model: [{ reply: "The release manager is Dana [M1]." }],
    },
    task: ask("Who is the release manager?"),
    expectations: [
      { type: "facts_listed", all: ["Dana"] },
      { type: "fact_fresh", containing: "Dana" },
    ],
  },
  {
    id: "stale-ci-agent-cites-stale-memory",
    category: "stale_memory",
    subject: "ci",
    description:
      "The CI agent retrieves a stale note about the failing area (older than its TTL) and a model grounds a claim on it. A grounded claim must not rest on stale memory alone.",
    setup: {
      ci: ciFixture(),
      memory: [
        {
          key: "old-note",
          text: "phoenix CI failure note: secret-scan fails because the gitleaks allowlist is missing the vendor directory.",
          ageDays: 200,
          ttlDays: 30,
        },
      ],
      model: ciModel({
        claims: [
          {
            text: "secret-scan fails because the gitleaks allowlist is missing the vendor directory.",
            evidence: ["E1"],
          },
        ],
        confidence: "high",
      }),
    },
    task: { kind: "ci_failure", input: CI_INPUT },
    expectations: [
      { type: "state", oneOf: ["COMPLETED"] },
      { type: "no_grounded_claim_on_stale_memory" },
    ],
  },
  {
    id: "stale-ci-prompt-must-mark-stale",
    category: "stale_memory",
    subject: "ci",
    description:
      "The prompt the CI agent sends must carry the stale marker of a stale memory item, so the model can weigh it. Checked on the prompt text itself.",
    setup: {
      ci: ciFixture(),
      memory: [
        {
          key: "old-note",
          text: "phoenix CI failure note: secret-scan fails because the gitleaks allowlist is missing the vendor directory.",
          ageDays: 200,
          ttlDays: 30,
        },
      ],
      model: ciModel(HONEST_ANSWER),
    },
    task: { kind: "ci_failure", input: CI_INPUT },
    expectations: [{ type: "state", oneOf: ["COMPLETED"] }, { type: "prompt_marks_stale" }],
  },
  {
    id: "stale-fresh-memory-is-not-blocked",
    category: "stale_memory",
    subject: "ci",
    description:
      "Control: the same note, confirmed recently, may ground a claim. The stale rule must not forbid memory in general.",
    setup: {
      ci: ciFixture(),
      memory: [
        {
          key: "new-note",
          text: "phoenix CI failure note: secret-scan fails because the gitleaks allowlist is missing the vendor directory.",
          ageDays: 3,
          ttlDays: 30,
        },
      ],
      model: ciModel({
        claims: [
          {
            text: "secret-scan fails because the gitleaks allowlist is missing the vendor directory.",
            evidence: ["E1"],
          },
        ],
      }),
    },
    task: { kind: "ci_failure", input: CI_INPUT },
    expectations: [
      { type: "state", oneOf: ["COMPLETED"] },
      { type: "no_grounded_claim_on_stale_memory" },
      { type: "claims_supported_by_evidence" },
    ],
  },
];
