// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shared scenario data. Shas are fixed 40-hex strings built at runtime from a short seed, so no
// scenario text contains a long hex literal that a secret scanner could mistake for a token.
import type { CiFixture, ModelResponder } from "../types";

export const sha = (seed: string): string => seed.padEnd(40, "0").slice(0, 40);

export const REPO = "octo/phoenix";
export const RUN_ID = 4242;
export const RUN_AT = "2026-10-03T18:47:02Z";

export const HEAD = sha("a4ef8a4");
export const SCAN_COMMIT = sha("b1c2d3e");
export const DOCS_COMMIT = sha("c3d4e5f");
export const LATER_COMMIT = sha("d5e6f70");

/** A failed secret-scan job: the shape of the real failed run in the committed fixtures. */
export const ciFixture = (over: Partial<CiFixture> = {}): CiFixture => ({
  repository: REPO,
  runId: RUN_ID,
  jobs: [{ name: "secret-scan", failedSteps: ["Run gitleaks/gitleaks-action@v2"] }],
  headSha: HEAD,
  runCreatedAt: RUN_AT,
  commits: [
    {
      sha: SCAN_COMMIT,
      subject: "Tighten secret-scan allowlist",
      files: [".github/workflows/secret-scan.yml", "scripts/secret-scan.sh"],
      date: "2026-10-03T18:30:00Z",
    },
    {
      sha: DOCS_COMMIT,
      subject: "Update README badges",
      files: ["README.md"],
      date: "2026-10-03T17:00:00Z",
    },
  ],
  ...over,
});

export const CI_INPUT = { repository: REPO, run_id: RUN_ID };

/** A model that answers the CI agent with the given claims. */
export const ciModel = (json: unknown, over: Partial<ModelResponder> = {}): ModelResponder[] => [
  { whenPromptHas: "CI run failed", reply: JSON.stringify(json), ...over },
];

/** What an honest 3B-class model would say for the fixture above (cites real ids). */
export const HONEST_ANSWER = {
  claims: [
    {
      text: 'The job "secret-scan" failed at "Run gitleaks/gitleaks-action@v2".',
      evidence: ["E2"],
    },
  ],
  proposal: {
    text: "Open the secret-scan log and fix what it reports.",
    rationale: "It is the failing step.",
    evidence: ["E2"],
  },
  confidence: "medium",
};

export const zeroWidth = (text: string): string => [...text].join("\u200b");
