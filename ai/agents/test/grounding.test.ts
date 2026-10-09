// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { EvidenceBook } from "@phoenix/ai-orchestrator";
import { describe, expect, it } from "vitest";
import {
  areaTerms,
  checkCitations,
  checkCommitWording,
  coverageOf,
  filesInArea,
  parseModelAnswer,
  splitByRunTime,
  type CommitInfo,
  verifyModelClaims,
  type CommitFacts,
} from "../src";

const SHA = "a4ef8a44ea85e0e78161a10caeabfc54ec476bca";
const SHA2 = "1234567890abcdef1234567890abcdef12345678";
const commits: CommitFacts[] = [
  {
    sha: SHA,
    evidenceId: "E3",
    files: [".github/workflows/gitleaks-scan.yml", "README.md"],
    ancestorOfRun: true,
    beforeRun: true,
  },
  {
    sha: SHA2,
    evidenceId: "E4",
    files: ["apps/web/src/button.tsx"],
    ancestorOfRun: true,
    beforeRun: true,
  },
];
const terms = areaTerms(["secret-scan", "Run gitleaks/gitleaks-action@v2"]);

function book(): EvidenceBook {
  const b = new EvidenceBook();
  b.add({ kind: "tool_output", source: "t", text: "job secret-scan failed" }); // E1
  b.add({ kind: "log", source: "l", text: "   " }); // E2 (empty after trim)
  b.add({ kind: "model", source: "fake", text: "model said something" }); // E3
  return b;
}

describe("areaTerms / filesInArea", () => {
  it("takes meaningful words from job and step names, not generic ones", () => {
    expect(terms).toEqual(expect.arrayContaining(["secret", "scan", "gitleaks"]));
    expect(terms).not.toContain("run");
    expect(terms).not.toContain("action");
    expect(areaTerms(["Set up job", "Complete job", "Run actions/checkout@v4"])).toEqual([]);
    expect(areaTerms(["check", "Test (includes event schema validation)"])).toEqual([
      "event",
      "schema",
      "validation",
    ]);
  });

  it("matches changed files by area term or by a path the log names", () => {
    expect(filesInArea(commits[0]!.files, terms)).toEqual([".github/workflows/gitleaks-scan.yml"]);
    expect(filesInArea(commits[1]!.files, terms)).toEqual([]);
    expect(filesInArea(["src/a/b.ts"], [], ["src/a/b.ts"])).toEqual(["src/a/b.ts"]);
  });
});

describe("checkCitations", () => {
  it("accepts existing non-empty non-model evidence only", () => {
    expect(checkCitations(["E1"], book())).toEqual({ valid: ["E1"], invalid: [] });
    expect(checkCitations(["E9"], book()).invalid).toEqual(["E9"]); // does not exist
    expect(checkCitations(["E3"], book()).invalid).toEqual(["E3"]); // model output is not evidence
    for (const hostile of [
      "",
      "e1",
      "E1 ",
      "__proto__",
      "constructor",
      "E1;DROP",
      "E0001",
      "../E1",
      "E",
    ]) {
      expect(checkCitations([hostile], book()).valid, hostile).toEqual([]);
    }
  });
});

describe("parseModelAnswer", () => {
  it("reads a JSON answer, with or without a code fence and surrounding words", () => {
    const body = '{"claims":[{"text":"Job failed","evidence":["E1"]}],"confidence":"high"}';
    for (const text of [body, "```json\n" + body + "\n```", `Sure! ${body} Hope that helps.`]) {
      expect(parseModelAnswer(text)).toMatchObject({
        claims: [{ text: "Job failed", evidence: ["E1"] }],
        confidence: "high",
      });
    }
  });

  it.each([
    "",
    "no json here",
    "{",
    "{}",
    '{"claims":"x"}',
    '{"claims":[]}',
    '{"claims":[1,null,"x",{"text":5}]}',
    "[1,2,3]",
    "{{{{",
  ])("returns null for %j", (text) => {
    expect(parseModelAnswer(text)).toBeNull();
  });

  it("bounds claims, text and citations, flattens control characters, ignores unknown keys", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      text: `claim ${i}\u0000\n${"x".repeat(2000)}`,
      evidence: Array.from({ length: 40 }, (_, k) => `E${k}`),
      extra: { run: "rm -rf /" },
    }));
    const parsed = parseModelAnswer(
      JSON.stringify({ claims: many, run: "evil", confidence: "x".repeat(500) }),
    )!;
    expect(parsed.claims).toHaveLength(6);
    expect(parsed.claims[0]!.text.length).toBeLessThanOrEqual(400);
    expect(parsed.claims[0]!.text).not.toMatch(/[\u0000\n]/);
    expect(parsed.claims[0]!.evidence).toHaveLength(10);
    expect(parsed.confidence!.length).toBeLessThanOrEqual(40);
    expect(Object.keys(parsed.claims[0]!)).toEqual(["text", "evidence"]);
  });

  it("normalises [E2] and non-string citations, keeping garbage visible for the verifier", () => {
    const parsed = parseModelAnswer(
      '{"claims":[{"text":"a","evidence":["[E2]",7,{"x":1},"E2"]}]}',
    )!;
    expect(parsed.claims[0]!.evidence).toEqual(["E2", "(not an id)"]);
  });
});

describe("checkCommitWording: a commit may be called the cause only if its sha is in the evidence and it changed files in the failing area", () => {
  const cases: [string, string, boolean][] = [
    [
      "causal, sha known, files overlap",
      `Commit ${SHA.slice(0, 7)} broke the gitleaks scan.`,
      false,
    ],
    ["causal, sha known, no overlap", `Commit ${SHA2.slice(0, 7)} caused the failure.`, true],
    ["causal, sha not in the evidence", "Commit deadbee broke the build.", true],
    ["causal, no sha at all", "The latest commit caused this failure.", true],
    [
      "causal, one known and one unknown sha",
      `Commits ${SHA.slice(0, 7)} and deadbee broke it.`,
      true,
    ],
    ["not causal", `Commit ${SHA2.slice(0, 7)} is also in the history.`, false],
    ["causal wording without commit words", "The missing token caused the failure.", false],
    ["a full 40-char sha", `Root cause: ${SHA}.`, false],
    ["prefix matching two commits is ambiguous", "Commit 1234 caused it.", true],
  ];
  it.each(cases)("%s", (_n, text, rewritten) => {
    const out = checkCommitWording(text, commits, terms, []);
    expect(out.note !== undefined).toBe(rewritten);
    if (rewritten) {
      expect(out.text).toContain("possibly related");
      expect(out.text).not.toMatch(/\b(broke|caused|root cause)\b(?! it)/i);
    } else {
      expect(out.text).toBe(text);
    }
  });

  it("a digits-only short sha of a known commit is still recognised", () => {
    const numeric: CommitFacts[] = [
      {
        sha: "1234567890123456789012345678901234567890",
        evidenceId: "E3",
        files: ["apps/ui.ts"],
        ancestorOfRun: true,
        beforeRun: true,
      },
    ];
    const out = checkCommitWording("Commit 1234567 caused the failure.", numeric, terms, []);
    expect(out.note).toMatch(/did not change files in the failing area/);
  });
});

describe("checkCommitWording: ancestry and date order are required as well as file overlap", () => {
  const overlapping = ".github/workflows/gitleaks-scan.yml";
  const make = (over: Partial<CommitFacts>): CommitFacts[] => [
    {
      sha: SHA,
      evidenceId: "E3",
      files: [overlapping],
      ancestorOfRun: true,
      beforeRun: true,
      ...over,
    },
  ];
  const text = `Commit ${SHA.slice(0, 7)} broke the gitleaks step.`;

  it("a commit that overlaps, led to the run and is not newer is allowed to be named", () => {
    expect(checkCommitWording(text, make({}), terms, [])).toEqual({ text });
  });

  it.each([
    ["it did not lead to the run", { ancestorOfRun: false }],
    ["it is newer than the run", { beforeRun: false }],
    ["both", { ancestorOfRun: false, beforeRun: false }],
  ])(
    "a commit that overlaps but %s is refused, and not even called 'possibly related'",
    (_n, over) => {
      const out = checkCommitWording(text, make(over), terms, []);
      expect(out.note).toBe(
        "causal wording about a commit that did not lead to the run or came after it",
      );
      expect(out.text).toBe(
        "No commit in the evidence can be tied to the failure: the commit named did not lead to this run or came after it.",
      );
      expect(out.text).not.toContain(SHA.slice(0, 7));
      expect(out.text).not.toContain("possibly related");
    },
  );
});

describe("splitByRunTime: a commit dated after the run is never kept", () => {
  const commit = (
    n: number,
    date: string | null,
    committedAt: string | null = date,
  ): CommitInfo => ({
    sha: `${n}`.repeat(40).slice(0, 40),
    shortSha: `${n}`.repeat(7),
    subject: `c${n}`,
    date,
    committedAt,
    filesChanged: 0,
    files: [],
  });
  const run = "2026-10-03T18:47:02.000Z";

  it("keeps commits at or before the run and excludes later ones, by author or committer date", () => {
    const { kept, excluded } = splitByRunTime(
      [
        commit(1, "2026-10-03T18:00:00.000Z"),
        commit(2, "2026-10-03T18:47:02.000Z"),
        commit(3, "2026-10-09T09:08:00.000Z"),
        commit(4, "2026-10-03T10:00:00.000Z", "2026-10-09T10:00:00.000Z"),
        commit(5, "2026-10-09T10:00:00.000Z", "2026-10-03T10:00:00.000Z"),
      ],
      run,
    );
    expect(kept.map((c) => c.subject)).toEqual(["c1", "c2"]);
    expect(excluded.map((c) => c.subject)).toEqual(["c3", "c4", "c5"]);
  });

  it("when the order cannot be established nothing is kept: missing or unreadable dates, or an unknown run time", () => {
    expect(splitByRunTime([commit(1, null)], run).kept).toEqual([]);
    expect(splitByRunTime([commit(1, "yesterday")], run).kept).toEqual([]);
    expect(splitByRunTime([commit(1, "2026-10-03T10:00:00.000Z", null)], run).kept).toEqual([]);
    expect(splitByRunTime([commit(1, "2026-10-03T10:00:00.000Z")], null).kept).toEqual([]);
    expect(splitByRunTime([commit(1, "2026-10-03T10:00:00.000Z")], "not a date").kept).toEqual([]);
    expect(splitByRunTime([], run)).toEqual({ kept: [], excluded: [] });
  });
});

describe("verifyModelClaims and coverage", () => {
  it("computes coverage in code: a claim citing nothing, or something that does not exist, is not grounded", () => {
    const out = verifyModelClaims(
      [
        { text: "Job secret-scan failed.", evidence: ["E1"] },
        { text: "The disk is full.", evidence: [] },
        { text: "The DNS is down.", evidence: ["E77"] },
        { text: "Quoting the model.", evidence: ["E3"] },
        { text: "Empty evidence.", evidence: ["E2"] },
      ],
      book(),
      commits,
      terms,
      [],
    );
    expect(out.claims.map((c) => c.grounded)).toEqual([true, false, false, false, false]);
    expect(out.grounded).toBe(1);
    expect(out.invalidCitations).toBe(3);
    expect(coverageOf(out.claims)).toBeCloseTo(0.2);
    expect(out.claims[1]!.note).toMatch(/cites no evidence/);
    expect(out.claims[2]!.note).toMatch(/does not exist/);
    expect(out.claims[2]!.evidenceIds).toEqual([]);
    expect(out.claims.every((c) => c.origin === "model")).toBe(true);
  });

  it("a claim with one real and one invented citation is not grounded, and keeps only the real id", () => {
    const [claim] = verifyModelClaims(
      [{ text: "x", evidence: ["E1", "E50"] }],
      book(),
      commits,
      terms,
      [],
    ).claims;
    expect(claim).toMatchObject({ grounded: false, evidenceIds: ["E1"] });
  });

  it("coverage of no claims is 0, not NaN", () => {
    expect(coverageOf([])).toBe(0);
  });
});
