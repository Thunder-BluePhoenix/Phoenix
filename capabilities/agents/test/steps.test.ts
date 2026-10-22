// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  FAKE_AWS_KEY,
  FAKE_GITHUB_TOKEN,
  FAKE_OPENAI_KEY,
} from "../../../protocol/testing/fake-secrets";
import {
  MAX_STEPS,
  MAX_TARGET,
  MAX_WORD_RUN,
  StepLog,
  lineDelta,
  mapClaudeStep,
  redactSecrets,
  validateStep,
} from "../src/steps";
import { CWD, HOOKS, SESSION } from "./fixtures";

const NOW = Date.parse("2026-10-16T10:00:00Z");
const common = { session_id: SESSION, cwd: CWD, permission_mode: "default" };
const post = (tool_name: string, tool_input: unknown, extra: Record<string, unknown> = {}) => ({
  ...common,
  hook_event_name: "PostToolUse",
  tool_name,
  tool_input,
  ...extra,
});
const map = (payload: unknown) => mapClaudeStep(payload, { now: () => NOW });

describe("mapClaudeStep", () => {
  it("maps the documented tools to read / edit / run / other", () => {
    expect(map(post("Read", { file_path: `${CWD}/src/a.ts` }))).toMatchObject({
      kind: "read",
      tool: "Read",
      target: `${CWD}/src/a.ts`,
      agent: "claude-code",
      session_id: SESSION,
      project: CWD,
      at: "2026-10-16T10:00:00.000Z",
    });
    expect(map(post("Glob", { pattern: "**/*.ts", path: CWD }))).toMatchObject({
      kind: "read",
      target: `**/*.ts in ${CWD}`,
    });
    expect(map(post("Grep", { pattern: "TODO.*fix" }))).toMatchObject({
      kind: "read",
      target: "TODO.*fix",
    });
    expect(map(post("Bash", { command: "npm test", description: "Run" }))).toMatchObject({
      kind: "run",
      target: "npm test",
    });
    expect(map(post("PowerShell", { command: "Get-ChildItem" }))).toMatchObject({ kind: "run" });
    expect(
      map(post("Edit", { file_path: `${CWD}/a.ts`, old_string: "a", new_string: "b" })),
    ).toMatchObject({
      kind: "edit",
      target: `${CWD}/a.ts`,
      file: { path: `${CWD}/a.ts`, added: 1, removed: 1 },
    });
    expect(map(post("Write", { file_path: `${CWD}/new.ts`, content: "x\ny\nz\n" }))).toMatchObject({
      kind: "edit",
      file: { path: `${CWD}/new.ts`, added: 3, removed: 0 },
    });
    expect(map(post("WebFetch", { url: "https://example.com/x", prompt: "p" }))).toMatchObject({
      kind: "other",
      target: "https://example.com/x",
    });
    expect(map(post("SomeMcpTool", { anything: 1 }))).toMatchObject({ kind: "other", target: "" });
  });

  it("maps PreToolUse too, and ignores other hooks", () => {
    expect(
      map({ ...post("Read", { file_path: `${CWD}/a` }), hook_event_name: "PreToolUse" }),
    ).toMatchObject({
      kind: "read",
    });
    expect(map(HOOKS.Stop)).toBeNull();
    expect(map(HOOKS.UserPromptSubmit)).toBeNull();
  });

  it("the fixture PostToolUse maps to a run step and never carries the tool output", () => {
    const step = map(HOOKS.PostToolUse);
    expect(step).toMatchObject({ kind: "run", tool: "Bash", target: "cat ~/.ssh/id_rsa" });
    expect(JSON.stringify(step)).not.toContain("TOP SECRET TOOL OUTPUT");
  });

  it("never stores tool output or file contents", () => {
    const step = map(
      post(
        "Write",
        { file_path: `${CWD}/a.ts`, content: "SECRET_FILE_BODY\nline2" },
        { tool_response: { stdout: "SECRET_OUTPUT" } },
      ),
    );
    const json = JSON.stringify(step);
    expect(json).not.toContain("SECRET_FILE_BODY");
    expect(json).not.toContain("SECRET_OUTPUT");
    const edit = map(
      post("Edit", { file_path: `${CWD}/a.ts`, old_string: "OLD_BODY", new_string: "NEW_BODY" }),
    );
    expect(JSON.stringify(edit)).not.toMatch(/OLD_BODY|NEW_BODY/);
  });

  it("redacts secrets in commands and paths", () => {
    const token = FAKE_GITHUB_TOKEN;
    const cmd = map(
      post("Bash", {
        command: `curl -H "Authorization: ${FAKE_OPENAI_KEY}" --password hunter2 https://u:pw123@host/x API_TOKEN=abc ${token} ${FAKE_AWS_KEY}`,
      }),
    )!;
    for (const secret of [FAKE_OPENAI_KEY, "hunter2", "pw123", "abc ", token, FAKE_AWS_KEY]) {
      expect(cmd.target).not.toContain(secret);
    }
    expect(cmd.target).toContain("[REDACTED]");
  });

  it("redacts what redactText alone misses in a command line", () => {
    // Joined at runtime: a literal `curl -u name:password` is what the CI secret scanner flags.
    const pw = "s3cr3t" + "pw";
    const basic = ["alice", pw].join(":");
    const quoted = ["bob", "two words"].join(":");
    const basicHeader = Buffer.from(["user", "pass"].join(":")).toString("base64");
    const cases: [string, string[]][] = [
      [`curl -u ${basic} https://x.example`, [pw]],
      [`curl -u${basic} https://x.example`, [pw]],
      [`curl --user '${quoted}' https://x.example`, ["two words", "bob:"]],
      [`curl -H "Authorization: Basic ${basicHeader}" x`, [basicHeader]],
      ["curl -H 'Proxy-Authorization: Digest abc123xyz' x", ["abc123xyz"]],
      ["curl -H 'X-Api-Key: k9k9k9k9' x", ["k9k9k9k9"]],
      ["curl -H 'Cookie: sid=zz11; theme=dark' x", ["zz11"]],
      ["curl -H 'Set-Cookie: sid=zz22' x", ["zz22"]],
      ["export db_password=hunter22 && run", ["hunter22"]],
      ["DB_PASS=hunter23 MYSQL_PWD=hunter24 run", ["hunter23", "hunter24"]],
      ['api_key="has some spaces" run', ["has some spaces", "spaces"]],
      ["TOKEN='a b c d' run", ["a b c d"]],
      ["curl 'https://h.example/p?user=1&access_token=AAAA1111&x=2'", ["AAAA1111"]],
      ["curl https://h.example/p?sig=SIG55&Signature=SIG66", ["SIG55", "SIG66"]],
      ["mysql -uroot -pSECRETPW db", ["SECRETPW"]],
      ["mysql -u root -p'my pass word' db", ["my pass word"]],
      ["git clone https://u:p%2Fw@host.example/x", ["p%2Fw"]],
      ["git clone https://u:p/w@host.example/x", ["p/w"]],
      ["git clone https://u:p@w@host.example/x", ["p@w"]],
    ];
    for (const [command, secrets] of cases) {
      const target = map(post("Bash", { command }))!.target;
      for (const secret of secrets) expect(target, command).not.toContain(secret);
      expect(target, command).toContain("[REDACTED]");
    }
  });

  it("an attacker-sized run of word characters is cut and redacted in linear time (F6)", () => {
    const run = (text: string) => redactSecrets(text);
    // Shapes that made the old patterns backtrack: one huge name, a flag repeated, a key word repeated.
    for (const [text, marker] of [
      ["a".repeat(200_000), "a"],
      ["--api-key".repeat(22_000), "--"],
      ["token".repeat(40_000), "tok"],
      ["-".repeat(200_000), "-"],
    ] as const) {
      const out = run(text);
      expect(out.length, marker).toBeLessThan(text.length / 10);
      expect(out.startsWith("…") || out.includes("[REDACTED]"), marker).toBe(true);
    }
  });

  it("a secret assignment is still masked after a long name or value, and a long name is not an assignment", () => {
    const value = ["s3", "cr3t", "val"].join("");
    expect(redactSecrets(`API_TOKEN=${value} run`)).not.toContain(value);
    expect(redactSecrets(`${"x".repeat(100)}_password=${value}`)).not.toContain(value);
    const huge = `${"a".repeat(MAX_WORD_RUN + 50)}_token=${value}`;
    expect(redactSecrets(huge)).not.toContain(value);
    expect(redactSecrets("name=plain other=plain2")).toBe("name=plain other=plain2");
  });

  it("keeps ordinary commands readable", () => {
    for (const command of [
      "ls -la /tmp",
      "git commit -m 'fix key handling'",
      "npm run passthrough",
      "curl http://host.example:8080/@x",
      "cat keyboard.txt",
    ]) {
      expect(map(post("Bash", { command }))!.target).toBe(command);
    }
  });

  it("treats an inherited property name as an unknown tool, not a Bash-like one", () => {
    for (const tool_name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      const step = map(post(tool_name, { command: "echo hi" }))!;
      expect(step.kind).toBe("other");
      expect(step.target).toBe("");
    }
  });

  it("truncates a huge command to 200 characters, however large the input", () => {
    const step = map(post("Bash", { command: "x".repeat(5_000_000) }))!;
    expect(step.target).toHaveLength(MAX_TARGET);
    expect(step.target.endsWith("…")).toBe(true);
    const long = map(post("Read", { file_path: `/${"d/".repeat(300)}f` }))!;
    expect(long.target.length).toBeLessThanOrEqual(MAX_TARGET);
  });

  it("a secret straddling the cut cannot leak its prefix", () => {
    const command = `${"a".repeat(180)} ${FAKE_GITHUB_TOKEN}`;
    const step = map(post("Bash", { command }))!;
    expect(step.target.length).toBeLessThanOrEqual(MAX_TARGET);
    expect(step.target).not.toContain(FAKE_GITHUB_TOKEN.slice(0, 4));
  });

  it("flattens control characters and escape sequences", () => {
    const step = map(post("Bash", { command: "ls\n\u001b[31mred\u001b[0m\u0000\r\tx" }))!;
    expect(step.target).not.toMatch(/\p{Cc}/u);
  });

  it("returns null for unusable payloads and never throws", () => {
    for (const bad of [
      null,
      "x",
      [],
      {},
      post("", {}),
      post("Bash", {}, { session_id: "bad id with spaces" }),
      post("Bash", {}, { cwd: "relative/dir" }),
      post("Bash", {}, { cwd: `${CWD}\n` }),
      post("AskUserQuestion", { questions: [] }),
      { ...common, hook_event_name: "PostToolUse", tool_name: 5 },
    ]) {
      expect(map(bad)).toBeNull();
    }
    expect(map(post("Bash", "not an object"))).toMatchObject({ kind: "run", target: "" });
    expect(
      map(post("Edit", { file_path: "relative.ts", old_string: "a", new_string: "b" })),
    ).toMatchObject({
      kind: "edit",
    });
    expect(map(post("Edit", { file_path: "relative.ts" }))!.file).toBeUndefined();
  });

  it("a Windows path is kept as the file key", () => {
    const step = map(
      post("Edit", { file_path: "C:\\proj\\a.ts", old_string: "a", new_string: "b" }),
    )!;
    expect(step.file?.path).toBe("C:\\proj\\a.ts");
  });
});

describe("lineDelta", () => {
  it("counts only the changed lines", () => {
    expect(lineDelta("a\nb\nc", "a\nB\nc")).toEqual({ added: 1, removed: 1 });
    expect(lineDelta("", "a\nb\n")).toEqual({ added: 2, removed: 0 });
    expect(lineDelta("a\nb\n", "")).toEqual({ added: 0, removed: 2 });
    expect(lineDelta("a\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
    expect(lineDelta("a\nb\nc\nd", "a\nX\nY\nZ\nd")).toEqual({ added: 3, removed: 2 });
  });
});

describe("validateStep", () => {
  const valid = {
    agent: "claude-code",
    session_id: SESSION,
    project: CWD,
    kind: "edit",
    tool: "Edit",
    target: `${CWD}/a.ts`,
    at: "2026-10-16T10:00:00Z",
    file: { path: `${CWD}/a.ts`, added: 2, removed: 1 },
  };

  it("accepts a well-formed step and cleans it again", () => {
    const r = validateStep({ ...valid, target: `x ${FAKE_GITHUB_TOKEN}\n${"y".repeat(300)}` }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.step.target).not.toContain(FAKE_GITHUB_TOKEN);
      expect(r.step.target).not.toContain("\n");
      expect(r.step.target.length).toBeLessThanOrEqual(MAX_TARGET);
    }
  });

  it("rejects unknown fields, bad enums, relative project, bad counts", () => {
    for (const patch of [
      { extra: 1 },
      { agent: "Bad Agent" },
      { kind: "delete" },
      { project: "rel" },
      { session_id: "" },
      { file: { path: "rel", added: 1, removed: 1 } },
      { file: { path: `${CWD}/a`, added: -1, removed: 0 } },
      { file: { path: `${CWD}/a`, added: 1.5, removed: 0 } },
      { tty: "../../etc/passwd" },
      { pid: -3 },
    ]) {
      expect(validateStep({ ...valid, ...patch }, NOW).ok).toBe(false);
    }
    expect(validateStep(null, NOW).ok).toBe(false);
  });

  it("replaces a wildly wrong sender clock with Core's", () => {
    const r = validateStep({ ...valid, at: "1999-01-01T00:00:00Z" }, NOW);
    expect(r.ok && r.step.at).toBe(new Date(NOW).toISOString());
  });

  it("drops a file key that redaction would change", () => {
    const r = validateStep(
      { ...valid, file: { path: `/work/${FAKE_GITHUB_TOKEN}`, added: 1, removed: 0 } },
      NOW,
    );
    expect(r.ok && r.step.file).toBeUndefined();
  });
});

describe("StepLog ring buffer", () => {
  const step = (i: number) => ({ at: "t", kind: "run" as const, tool: "Bash", target: `cmd ${i}` });

  it("is bounded at 500 by default, drops the oldest and counts them", () => {
    const log = new StepLog();
    for (let i = 1; i <= MAX_STEPS + 25; i++) log.push(step(i));
    expect(log.list()).toHaveLength(MAX_STEPS);
    expect(log.list()[0]!.target).toBe("cmd 26");
    expect(log.list().at(-1)!.n).toBe(MAX_STEPS + 25);
    expect(log.dropped).toBe(25);
    expect(log.total).toBe(MAX_STEPS + 25);
  });

  it("numbers steps continuously and keeps order", () => {
    const log = new StepLog(3);
    for (let i = 1; i <= 5; i++) log.push(step(i));
    expect(log.list().map((s) => s.n)).toEqual([3, 4, 5]);
  });
});
