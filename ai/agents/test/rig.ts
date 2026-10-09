// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextEngine } from "@phoenix/ai-context";
import { MemoryPipeline, MemoryStore, createDefaultPolicy, ownerViewer } from "@phoenix/ai-memory";
import type { GenerateRequest, GenerateResult } from "@phoenix/ai-models";
import { Orchestrator, approvalFeed } from "@phoenix/ai-orchestrator";
import {
  ToolGateway,
  ToolRegistry,
  approverFromPermissions,
  enabledManifests,
} from "@phoenix/ai-tool-gateway";
import { createGitCapability } from "@phoenix/capability-git";
import { createGithubCapability } from "@phoenix/capability-github";
import { CapabilityManager } from "@phoenix/capability-manager";
import { EventBus } from "@phoenix/event-bus";
import { PermissionGateway } from "@phoenix/permissions";
import { EventStore, MemorySecretStore, openDatabase, type Database } from "@phoenix/persistence";
import { PolicyEngine, PolicyStore } from "@phoenix/policy";
import { StateEngine } from "@phoenix/state-engine";
import { createCiFailureAgent, type ModelCall } from "../src";

// The github test mock server is a test helper of that package.
import { startMockGithub, type MockGithub } from "../../../capabilities/github/testing/mock-github";

export const REPO = "octo/phoenix";
export const RUN_ID = 4242;
export const FAILED_SHA = "a4ef8a44ea85e0e78161a10caeabfc54ec476bca";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../capabilities/github/test/fixtures", name),
      "utf8",
    ),
  );

interface JobsFixture {
  jobs: unknown[];
}

// The recorded fixture is trusted test data with this shape.
const jobsFixture = (): JobsFixture => {
  const raw: JobsFixture = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../capabilities/github/test/fixtures/jobs-failed-run.json"),
      "utf8",
    ),
  );
  return raw;
};

export interface ModelProbe {
  calls: GenerateRequest[];
  /** What the fake model answers next. */
  answer: (request: GenerateRequest) => string | Error;
}

export interface RigOptions {
  /** Include a model at all (AI on). */
  ai?: boolean;
  aiEnabled?: boolean;
  withGit?: boolean;
  memory?: {
    text: string;
    dedupeKey: string;
    scope?: string;
    contentType?: "doc" | "meeting_summary";
    /** Days since the source last confirmed it, and its freshness limit (null/absent: never stale). */
    ageDays?: number;
    ttlDays?: number;
  }[];
  githubData?: (g: MockGithub) => void;
  /** Replaces the fake model (used by a throwaway script that talks to a real Ollama). */
  model?: ModelCall;
}

export interface Rig {
  orchestrator: Orchestrator;
  permissions: PermissionGateway;
  gh: MockGithub;
  repoDir: string;
  probe: ModelProbe;
  db: Database;
  settings: { enabled: boolean };
  /**
   * Makes the mocked CI run be the one built from `sha` (default: the repository's HEAD) and
   * created at `createdAt` (default: an hour from now, i.e. after every commit the test made).
   */
  pointRun(over?: { sha?: string; createdAt?: string }): string;
  /** True once the test repository has at least one commit. */
  hasCommits(): boolean;
  /** Commits a file and returns the new full sha. */
  commit(subject: string, files: Record<string, string>): string;
  close(): Promise<void>;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The run recorded from the real repository: secret-scan failed at "Run gitleaks/gitleaks-action@v2". */
export function realRunData(g: MockGithub): void {
  const detail = fixture("run-detail-failed.json") as Record<string, unknown>;
  g.data.runDetails[RUN_ID] = {
    ...detail,
    id: RUN_ID,
    html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
  };
  g.data.jobs[RUN_ID] = jobsFixture().jobs;
}

export async function makeRig(options: RigOptions = {}): Promise<Rig> {
  const db = openDatabase(":memory:");
  const store = new EventStore(db);
  const bus = new EventBus({ store, retryDelayMs: 0 });
  const permissions = new PermissionGateway({ db, publish: (e) => void bus.publish(e) });
  const manager = new CapabilityManager({
    db,
    bus,
    events: store,
    permissions,
    state: new StateEngine(),
    secrets: new MemorySecretStore(),
    defaultHealthIntervalMs: 3_600_000,
  });
  const gh = await startMockGithub();
  (options.githubData ?? realRunData)(gh);
  const repoDir = mkdtempSync(join(tmpdir(), "phoenix-agent-repo-"));
  git(repoDir, "init", "-q", "-b", "main");
  git(repoDir, "config", "user.email", "a@example.invalid");
  git(repoDir, "config", "user.name", "A");
  git(repoDir, "config", "commit.gpgsign", "false");
  const commit = (subject: string, files: Record<string, string>): string => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(repoDir, path, ".."), { recursive: true });
      writeFileSync(join(repoDir, path), content);
    }
    git(repoDir, "add", "-A");
    execFileSync("git", ["commit", "-q", "-F", "-"], { cwd: repoDir, input: subject });
    return git(repoDir, "rev-parse", "HEAD");
  };

  manager.registerBuiltin(
    createGithubCapability({ sleep: () => Promise.withResolvers<void>().promise }),
  );
  manager.registerBuiltin(createGitCapability());
  manager.configure("github", { repositories: [], api_url: gh.url });
  manager.configure("git", { repositories: [repoDir], poll_ms: 60_000 });
  await manager.enable("github");
  if (options.withGit !== false) await manager.enable("git");

  const registry = new ToolRegistry({ manifests: enabledManifests(manager, db) });
  const policy = new PolicyEngine({
    store: new PolicyStore(db),
    audit: permissions.audit,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    isKnownTool: (t) => registry.has(t),
  });
  const gateway = new ToolGateway({
    host: manager,
    registry,
    policy,
    audit: permissions.audit,
    approver: approverFromPermissions(permissions),
  });

  // The memory clock is a variable so seeding can say when a note was last confirmed.
  const seedClock = { now: new Date() };
  const memStore = new MemoryStore(db, { now: () => seedClock.now });
  const pipeline = new MemoryPipeline({
    store: memStore,
    owner: "me",
    policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
  });
  const realNow = new Date();
  for (const m of options.memory ?? []) {
    const observed = new Date(realNow.getTime() - (m.ageDays ?? 0) * 86_400_000);
    seedClock.now = observed;
    pipeline.capture({
      source: "project-docs",
      sourceRef: "docs/notes.md",
      scope: m.scope ?? "path:/docs",
      contentType: m.contentType ?? "doc",
      observedAt: observed.toISOString(),
      provenance: {},
      text: m.text,
      dedupeKey: m.dedupeKey,
      ...(m.ttlDays === undefined ? {} : { freshnessTtlDays: m.ttlDays }),
    });
  }
  seedClock.now = realNow;
  const engine = new ContextEngine({
    store: memStore,
    clock: { now: () => new Date(), timeZone: "UTC" },
  });

  const probe: ModelProbe = { calls: [], answer: () => new Error("no model answer configured") };
  const model: ModelCall = async (request) => {
    probe.calls.push(request);
    const out = probe.answer(request);
    if (out instanceof Error) throw out;
    const result: GenerateResult = {
      text: out,
      provenance: {
        provider: "fake",
        model: "fake-1",
        locality: "local",
        processedBy: "Fake · fake-1 · on this device",
      },
    };
    return result;
  };

  const settings = { enabled: true };
  const orchestrator = new Orchestrator({
    db,
    gateway,
    audit: permissions.audit,
    isEnabled: () => settings.enabled,
    isKillSwitchEngaged: () => permissions.isKillSwitchEngaged(),
    publish: (e) =>
      void bus.publish({
        ...e,
        event_id: undefined,
        version: "1.1",
        timestamp: new Date().toISOString(),
        payload: e.payload ?? {},
      }),
    approvals: approvalFeed(bus, permissions),
    agents: [
      createCiFailureAgent({
        model: options.model ?? (options.ai ? model : null),
        aiEnabled: () => options.aiEnabled ?? (options.ai || options.model !== undefined),
        context: { engine, viewer: ownerViewer("me") },
        nonce: () => "NONCE",
      }),
    ],
  });

  const pointRun = (over: { sha?: string; createdAt?: string } = {}): string => {
    const sha = over.sha ?? git(repoDir, "rev-parse", "HEAD");
    const detail = gh.data.runDetails[RUN_ID];
    if (typeof detail !== "object" || detail === null) throw new Error("no mocked run to point");
    gh.data.runDetails[RUN_ID] = {
      ...detail,
      head_sha: sha,
      created_at: over.createdAt ?? new Date(Date.now() + 3_600_000).toISOString(),
    };
    return sha;
  };

  const hasCommits = (): boolean => {
    try {
      git(repoDir, "rev-parse", "--verify", "HEAD");
      return true;
    } catch {
      return false;
    }
  };

  return {
    pointRun,
    hasCommits,
    orchestrator,
    permissions,
    gh,
    repoDir,
    probe,
    db,
    settings,
    commit,
    async close() {
      await orchestrator.close();
      await manager.close();
      permissions.close();
      await bus.drain();
      db.close();
      await gh.close();
      rmSync(repoDir, { recursive: true, force: true });
    },
  };
}
