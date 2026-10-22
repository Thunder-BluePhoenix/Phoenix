// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Installing the secret guard (Phase 79) through the same preview/hash/apply installer as every
// other hook, in a temp home. A user's own PreToolUse hooks must survive install, repair and
// uninstall; only entries that run Phoenix's guard-hook.ts are Phoenix's.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/guards";
import { HOOK_SCRIPT_PATTERN } from "../src/relay/commands";
import { rig } from "./relay-rig";

const USER_MATCHER = "Bash";
const USER_HOOK = { type: "command", command: "my-own-linter --strict" };
const seed = (): string =>
  JSON.stringify(
    {
      theme: "dark",
      hooks: {
        PreToolUse: [{ matcher: USER_MATCHER, hooks: [USER_HOOK] }],
        Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }],
      },
    },
    null,
    2,
  ) + "\n";

const read = (path: string): Record<string, any> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

const guardEntries = (doc: Record<string, any>): unknown[] =>
  (doc.hooks.PreToolUse as unknown[]).filter((e) => JSON.stringify(e).includes("guard-hook.ts"));

describe.each(["claude-code", "codex"])("secret guard install: %s", (id) => {
  it("the preview shows the guard hook and install writes it next to the user's PreToolUse hook", () => {
    const r = rig(id, seed());
    const preview = r.installer.preview("install", id);
    expect(preview.diff).toContain("guard-hook.ts");
    expect(preview.changed).toBe(true);
    r.installer.apply("install", id, preview.hash);
    const doc = read(r.path);
    const list = doc.hooks.PreToolUse as unknown[];
    // the user's entry is first and untouched
    expect(list[0]).toEqual({ matcher: USER_MATCHER, hooks: [USER_HOOK] });
    const guard = guardEntries(doc);
    expect(guard).toHaveLength(1);
    const handler = (guard[0] as { hooks: Record<string, unknown>[] }).hooks[0]!;
    expect(String(handler.command)).toContain(`--agent ${id}`);
    // no matcher: the guard reads EVERY tool's input
    expect(guard[0]).not.toHaveProperty("matcher");
    expect(Number(handler.timeout)).toBeGreaterThan(120);
    expect(r.installer.list().find((a) => a.id === id)!.state).toBe("installed");
  });

  it("installing twice writes nothing the second time", () => {
    const r = rig(id, seed());
    r.installer.apply("install", id, r.installer.preview("install", id).hash);
    const once = readFileSync(r.path, "utf8");
    const again = r.installer.preview("install", id);
    expect(again.changed).toBe(false);
    r.installer.apply("install", id, again.hash);
    expect(readFileSync(r.path, "utf8")).toBe(once);
    expect(guardEntries(read(r.path))).toHaveLength(1);
  });

  it("uninstall after a later user edit removes only Phoenix's entries, guard included", () => {
    const r = rig(id, seed());
    r.installer.apply("install", id, r.installer.preview("install", id).hash);
    const doc = read(r.path);
    doc.theme = "solarized";
    writeFileSync(r.path, JSON.stringify(doc, null, 2) + "\n");
    const out = r.installer.preview("uninstall", id);
    r.installer.apply("uninstall", id, out.hash);
    const text = readFileSync(r.path, "utf8");
    expect(text).not.toMatch(HOOK_SCRIPT_PATTERN);
    expect(text).not.toContain("guard-hook");
    const after = read(r.path);
    expect(after.theme).toBe("solarized");
    expect(after.hooks.PreToolUse).toEqual([{ matcher: USER_MATCHER, hooks: [USER_HOOK] }]);
    expect(JSON.stringify(after.hooks.Stop)).toContain("echo mine");
  });

  it("health notices a missing guard and repair puts it back without touching the user's hook", () => {
    const r = rig(id, seed());
    r.installer.apply("install", id, r.installer.preview("install", id).hash);
    const doc = read(r.path);
    doc.hooks.PreToolUse = (doc.hooks.PreToolUse as unknown[]).filter(
      (e) => !JSON.stringify(e).includes("guard-hook.ts"),
    );
    // Codex and Claude keep other Phoenix events, so the agent is still "installed" in part.
    writeFileSync(r.path, JSON.stringify(doc, null, 2) + "\n");
    const sick = r.installer.list().find((a) => a.id === id)!;
    expect(sick.state).toBe("needs_repair");
    expect(sick.missing).toContain("PreToolUse");
    r.installer.apply("repair", id, r.installer.preview("repair", id).hash);
    const fixed = read(r.path);
    expect(guardEntries(fixed)).toHaveLength(1);
    expect((fixed.hooks.PreToolUse as unknown[])[0]).toEqual({
      matcher: USER_MATCHER,
      hooks: [USER_HOOK],
    });
    expect(r.installer.list().find((a) => a.id === id)!.state).toBe("installed");
  });

  it("a user hook that merely mentions the guard script's name is not Phoenix's", () => {
    const lookalike = { type: "command", command: "echo see guard-hook.ts docs" };
    const r = rig(
      id,
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [lookalike] }] } }, null, 2) + "\n",
    );
    r.installer.apply("install", id, r.installer.preview("install", id).hash);
    r.installer.apply("uninstall", id, r.installer.preview("uninstall", id).hash);
    const pre = read(r.path).hooks?.PreToolUse as unknown[] | undefined;
    expect(pre).toEqual([{ hooks: [lookalike] }]);
    expect(isRecord(read(r.path))).toBe(true);
  });
});
