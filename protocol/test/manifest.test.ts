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

const aiManifest = (): CapabilityManifest => ({
  ...base(),
  permissions: ["network", "repository_access"],
  data_categories: ["repository_content"],
  commands: [
    {
      name: "generate",
      description: "Generate locally",
      side_effect: "read",
      permissions: ["network", "repository_access"],
    },
  ],
  ai_tools: [
    {
      name: "local_model",
      description: "Local model",
      kind: "model_provider",
      command: "generate",
      data_access: [{ category: "repository_content", sensitivity: "confidential" }],
      permissions: ["network", "repository_access"],
      provider: { locality: "local", provider: "ollama" },
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

  it("accepts explicit v1 versions but rejects unsupported manifest and event majors", () => {
    expect(errors({ ...base(), manifest_version: "1", compatibility: { protocol: "1" } })).toEqual(
      [],
    );
    expect(errors({ ...base(), manifest_version: "2" }).length).toBeGreaterThan(0);
    expect(errors({ ...base(), compatibility: { protocol: "2" } }).length).toBeGreaterThan(0);
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

  it.each([
    ["security.*", 'security.*" is in the reserved "security" namespace'],
    ["security.confirmation.requested", 'security.confirmation.requested" is in the reserved'],
    ["pet.*", 'pet.*" is in the reserved "pet" namespace'],
    ["system.online", 'system.online" is in the reserved "system" namespace'],
    ["capability.*", 'capability.*" is in the reserved "capability" namespace'],
    ["notification.created", 'notification.created" is in the reserved'],
    ["core.thing", 'core.thing" is in the reserved "core" namespace'],
  ])("rejects events in a namespace Phoenix reserves for itself (%s)", (pattern, message) => {
    const found = errors({ ...base(), events: ["git.*", pattern] });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(message);
  });

  it("allows event names that only look like a reserved one", () => {
    // The namespace is the first segment: "securityx" and "my.security.audit" are not "security".
    expect(validateManifest({ ...base(), events: ["securityx.*", "my.security.audit"] }).ok).toBe(
      true,
    );
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
  it("accepts optional local model and embedding declarations without changing legacy v1", () => {
    const m = aiManifest();
    expect(errors(m)).toEqual([]);
    expect(errors(base())).toEqual([]);
    expect(errors({ ...m, manifest_version: "2" })[0]).toMatch(/manifest_version/);
  });

  it("rejects underdeclared data and permission escalation", () => {
    const m = aiManifest();
    m.data_categories = [];
    expect(errors(m).join(" ")).toMatch(/undeclared data category/);
    m.data_categories = ["repository_content"];
    m.ai_tools![0]!.permissions = ["network", "repository_access", "filesystem_read"];
    expect(errors(m).join(" ")).toMatch(/undeclared permission "filesystem_read"/);
    m.permissions.push("filesystem_read");
    expect(errors(m).join(" ")).toMatch(/command lacks required permission "filesystem_read"/);
  });

  it("refuses sensitive cloud data and cloud without external processing permission", () => {
    const m = aiManifest();
    m.ai_tools![0]!.provider = { locality: "cloud", provider: "remote" };
    expect(errors(m).join(" ")).toMatch(/cannot send sensitive data to cloud/);
    expect(errors(m).join(" ")).toMatch(/requires "AI_external_processing"/);
    m.ai_tools![0]!.data_access = [{ category: "repository_content", sensitivity: "public" }];
    expect(errors(m).join(" ")).not.toMatch(/cannot send sensitive data/);
  });
  it("validates context source categories, locality and provider permissions", () => {
    const m = aiManifest();
    m.context_sources = [
      {
        name: "repository",
        description: "Repository context",
        data_access: [{ category: "repository_content", sensitivity: "internal" }],
        permissions: ["repository_access", "network"],
        provider: { locality: "local", provider: "ollama" },
      },
    ];
    expect(errors(m)).toEqual([]);
    m.context_sources[0]!.provider = { locality: "cloud", provider: "remote" };
    expect(errors(m).join(" ")).toMatch(/cannot send sensitive data to cloud/);
    m.context_sources[0]!.data_access[0]!.category = "secrets";
    expect(errors(m).join(" ")).toMatch(/undeclared data category "secrets"/);
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
