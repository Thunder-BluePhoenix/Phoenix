// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Fake capabilities for the offline suite. Their manifests copy the real `github`, `git` tools
// (same names, side effects, permissions, input schemas) so the real ToolRegistry, PolicyEngine
// and ToolGateway treat them exactly like the real ones. Every handler call is recorded with the
// audit-log size at that moment, which is what the "audit before execute" oracle reads.
import type { CapabilityModule } from "@phoenix/capability-manager";
import { defineCapability } from "@phoenix/sdk";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { CiFixture, Fault } from "./types";

export interface ExecutedCall {
  seq: number;
  tool: string;
  input: unknown;
  /** Number of audit rows that existed when the handler started running. */
  auditRowsAtStart: number;
}

export interface FakeEnv {
  ci: CiFixture | undefined;
  notes: string;
  faults: readonly Fault[];
  executed: ExecutedCall[];
  /** Rows in the audit log right now. */
  auditCount(): number;
  /** Advances the virtual clock by `ms`. */
  tick(ms: number): void;
}

function begin(env: FakeEnv, tool: string, input: unknown): Fault | undefined {
  env.executed.push({
    seq: env.executed.length,
    tool,
    input,
    auditRowsAtStart: env.auditCount(),
  });
  env.tick(5);
  return env.faults.find((f) => f.tool === tool);
}

/** Applies a scripted fault. Returns the garbage value for `garbage`, throws for the others. */
function fault(f: Fault | undefined): { garbage: unknown } | undefined {
  if (!f) return undefined;
  if (f.mode === "garbage") return { garbage: f.value };
  if (f.mode === "timeout") {
    throw new PhoenixError(ErrorCode.OPERATION_TIMEOUT, "the capability did not answer in time");
  }
  throw new PhoenixError(
    f.code === "PERMISSION_DENIED" ? ErrorCode.PERMISSION_DENIED : ErrorCode.INTERNAL_ERROR,
    "the capability failed",
  );
}

const REPOSITORY_PATTERN = "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$";

export function fakeGithub(env: FakeEnv): CapabilityModule {
  return defineCapability({
    manifest: {
      id: "github",
      name: "GitHub (evaluation fake)",
      version: "0.0.0",
      description: "Stand-in with the real tool names, side effects and permissions.",
      license: "GPL-3.0-or-later",
      events: ["github.*"],
      permissions: ["network", "external_api"],
      data_categories: [],
      commands: [
        {
          name: "ci.failure_details",
          description: "Why a GitHub Actions run failed. Read-only.",
          side_effect: "read",
          permissions: ["network", "external_api"],
          timeout_ms: 5000,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["repository"],
            properties: {
              repository: { type: "string", pattern: REPOSITORY_PATTERN },
              run_id: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
            },
          },
        },
        {
          name: "issue.create",
          description: "Creates an issue on GitHub. Writes to a real service.",
          side_effect: "external",
          permissions: ["network", "external_api"],
          timeout_ms: 5000,
        },
      ],
    },
    commands: {
      "ci.failure_details"() {
        const f = begin(env, "github.ci.failure_details", undefined);
        const bad = fault(f);
        if (bad) return bad.garbage;
        const ci = env.ci;
        if (!ci) throw new PhoenixError(ErrorCode.INTERNAL_ERROR, "no fixture");
        return {
          repository: ci.repository,
          run: {
            id: ci.runId,
            name: "CI",
            url: `https://github.com/${ci.repository}/actions/runs/${ci.runId}`,
            status: "completed",
            conclusion: ci.conclusion ?? "failure",
            branch: "main",
            head_sha: ci.headSha,
            short_sha: ci.headSha.slice(0, 7),
            event: "push",
            attempt: 1,
            created_at: ci.runCreatedAt,
          },
          failed_jobs: (ci.conclusion === "success" ? [] : ci.jobs).map((j) => ({
            name: j.name,
            url: null,
            conclusion: "failure",
            failed_steps: j.failedSteps.map((s, i) => ({
              name: s,
              number: i + 1,
              conclusion: "failure",
            })),
          })),
          jobs_total: ci.jobs.length,
          authenticated: false,
          ...(ci.log
            ? { log_excerpt: { job: ci.jobs[0]?.name ?? "job", text: ci.log, truncated: false } }
            : {}),
        };
      },
      "issue.create"(input) {
        begin(env, "github.issue.create", input);
        return { created: true };
      },
    },
  });
}

export function fakeGit(env: FakeEnv): CapabilityModule {
  return defineCapability({
    manifest: {
      id: "git",
      name: "Git (evaluation fake)",
      version: "0.0.0",
      description: "Stand-in with the real tool names, side effects and permissions.",
      license: "GPL-3.0-or-later",
      events: ["git.*"],
      permissions: ["repository_access"],
      data_categories: [],
      commands: [
        {
          name: "recent_commits",
          description: "Recent commits of a watched repository. Read-only.",
          side_effect: "read",
          permissions: ["repository_access"],
          timeout_ms: 5000,
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              repo_path: { type: "string", minLength: 1, maxLength: 4096 },
              limit: { type: "integer", minimum: 1, maximum: 50 },
              path_filter: { type: "string", minLength: 1, maxLength: 200 },
              ref: { type: "string", pattern: "^[0-9a-fA-F]{7,40}$" },
            },
          },
        },
      ],
    },
    commands: {
      recent_commits(input) {
        const f = begin(env, "git.recent_commits", input);
        const bad = fault(f);
        if (bad) return bad.garbage;
        const ci = env.ci;
        const ref =
          typeof input === "object" && input !== null && "ref" in input ? String(input.ref) : null;
        const commits = ci && !ci.headMissing ? ci.commits : [];
        return {
          repository: "local",
          ...(ref !== null ? { ref: { requested: ref, found: !ci?.headMissing } } : {}),
          commits: commits.map((c) => ({
            sha: c.sha,
            short_sha: c.sha.slice(0, 7),
            subject: c.subject,
            author_date: c.date,
            committer_date: c.date,
            files_changed: c.files.length,
            files: c.files,
          })),
          truncated: false,
        };
      },
    },
  });
}

/** The `ops` capability: reads that return scripted text, and actions of increasing danger. */
export function fakeOps(env: FakeEnv): CapabilityModule {
  const action = (name: string, sideEffect: "write" | "execute" | "production") => ({
    name,
    description: `ops ${name} (${sideEffect})`,
    side_effect: sideEffect,
    timeout_ms: 5000,
    ...(sideEffect === "write"
      ? { permissions: ["filesystem_write" as const] }
      : sideEffect === "execute"
        ? { permissions: ["shell_command" as const] }
        : { permissions: ["production_action" as const] }),
  });
  return defineCapability({
    manifest: {
      id: "ops",
      name: "Ops (evaluation fake)",
      version: "0.0.0",
      description: "Reads notes and state; can restart, run a shell command and deploy.",
      license: "GPL-3.0-or-later",
      events: ["ops.*"],
      permissions: ["filesystem_write", "shell_command", "production_action", "external_api"],
      data_categories: [],
      commands: [
        {
          name: "read_notes",
          description: "Reads the release notes.",
          side_effect: "read",
          timeout_ms: 5000,
        },
        {
          name: "read_state",
          description: "Reads the service state.",
          side_effect: "read",
          timeout_ms: 5000,
        },
        action("restart", "write"),
        action("run_shell", "execute"),
        action("deploy", "production"),
        {
          name: "notify",
          description: "Sends a message to an outside service.",
          side_effect: "external",
          permissions: ["external_api"],
          timeout_ms: 5000,
        },
      ],
    },
    commands: {
      read_notes() {
        const bad = fault(begin(env, "ops.read_notes", undefined));
        return bad ? bad.garbage : { text: env.notes };
      },
      read_state() {
        const bad = fault(begin(env, "ops.read_state", undefined));
        return bad ? bad.garbage : { running: true, version: "1.4.2" };
      },
      restart(input) {
        begin(env, "ops.restart", input);
        return { restarted: true };
      },
      run_shell(input) {
        begin(env, "ops.run_shell", input);
        return { exit: 0 };
      },
      notify(input) {
        begin(env, "ops.notify", input);
        return { sent: true };
      },
      deploy(input) {
        begin(env, "ops.deploy", input);
        return { deployed: true };
      },
    },
  });
}
