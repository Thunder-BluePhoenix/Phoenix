// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { compileSchema, eventDeclared, validateManifest, type CapabilityManifest } from "../src";

const base = (): CapabilityManifest => ({
  id: "git",
  name: "Git",
  version: "0.1.0",
  description: "Local repository activity",
  license: "GPL-3.0-or-later",
  events: ["git.*", "build.started"],
  permissions: ["repository_access"],
  commands: [
    {
      name: "status",
      description: "Repository status",
      side_effect: "read",
      permissions: ["repository_access"],
    },
  ],
});

const errors = (m: unknown) => {
  const r = validateManifest(m);
  return r.ok ? [] : r.error.details;
};

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(validateManifest(base()).ok).toBe(true);
  });

  it.each([
    ["bad id", { id: "Git!" }],
    ["bad version", { version: "1.0" }],
    ["unknown permission", { permissions: ["root"] }],
    ["bad event pattern", { events: ["Git.*"] }],
    ["unknown field", { surprise: true }],
    ["bad side effect", { commands: [{ name: "x", description: "x", side_effect: "nuke" }] }],
  ])("rejects %s", (_n, patch) => {
    expect(errors({ ...base(), ...patch }).length).toBeGreaterThan(0);
  });

  it("rejects reserved ids", () => {
    expect(errors({ ...base(), id: "core" })).toEqual(['/id "core" is reserved']);
  });

  it("rejects commands using undeclared permissions", () => {
    const m = base();
    m.commands[0]!.permissions = ["shell_command"];
    expect(errors(m)).toEqual(['/commands/status uses undeclared permission "shell_command"']);
  });

  it("rejects duplicate commands and rules for undeclared events", () => {
    const m = base();
    m.commands.push({ ...m.commands[0]! });
    m.state_rules = [{ match: "deploy.started", effect: { state: "DEPLOYING" } }];
    expect(errors(m)).toEqual([
      '/commands duplicate command "status"',
      '/state_rules "deploy.started" does not match any declared event',
    ]);
  });

  it("rejects invalid embedded JSON Schemas", () => {
    expect(errors({ ...base(), config_schema: { type: "nope" } })[0]).toMatch(/config_schema/);
  });
});

describe("helpers", () => {
  it("eventDeclared", () => {
    expect(eventDeclared(["git.*", "build.started"], "git.commit.created")).toBe(true);
    expect(eventDeclared(["git.*"], "gitx.y")).toBe(false);
    expect(eventDeclared(["build.started"], "build.failed")).toBe(false);
  });

  it("compileSchema reports errors", () => {
    const check = compileSchema({
      type: "object",
      required: ["repo"],
      properties: { repo: { type: "string" } },
    });
    expect(check({ repo: "x" })).toEqual([]);
    expect(check({})).toHaveLength(1);
  });
});
