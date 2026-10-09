// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Launcher configuration is the one place a user decides what Phoenix may run. Hostile and
// careless configs must be refused with a reason, and never partially accepted.
import { afterEach, describe, expect, it } from "vitest";
import { buildEnv, parseLaunchers, resolveLaunch } from "../src/launchers";
import { cleanTempDirs, fakeLauncher, workspaceIn } from "./rig";

afterEach(cleanTempDirs);

const ok = { command: ["/usr/bin/env", "node"], cwd_roots: ["/tmp/work"] };

describe("parseLaunchers", () => {
  it("accepts a well-formed launcher and drops nothing from it", () => {
    const parsed = parseLaunchers({
      claude: {
        ...ok,
        env_allow: ["ANTHROPIC_API_KEY"],
        waiting_prompts: ["Do you want to proceed?"],
        stdin: "close_after_prompt",
      },
    });
    expect(parsed.problems).toEqual([]);
    expect(parsed.launchers.claude).toEqual({
      ...ok,
      env_allow: ["ANTHROPIC_API_KEY"],
      waiting_prompts: ["Do you want to proceed?"],
      stdin: "close_after_prompt",
    });
  });

  it.each([
    ["a relative executable", { ...ok, command: ["claude"] }, /absolute/],
    ["a dot segment", { ...ok, command: ["/usr/bin/../bin/env"] }, /normalised/],
    ["a shell", { ...ok, command: ["/bin/sh", "-c", "x"] }, /shell/],
    ["bash", { ...ok, command: ["/opt/homebrew/bin/bash"] }, /shell/],
    ["an empty command", { ...ok, command: [] }, /command must have/],
    ["a non-string argument", { ...ok, command: ["/usr/bin/env", 5] }, /strings/],
    ["a control character in argv", { ...ok, command: ["/usr/bin/env", "a\nb"] }, /control/],
    ["too many arguments", { ...ok, command: ["/usr/bin/env", ...new Array(40).fill("x")] }, /entries/],
    ["no cwd roots", { ...ok, cwd_roots: [] }, /cwd_roots must have/],
    ["the filesystem root as a cwd root", { ...ok, cwd_roots: ["/"] }, /filesystem root/],
    ["a relative cwd root", { ...ok, cwd_roots: ["work"] }, /absolute/],
    ["a wildcard cwd root", { ...ok, cwd_roots: ["/tmp/*"] }, /"\*"/],
    ["a trailing slash root", { ...ok, cwd_roots: ["/tmp/work/"] }, /normalised/],
    ["an env name with lowercase", { ...ok, env_allow: ["path"] }, /not an allowed/],
    ["a PHOENIX_ variable", { ...ok, env_allow: ["PHOENIX_TOKEN"] }, /not an allowed/],
    ["an unknown field", { ...ok, shell: true }, /unknown field "shell"/],
    ["a bad stdin mode", { ...ok, stdin: "pipe" }, /stdin must be/],
    ["a non-object launcher", "claude", /must be an object/],
  ])("refuses %s", (_label, launcher, message) => {
    const parsed = parseLaunchers({ claude: launcher });
    expect(parsed.launchers.claude).toBeUndefined();
    expect(parsed.problems.join("\n")).toMatch(message);
  });

  it("refuses names that are not slugs, and prototype-pollution keys cannot add a launcher", () => {
    const json = '{"__proto__": {"command": ["/usr/bin/env"], "cwd_roots": ["/tmp/w"]}, "a b": {}}';
    const parsed = parseLaunchers(JSON.parse(json));
    expect(Object.keys(parsed.launchers)).toEqual([]);
    expect(parsed.problems.length).toBeGreaterThan(0);
    expect(Object.keys({})).toEqual([]);
  });

  it("keeps good launchers when another one is bad, and reports the bad one", () => {
    const parsed = parseLaunchers({ good: ok, bad: { ...ok, command: ["rel"] } });
    expect(Object.keys(parsed.launchers)).toEqual(["good"]);
    expect(parsed.problems).toHaveLength(1);
  });

  it("limits the number of launchers", () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`l${i}`, ok]));
    const parsed = parseLaunchers(many);
    expect(parsed.launchers).toEqual({});
    expect(parsed.problems[0]).toMatch(/at most 8/);
  });

  it("treats a missing or non-object value as no launchers", () => {
    expect(parseLaunchers(undefined)).toEqual({ launchers: {}, problems: [] });
    expect(parseLaunchers([]).problems[0]).toMatch(/must be an object/);
  });
});

describe("resolveLaunch", () => {
  it("returns real paths for an allowed workspace", () => {
    const { root, workspace } = workspaceIn();
    expect(resolveLaunch(fakeLauncher(root), workspace)).toMatchObject({ workspace });
  });

  it("allows the root itself and refuses a sibling whose name merely starts with the root's", () => {
    const { root } = workspaceIn();
    expect(() => resolveLaunch(fakeLauncher(root), root)).not.toThrow();
    expect(() => resolveLaunch(fakeLauncher(root), `${root}-evil`)).toThrow();
  });

  it("refuses wildcard and non-absolute workspaces", () => {
    const { root } = workspaceIn();
    expect(() => resolveLaunch(fakeLauncher(root), `${root}/*`)).toThrow(/wildcards/);
    expect(() => resolveLaunch(fakeLauncher(root), "project")).toThrow(/absolute/);
  });
});

describe("buildEnv", () => {
  it("copies only the base names and the launcher's names", () => {
    const spec = fakeLauncher("/tmp/w", { env_allow: ["KEEP"] });
    const env = buildEnv(spec, { PATH: "/bin", KEEP: "1", PHOENIX_TOKEN: "t", AWS_SECRET: "s" });
    expect(Object.keys(env).sort()).toEqual(["KEEP", "NO_COLOR", "PATH", "TERM"]);
  });
});
