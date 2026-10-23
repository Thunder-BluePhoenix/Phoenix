// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The secret guard hook (Phase 79). Every secret is built at runtime (no secret-shaped literal in
// this file) and every "message never contains the secret" check looks at the whole stdout line, the
// request sent to Core and the result reported. Git runs only in temp repositories. No agent, no
// real Core: approvals and reports are scripted fakes, and the process test points the hook at a
// closed loopback port.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECRET_VALUE_PATTERNS } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  FAKE_AWS_KEY,
  FAKE_BEARER,
  FAKE_GITHUB_TOKEN,
  FAKE_GITLAB_TOKEN,
  FAKE_JWT,
  FAKE_NPM_TOKEN,
  FAKE_OPENAI_KEY,
  FAKE_STRIPE_KEY,
} from "../../../protocol/testing/fake-secrets";
import type { ApprovalOutcome } from "../src/approval-client";
import type { ApprovalRequest } from "../src/approval-map";
import { oversizeResult, readStdin, runGuard, type GuardResult } from "../src/guard-hook";
import { gatherChanges, gitIntent } from "../src/relay/guard-git";
import { GUARD_KINDS, scanDiff, scanText, scanToolInput } from "../src/relay/guard-scan";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const join2 = (...p: string[]) => p.join("");
/** A secret-named assignment the guard's own rule finds; not matched by protocol's patterns. */
const ASSIGNED = join2("Zk3", "pQ9vL2", "mX7wR5", "tY8nB4");
const ASSIGNMENT = `${join2("DB", "_PASS", "WORD")}=${ASSIGNED}`;
const PEM = join2("-----BEGIN RSA PRIV", "ATE KEY-----");
const SESSION = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-guard-")));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: dir,
      env: {
        PATH: process.env.PATH ?? "",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      stdio: "ignore",
    });
  git("init", "-q");
  writeFileSync(join(dir, "README.md"), "hello\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "init");
  return dir;
}
const gitIn = (dir: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdio: "ignore",
  });

const payload = (toolInput: unknown, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd: "/work/app",
    tool_name: "Bash",
    tool_input: toolInput,
    ...over,
  });

interface Rig {
  asked: ApprovalRequest[];
  reported: GuardResult[];
  deps: Parameters<typeof runGuard>[2];
}
function rig(
  answer: ApprovalOutcome | (() => Promise<ApprovalOutcome>) = {
    decision: null,
    reason: "Phoenix Core did not answer",
  },
): Rig {
  const asked: ApprovalRequest[] = [];
  const reported: GuardResult[] = [];
  return {
    asked,
    reported,
    deps: {
      approve: async (request) => {
        asked.push(request);
        return typeof answer === "function" ? answer() : answer;
      },
      report: async (result) => void reported.push(result),
    },
  };
}
const allowed: ApprovalOutcome = {
  decision: { behavior: "allow" },
  decidedBy: "user",
};
const denyReason = (line: string | null): string =>
  JSON.parse(line!).hookSpecificOutput.permissionDecisionReason;

describe("detector kinds", () => {
  it("names every pattern protocol has (a new pattern cannot go unnamed)", () => {
    expect(GUARD_KINDS.length).toBe(SECRET_VALUE_PATTERNS.length + 1);
  });

  it("does not flag look-alikes that are not credentials", () => {
    const lookalikes = [
      join2("sk_", "test_", "abcdefghijklmnop0123"), // Stripe test mode
      join2("np", "m_", "short"),
      join2("gl", "pat-", "short"),
      join2("ey", "Jhbgcio.not-a-jwt"), // two parts only
      "see npm_config and glpat in the docs",
    ];
    for (const text of lookalikes) expect(scanText(text, "x")).toEqual([]);
  });

  it.each([
    ["bearer_token", FAKE_BEARER],
    ["github_token", FAKE_GITHUB_TOKEN],
    ["api_key", FAKE_OPENAI_KEY],
    ["aws_access_key", FAKE_AWS_KEY],
    ["private_key", PEM],
    ["stripe_key", FAKE_STRIPE_KEY],
    ["gitlab_token", FAKE_GITLAB_TOKEN],
    ["npm_token", FAKE_NPM_TOKEN],
    ["jwt", FAKE_JWT],
    ["slack_token", join2("xo", "xb-1234567890-abcdefghij")],
    ["secret_assignment", ASSIGNMENT],
  ])("finds %s and reports only a kind and a place", (kind, secret) => {
    const found = scanText(`echo ${secret}`, "tool_input.command");
    expect(found).toEqual([{ kind, location: "tool_input.command" }]);
    expect(JSON.stringify(found)).not.toContain(secret);
  });

  it("does not flag ordinary code, placeholders, short values or references", () => {
    for (const text of [
      "const token = readToken(options);",
      `password = "${"x".repeat(24)}"`,
      "API_KEY=${API_KEY}",
      "api_key: your_api_key_here_please",
      "token=abc123",
      "secret = process.env.SECRET_VALUE_FOR_APP",
      "git commit -m 'fix the auth flow'",
    ])
      expect(scanText(text, "x"), text).toEqual([]);
  });

  it("a location that looks like a secret is not repeated", () => {
    const found = scanText(`${FAKE_GITHUB_TOKEN}`, `staged diff: ${FAKE_OPENAI_KEY}.txt line 1`);
    expect(JSON.stringify(found)).not.toContain(FAKE_OPENAI_KEY);
    expect(found[0]!.location).toContain("hidden");
  });

  it("scans file content and new_string but not the old_string being removed", () => {
    expect(scanToolInput({ file_path: "/a", content: `x=1\n${ASSIGNMENT}\n` }).findings).toEqual([
      { kind: "secret_assignment", location: "tool_input.content line 2" },
    ]);
    expect(
      scanToolInput({ old_string: FAKE_GITHUB_TOKEN, new_string: "REDACTED" }).findings,
    ).toEqual([]);
    expect(scanToolInput({ old_string: "a", new_string: FAKE_GITHUB_TOKEN }).findings).toEqual([
      { kind: "github_token", location: "tool_input.new_string" },
    ]);
  });

  it("scans only ADDED lines of a diff and says file and line", () => {
    const diff = [
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      ` kept ${FAKE_OPENAI_KEY}`,
      `-removed ${FAKE_GITHUB_TOKEN}`,
      `+added ${FAKE_AWS_KEY}`,
    ].join("\n");
    expect(scanDiff(diff).findings).toEqual([
      { kind: "aws_access_key", location: "staged diff: src/a.ts line 2" },
    ]);
  });
});

describe("a diff row `+++ x` inside a hunk is an added line, not a header (F1)", () => {
  it("scans an added line whose content starts with `++ `", () => {
    const diff = [
      "diff --git a/s.sh b/s.sh",
      "--- a/s.sh",
      "+++ b/s.sh",
      "@@ -1,0 +2,2 @@",
      "+echo hi",
      `+++ ${FAKE_GITHUB_TOKEN}`,
    ].join("\n");
    expect(scanDiff(diff).findings).toEqual([
      { kind: "github_token", location: "staged diff: s.sh line 3" },
    ]);
  });

  it("still reads the next file's header after a hunk, and a header-looking row before any hunk", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "+++ b/a.ts",
      "@@ -0,0 +1,1 @@",
      "+fine",
      "diff --git a/b.ts b/b.ts",
      "+++ b/b.ts",
      "@@ -0,0 +1,1 @@",
      `+${FAKE_AWS_KEY}`,
    ].join("\n");
    expect(scanDiff(diff).findings).toEqual([
      { kind: "aws_access_key", location: "staged diff: b.ts line 1" },
    ]);
  });

  it("a commit of an untracked file whose line is `++ <secret>` is blocked", async () => {
    const dir = repo();
    writeFileSync(join(dir, "inc.txt"), `one\n++ ${FAKE_GITHUB_TOKEN}\n`);
    const r = rig();
    const out = await runGuard(
      [],
      payload({ command: "git add -A && git commit -m x" }, { cwd: dir }),
      r.deps,
    );
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).toContain("github_token at staged diff: inc.txt line 2");
    expect(out.line).not.toContain(FAKE_GITHUB_TOKEN);
  });

  it("a STAGED `++ <secret>` line is blocked too", async () => {
    const dir = repo();
    writeFileSync(join(dir, "inc.txt"), `++ ${FAKE_GITHUB_TOKEN}\n`);
    gitIn(dir, "add", "inc.txt");
    const out = await runGuard(
      [],
      payload({ command: "git commit -m x" }, { cwd: dir }),
      rig().deps,
    );
    expect(out.outcome).toBe("blocked");
  });
});

describe("git commit / push detection", () => {
  it.each([
    ["git commit -m x", "commit", false],
    ["git -C ../p commit -m x", "commit", false],
    ["git add -A && git commit -m x", "commit", true],
    ["git commit -am x", "commit", true],
    ["git commit --all -m x", "commit", true],
    ["cd p; git push origin main", "push", false],
    ["FOO=1 git -c user.name=a commit -m x", "commit", false],
    ['bash -c "git commit -m x"', "commit", false],
    ["sh -c 'git push origin main'", "push", false],
    ['eval "git push"', "push", false],
    ["/usr/bin/git commit -m x", "commit", false],
    ['bash -c "git add -A && git commit -m x"', "commit", true],
  ])("%s", (command, verb, worktree) => {
    expect(gitIntent(command)).toMatchObject({ verb, worktree });
  });

  it.each([
    "git status",
    "git log --oneline",
    "echo digit commit",
    "npm run commit",
    "legit push origin",
    "digit commit -m x",
    "bash -c 'legit push'",
  ])("%s is not one", (command) => expect(gitIntent(command)).toBeNull());
});

describe("a long command is still read (F4)", () => {
  it("gitIntent is not skipped for a command longer than 20,000 characters", () => {
    const padded = `git commit -m x # ${"p".repeat(30_000)}`;
    expect(gitIntent(padded)).toMatchObject({ verb: "commit" });
    expect(gitIntent(`${"p ".repeat(30_000)}; git push`)).toMatchObject({ verb: "push" });
  });

  it("a padded `git commit` still gathers the staged diff and blocks a staged secret", async () => {
    const dir = repo();
    writeFileSync(join(dir, "k.txt"), `${FAKE_GITHUB_TOKEN}\n`);
    gitIn(dir, "add", "k.txt");
    const out = await runGuard(
      [],
      payload({ command: `git commit -m x # ${"p".repeat(30_000)}` }, { cwd: dir }),
      rig().deps,
    );
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).toContain("staged diff: k.txt line 1");
  });
});

describe("the guard decision", () => {
  it("lets clean input through silently: no card, no report", async () => {
    const r = rig();
    const out = await runGuard([], payload({ command: "npm test -- --run" }), r.deps);
    expect(out).toMatchObject({ line: null, outcome: null });
    expect(r.asked).toEqual([]);
    expect(r.reported).toEqual([]);
  });

  it.each([
    ["a command", { command: `curl -H 'Authorization: ${FAKE_BEARER}' https://x` }, "bearer_token"],
    ["a token in a command", { command: `echo ${FAKE_GITHUB_TOKEN} > f` }, "github_token"],
    [
      "file content",
      { file_path: "/a/.env", content: `A=1\n${ASSIGNMENT}\n` },
      "secret_assignment",
    ],
    ["a key in new_string", { file_path: "/a", old_string: "x", new_string: PEM }, "private_key"],
  ])(
    "blocks a secret in %s and the message names kind and place, not the secret",
    async (_n, input, kind) => {
      const r = rig();
      const out = await runGuard([], payload(input), r.deps);
      expect(out.outcome).toBe("blocked");
      const line = out.line!;
      expect(line.split("\n")).toHaveLength(1);
      const parsed = JSON.parse(line).hookSpecificOutput;
      expect(parsed).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
      expect(parsed.permissionDecisionReason).toContain(kind);
      expect(parsed.permissionDecisionReason).toContain("tool_input.");
      for (const secret of [FAKE_BEARER, FAKE_GITHUB_TOKEN, ASSIGNED, PEM]) {
        expect(line).not.toContain(secret);
        expect(JSON.stringify(r.asked)).not.toContain(secret);
        expect(JSON.stringify(r.reported)).not.toContain(secret);
      }
      expect(r.reported).toHaveLength(1);
      expect(r.reported[0]).toMatchObject({ outcome: "blocked", tool: "Bash" });
      expect(r.reported[0]!.findings[0]!.kind).toBe(kind);
    },
  );

  it("a block on a command that merely quotes the word git commit still names the real place", async () => {
    const r = rig();
    const out = await runGuard(
      [],
      payload({ command: `echo "git commit" ${FAKE_GITHUB_TOKEN}` }),
      r.deps,
    );
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).not.toContain(FAKE_GITHUB_TOKEN);
  });
});

describe("git commit and push: the staged diff", () => {
  it("blocks a commit whose STAGED changes hold a secret and names file and line", async () => {
    const dir = repo();
    writeFileSync(join(dir, "deploy.sh"), `#!/bin/sh\necho start\nexport ${ASSIGNMENT}\n`);
    gitIn(dir, "add", "deploy.sh");
    const r = rig();
    const out = await runGuard(
      [],
      payload({ command: "git commit -m 'add deploy'" }, { cwd: dir }),
      r.deps,
    );
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).toContain("secret_assignment at staged diff: deploy.sh line 3");
    expect(out.line).not.toContain(ASSIGNED);
    expect(r.reported[0]).toMatchObject({ scope: "staged changes", outcome: "blocked" });
    expect(JSON.stringify(r.asked)).not.toContain(ASSIGNED);
  });

  it("an UNSTAGED secret does not block a plain commit; a staged clean change passes and is reported as scanned", async () => {
    const dir = repo();
    writeFileSync(join(dir, "notes.txt"), `${FAKE_GITHUB_TOKEN}\n`); // untracked, not staged
    writeFileSync(join(dir, "README.md"), "hello\nmore\n");
    gitIn(dir, "add", "README.md");
    const r = rig();
    const out = await runGuard(
      [],
      payload({ command: "git commit -m docs" }, { cwd: dir }),
      r.deps,
    );
    expect(out).toMatchObject({ line: null, outcome: null });
    expect(r.reported).toHaveLength(1);
    expect(r.reported[0]).toMatchObject({
      outcome: "allowed",
      scope: "staged changes",
      findings: [],
    });
  });

  it("`git add -A && git commit` has nothing staged yet: untracked files are scanned", async () => {
    const dir = repo();
    writeFileSync(join(dir, "config.js"), `module.exports = { k: "${FAKE_OPENAI_KEY}" };\n`);
    const r = rig();
    const out = await runGuard(
      [],
      payload({ command: "git add -A && git commit -m cfg" }, { cwd: dir }),
      r.deps,
    );
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).toContain("api_key at staged diff: config.js line 1");
    expect(out.line).not.toContain(FAKE_OPENAI_KEY);
  });

  it("blocks a push of an unpushed commit that holds a secret", async () => {
    const dir = repo();
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-guard-bare-")));
    dirs.push(bare);
    gitIn(bare, "init", "-q", "--bare");
    gitIn(dir, "remote", "add", "origin", bare);
    gitIn(dir, "push", "-q", "-u", "origin", "HEAD");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "k.ts"), `export const k = "${FAKE_GITHUB_TOKEN}";\n`);
    gitIn(dir, "add", "src/k.ts");
    execFileSync(
      "git",
      ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "k"],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      },
    );
    const r = rig();
    const out = await runGuard([], payload({ command: "git push" }, { cwd: dir }), r.deps);
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).toContain("github_token at staged diff: src/k.ts line 1");
    expect(out.line).not.toContain(FAKE_GITHUB_TOKEN);
  });
});

describe("git push without an upstream (F3)", () => {
  it("scans every commit no remote has when the branch has no upstream (first push)", async () => {
    const dir = repo();
    writeFileSync(join(dir, "k.ts"), `export const k = "${FAKE_GITHUB_TOKEN}";\n`);
    gitIn(dir, "add", "k.ts");
    execFileSync(
      "git",
      ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "k"],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      },
    );
    const r = rig();
    const out = await runGuard(
      [],
      payload({ command: "git push -u origin HEAD" }, { cwd: dir }),
      r.deps,
    );
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).toContain("github_token at staged diff: k.ts line 1");
    expect(out.line).not.toContain(FAKE_GITHUB_TOKEN);
  });

  it("commits a remote already has are not rescanned by the fallback", async () => {
    const dir = repo();
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-guard-bare-")));
    dirs.push(bare);
    gitIn(bare, "init", "-q", "--bare");
    gitIn(dir, "remote", "add", "origin", bare);
    gitIn(dir, "push", "-q", "origin", "HEAD"); // no -u: still no upstream configured
    const got = await gatherChanges({ verb: "push", dir: undefined, worktree: false }, dir);
    expect(got.diff.trim()).toBe("");
    expect(got.note).toBeUndefined();
  });

  it("says so on stderr when the range cannot be resolved", async () => {
    const exec = async () => ({ code: 128, stdout: "", stderr: "fatal" });
    const got = await gatherChanges({ verb: "push", dir: undefined, worktree: false }, "/x", exec);
    expect(got.note).toContain("could not resolve");
    const out = await runGuard([], payload({ command: "git push" }, { cwd: "/work/app" }), {
      ...rig().deps,
      exec,
    });
    expect(out.line).toBeNull();
    expect(out.note).toContain("could not resolve");
  });
});

describe("input the agent can inflate is refused, not passed (F4)", () => {
  it("a tool input longer than the scan limit is denied with a reason and no card", async () => {
    const r = rig();
    const out = await runGuard(
      [],
      payload({ command: "echo hi", content: "a".repeat(1_100_000) }),
      r.deps,
    );
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).toContain("longer than the scan limit");
    expect(r.asked).toEqual([]);
  });

  it("an input under the limit is untouched", async () => {
    const out = await runGuard(
      [],
      payload({ command: "echo hi", content: "a".repeat(5_000) }),
      rig().deps,
    );
    expect(out.line).toBeNull();
  });

  it("stdin over the cap is reported as oversize, and the hook denies", async () => {
    const chunks = async function* () {
      yield Buffer.alloc(6);
      yield Buffer.alloc(6);
    };
    expect(await readStdin(chunks(), 10)).toEqual({ text: "", oversize: true });
    expect(await readStdin(chunks(), 100)).toMatchObject({ oversize: false });
    const out = oversizeResult([]);
    expect(out.outcome).toBe("blocked");
    expect(denyReason(out.line)).toContain("longer than the guard can read");
    expect(oversizeResult(["--agent", "Not Valid"]).line).toBeNull();
  });
});

describe("override only by an approval bound to the content", () => {
  const input = { command: `echo ${FAKE_GITHUB_TOKEN}` };

  it("the card carries the content hash and no secret; a user Allow lets the call through and is reported", async () => {
    const r = rig(allowed);
    const out = await runGuard([], payload(input), r.deps);
    expect(out).toMatchObject({ line: null, outcome: "overridden" });
    expect(r.asked).toHaveLength(1);
    const card = r.asked[0]!;
    expect(card).toMatchObject({ kind: "permission", tool: "SecretGuard", project: "/work/app" });
    expect(card.input_summary.detail).toContain(r.reported[0]!.content_hash);
    expect(card.input_summary.description).toContain("github_token");
    expect(JSON.stringify(card)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(r.reported[0]).toMatchObject({ outcome: "overridden" });
  });

  it("different content gets a different hash, so one approval cannot cover another call", async () => {
    const a = rig(allowed);
    const b = rig(allowed);
    await runGuard([], payload(input), a.deps);
    await runGuard([], payload({ command: `echo ${FAKE_OPENAI_KEY}` }), b.deps);
    expect(a.reported[0]!.content_hash).not.toBe(b.reported[0]!.content_hash);
    expect(a.asked[0]!.input_summary.detail).not.toBe(b.asked[0]!.input_summary.detail);
  });

  it.each([
    ["a deny", { decision: { behavior: "deny" as const, message: "no" }, decidedBy: "user" }],
    [
      "an allow made by a rule or policy, not the owner",
      { decision: { behavior: "allow" as const }, decidedBy: "rule" },
    ],
    [
      "no answer (Core down, timeout)",
      { decision: null, reason: "timed out waiting for a decision" },
    ],
  ] as const)("%s keeps the block", async (_n, answer) => {
    const r = rig(answer as ApprovalOutcome);
    const out = await runGuard([], payload(input), r.deps);
    expect(out.outcome).toBe("blocked");
    expect(out.line).toContain("deny");
    expect(r.reported[0]!.outcome).toBe("blocked");
  });

  it("without a session id there is nobody to ask: blocked, and it says so", async () => {
    const r = rig(allowed);
    const out = await runGuard([], payload(input, { session_id: "" }), r.deps);
    expect(out.outcome).toBe("blocked");
    expect(r.asked).toEqual([]);
    expect(denyReason(out.line)).toContain("could not ask the owner");
  });
});

describe("when the hook itself breaks (documented trade-off)", () => {
  it("garbage input, another event and bad flags: no output, exit-0 behaviour", async () => {
    const r = rig();
    for (const [argv, text] of [
      [[], "not json"],
      [[], ""],
      [
        [],
        JSON.stringify({
          hook_event_name: "PostToolUse",
          tool_input: { command: FAKE_GITHUB_TOKEN },
        }),
      ],
      [["--agent", "Not Valid"], payload({ command: FAKE_GITHUB_TOKEN })],
      [["--timeout-ms", "1"], payload({ command: FAKE_GITHUB_TOKEN })],
      [["--bogus"], payload({ command: FAKE_GITHUB_TOKEN })],
    ] as const) {
      const out = await runGuard(argv, text, r.deps);
      expect(out.line, JSON.stringify(argv)).toBeNull();
    }
    expect(r.asked).toEqual([]);
  });

  it("git cannot be read: fails OPEN for the diff, still scans the input, says why", async () => {
    const r = rig();
    const exec = async () => {
      throw new Error("git is not installed");
    };
    const clean = await runGuard([], payload({ command: "git commit -m x" }), { ...r.deps, exec });
    expect(clean.line).toBeNull();
    expect(clean.note).toContain("could not read the changes");
    const dirty = await runGuard([], payload({ command: `git commit -m ${FAKE_GITHUB_TOKEN}` }), {
      ...r.deps,
      exec,
    });
    expect(dirty.outcome).toBe("blocked");
  });

  it("a crash while asking for an override cannot turn a found secret into a pass", async () => {
    const r = rig(async () => {
      throw new Error("approval client exploded");
    });
    const out = await runGuard([], payload({ command: `echo ${FAKE_GITHUB_TOKEN}` }), r.deps);
    expect(out.outcome).toBe("blocked");
    expect(out.line).toContain("deny");
  });

  it("a crash while reporting cannot change a clean pass or a block", async () => {
    const boom = async () => {
      throw new Error("report exploded");
    };
    const blocked = await runGuard([], payload({ command: `echo ${FAKE_GITHUB_TOKEN}` }), {
      approve: async () => ({ decision: null, reason: "down" }),
      report: boom,
    });
    expect(blocked.outcome).toBe("blocked");
    const dir = repo();
    const clean = await runGuard([], payload({ command: "git commit -m x" }, { cwd: dir }), {
      report: boom,
    });
    expect(clean.line).toBeNull();
    expect(clean.note).toContain("secret guard error");
  });
});

// ---- the real process -------------------------------------------------------------------------

const TSX = join(import.meta.dirname, "../../../node_modules/.bin/tsx");
const HOOK = join(import.meta.dirname, "../src/guard-hook.ts");

function runProcess(stdin: string) {
  const child = spawn(TSX, [HOOK, "--timeout-ms", "5000"], {
    env: {
      PATH: process.env.PATH ?? "",
      PHOENIX_SESSION_TOKEN: "guard-test-session",
      PHOENIX_CORE_URL: "http://127.0.0.1:9",
      PHOENIX_RELAY_SOCKET: join(tmpdir(), "phoenix-no-such-relay.sock"),
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c));
  child.stderr.on("data", (c: Buffer) => (stderr += c));
  child.stdin.on("error", () => {});
  child.stdin.end(stdin);
  const closed = Promise.withResolvers<{ status: number | null; stdout: string; stderr: string }>();
  child.on("close", (status) => closed.resolve({ status, stdout, stderr }));
  return closed.promise;
}

describe("guard-hook.ts as a process", () => {
  it("a planted secret: exit 0 and exactly one deny line that does not hold it (Core down)", async () => {
    const r = await runProcess(payload({ command: `echo ${FAKE_GITHUB_TOKEN}` }));
    expect(r.status).toBe(0);
    expect(r.stdout.endsWith("\n")).toBe(true);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(r.stdout + r.stderr).not.toContain(FAKE_GITHUB_TOKEN);
  }, 30_000);

  it("clean input: exit 0, empty stdout", async () => {
    const r = await runProcess(payload({ command: "ls" }));
    expect(r).toMatchObject({ status: 0, stdout: "" });
  }, 30_000);
});
