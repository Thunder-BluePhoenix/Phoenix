// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { exportMarkdown, mdCode, mdText, type ExportSession } from "../src/timeline-export";

const HOSTILE = [
  "[click](javascript:alert(1))",
  "![x](http://evil.example/p.png)",
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "# Heading\n- list\n> quote\n---\n| a | b |",
  "<https://evil.example>",
  "[ref]: http://evil.example",
  "*bold* _it_ ~~s~~ `code`",
  "line1\r\nline2\u001b[31m\u0000\u202e",
  "https://evil.example/auto",
];

const base = (over: Partial<ExportSession> = {}): ExportSession => ({
  id: "abc",
  live: [],
  timeline: [],
  steps: [],
  dropped_steps: 0,
  files: [],
  commits: [],
  ci_runs: [],
  ...over,
});

describe("mdText", () => {
  it("escapes every Markdown/HTML-significant character and flattens control characters", () => {
    for (const hostile of HOSTILE) {
      const out = mdText(hostile);
      expect(out).not.toMatch(/\p{Cc}/u);
      expect(out).not.toMatch(/\u202e/);
      // No unescaped ASCII punctuation survives.
      expect(out.replace(/\\[!-/:-@[-`{-~]/g, "")).not.toMatch(/[!-/:-@[-`{-~]/);
    }
    expect(mdText("[a](b)")).toBe("\\[a\\]\\(b\\)");
    expect(mdText("<b>")).toBe("\\<b\\>");
  });

  it("bounds length", () => {
    expect(mdText("x".repeat(10_000)).length).toBeLessThanOrEqual(301);
  });
});

describe("mdCode", () => {
  it("uses a fence longer than any backtick run inside, so text cannot close the span", () => {
    expect(mdCode("a ` b")).toBe("`` a ` b ``");
    expect(mdCode("a ```` b")).toBe("````` a ```` b `````");
    expect(mdCode("plain")).toBe("` plain `");
    expect(mdCode("")).toBe("(none)");
    expect(mdCode("a\nb\u0000")).not.toMatch(/\p{Cc}/u);
  });
});

describe("exportMarkdown", () => {
  it("renders a normal session", () => {
    const md = exportMarkdown(
      base({
        id: "ph-0123456789abcdef",
        session: {
          launcher: "fake",
          workspace: "/work/p",
          state: "completed",
          started_at: "t0",
          ended_at: "t1",
        },
        live: [{ agent: "claude-code", project: "/work/p", first_seen: "t0", last_seen: "t1" }],
        timeline: [{ at: "t0", kind: "session.started", detail: { launcher: "fake" } }],
        steps: [
          { n: 1, at: "t0", kind: "read", tool: "Read", target: "/work/p/a.ts", session_id: "s" },
          { n: 2, at: "t1", kind: "run", tool: "Bash", target: "npm test", session_id: "s" },
        ],
        files: [{ path: "/work/p/a.ts", added: 3, removed: 1, edits: 2, last_at: "t1" }],
        commits: [{ ref: "abc1234", repo: "p", confidence: "time+path", created_at: "t1" }],
        ci_runs: [
          {
            ref: "77",
            repo: "p",
            confidence: "sha-match",
            created_at: "t1",
            conclusion: "success",
          },
        ],
      }),
    );
    expect(md).toContain("# Agent session ph\\-0123456789abcdef");
    expect(md).toContain("` npm test `");
    expect(md).toContain("` /work/p/a.ts ` +3 \\-1");
    expect(md).toContain("` abc1234 ` in p");
    expect(md).toContain("success");
    expect(md).toContain("does not prove the agent made them");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("hostile text from every untrusted field cannot form links, images, HTML, headings, lists or tables", () => {
    for (const hostile of HOSTILE) {
      const md = exportMarkdown(
        base({
          id: hostile,
          session: { launcher: hostile, workspace: hostile, state: hostile, started_at: hostile },
          live: [{ agent: hostile, project: hostile, first_seen: hostile, last_seen: hostile }],
          timeline: [{ at: hostile, kind: hostile, detail: { [hostile]: hostile } }],
          steps: [
            { n: 1, at: hostile, kind: "run", tool: hostile, target: hostile, session_id: "s" },
          ],
          files: [{ path: hostile, added: 1, removed: 1, edits: 1, last_at: hostile }],
          commits: [{ ref: hostile, repo: hostile, confidence: hostile, created_at: hostile }],
          ci_runs: [
            {
              ref: hostile,
              repo: hostile,
              confidence: hostile,
              created_at: hostile,
              conclusion: hostile,
            },
          ],
        }),
      );
      // eslint-disable-next-line no-control-regex
      expect(md).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202e]/);
      for (const line of md.split("\n")) {
        // Take out the code spans and the escaped characters; nothing structural may remain.
        const bare = line.replace(/(`+) .*? \1/g, "").replace(/\\[!-/:-@[-`{-~]/g, "");
        if (
          /^(#{1,3} (Timeline|Steps|Files changed|Commits seen|CI runs seen|Agent session)|\d+\. |- |\*These)/.test(
            bare,
          ) ||
          bare === ""
        )
          continue;
        throw new Error(
          `unexpected structural line from ${JSON.stringify(hostile)}: ${JSON.stringify(line)}`,
        );
      }
      // No raw HTML tag or link/image syntax outside of a code span or an escape.
      const stripped = md.replace(/(`+) .*? \1/g, "").replace(/\\[!-/:-@[-`{-~]/g, "");
      expect(stripped).not.toMatch(/<[a-zA-Z/!]/);
      expect(stripped).not.toMatch(/\]\(/);
      expect(stripped).not.toMatch(/!\[/);
      expect(stripped).not.toMatch(/\]:/);
    }
  });

  it("states empty and truncated histories honestly", () => {
    const md = exportMarkdown(base({ dropped_steps: 12 }));
    expect(md).toContain("12 older step");
    expect(md).toContain("No steps recorded");
    expect(md).toContain("Nothing recorded");
    expect(md).toContain("No file changes recorded");
  });
});
