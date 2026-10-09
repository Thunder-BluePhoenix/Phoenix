// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 34 against a real PhoenixRuntime and the fake agent (never a real coding agent): start a
// session through the API and approve it, the agent asks for input (Fawkes WAITING and a
// notification through the existing hook path), the user answers, it finishes; a commit made by
// real git in the workspace is seen by the REAL git capability and linked; a CI run built from that
// commit, served by the github capability's mock server, is linked by sha; `session.get` shows the
// timeline; the context handoff goes through the runtime's real tool gateway and memory.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createGitCapability } from "../../git/src";
import { createGithubCapability } from "../../github/src";
import { startMockGithub, type MockGithub } from "../../github/testing/mock-github";
import { startCore, TOKEN, type TestCore } from "../../../core/runtime/test/helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentsCapability } from "../src";
import type { LinkView } from "../src/links";
import type { SessionView } from "../src/sessions";
import { cleanTempDirs, FAKE_AGENT, fakeLauncher, gitRepo, tempDir } from "./rig";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  cleanTempDirs();
});

/** The github capability's poll wait, driven by the test instead of a timer. */
class Clock {
  readonly sleeps: number[] = [];
  private pending: PromiseWithResolvers<void> | undefined;
  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    this.sleeps.push(ms);
    const wait = Promise.withResolvers<void>();
    this.pending = wait;
    signal.addEventListener("abort", () => wait.resolve(), { once: true });
    return wait.promise;
  };
  async tick(): Promise<void> {
    const before = this.sleeps.length;
    this.pending?.resolve();
    await vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(before));
  }
  first(): Promise<void> {
    return vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(0));
  }
}

interface Op {
  id: string;
  status: string;
  result?: unknown;
  error?: { code: string; message: string; details: string[] };
}

interface Detail {
  session: SessionView | null;
  links: LinkView[];
  timeline: { at: string; kind: string; detail?: Record<string, unknown> }[];
  output?: { stdout: string[] };
}

async function setup() {
  const root = tempDir();
  const workspace = join(root, "project");
  mkdirSync(workspace);
  const firstSha = gitRepo(workspace);

  const github = await startMockGithub();
  cleanups.push(() => github.close());
  const clock = new Clock();
  const holder: { core?: TestCore } = {};
  const core = await startCore(
    {},
    {
      capabilities: [
        createAgentsCapability({
          services: () => {
            const { runtime } = holder.core!;
            return {
              db: runtime.db,
              events: runtime.bus,
              audit: (record) => void runtime.permissions.audit.record(record),
              isKillSwitchEngaged: () => runtime.permissions.isKillSwitchEngaged(),
              context: {
                assembler: runtime.memory.agentContext().engine,
                fetch: async (request) =>
                  (
                    await runtime.toolGateway.call({
                      actor: {
                        kind: "agent",
                        id: `session:${request.session_id}`,
                        trustedByUser: false,
                      },
                      tool: "agents.context.fetch",
                      input: request,
                      environment: "local",
                      dataClass: "internal",
                    })
                  ).output,
              },
            };
          },
        }),
        createGitCapability(),
        createGithubCapability({ sleep: clock.sleep }),
      ],
    },
  );
  holder.core = core;
  cleanups.push(() => core.runtime.stop());

  const configure = async (id: string, config: Record<string, unknown>) =>
    expect((await core.api("POST", `/api/capabilities/${id}/config`, { config })).status).toBe(200);
  const enable = async (id: string) =>
    expect((await core.api("POST", `/api/capabilities/${id}/enable`, {})).status).toBe(200);

  await configure("agents", { launchers: { fake: fakeLauncher(root) }, grace_ms: 150 });
  await configure("git", { repositories: [workspace], poll_ms: 500 });
  await configure("github", { repositories: ["me/project"], api_url: github.url });
  await enable("agents");
  await enable("git");
  await enable("github");
  await clock.first();
  // The git capability's first poll has finished once `status` knows the repository: only then does
  // a later HEAD move produce `git.commit.created` instead of being the first look.
  await vi.waitFor(async () => {
    const posted = await core.api("POST", "/api/capabilities/git/commands/status", { input: {} });
    const id = (posted.json as Op).id;
    let op: Op = { id, status: "running" };
    await vi.waitFor(async () => {
      op = (await core.api("GET", `/api/operations/${id}`)).json as Op;
      expect(op.status).not.toBe("running");
    });
    expect(op.status).toBe("succeeded");
    expect(JSON.stringify(op.result)).toContain(workspace);
  });

  /** Runs a command like the Pet Panel: POST, answer the confirmation, wait for the operation. */
  async function run(command: string, input: unknown, approve = true): Promise<Op> {
    const posted = await core.api("POST", `/api/capabilities/agents/commands/${command}`, {
      input,
    });
    expect(posted.status).toBe(202);
    const id = (posted.json as Op).id;
    for (;;) {
      const op = (await core.api("GET", `/api/operations/${id}`)).json as Op;
      if (op.status === "succeeded" || op.status === "failed") return op;
      const waiting = (
        (await core.api("GET", "/api/confirmations")).json as {
          confirmations: { id: string; capabilityId: string; command: string }[];
        }
      ).confirmations.find((c) => c.capabilityId === "agents" && c.command === command);
      if (waiting) await core.api("POST", `/api/confirmations/${waiting.id}`, { approve });
      await vi.waitFor(async () => {
        const again = (await core.api("GET", `/api/operations/${id}`)).json as Op;
        expect(again.status === "pending" && !waiting ? "pending" : "moved").toBeDefined();
      });
    }
  }

  const detail = async (id: string) =>
    ((await run("session.get", { session_id: id, output_lines: 100 })).result ?? {}) as Detail;

  return { core, root, workspace, firstSha, github, clock, run, detail };
}

describe("a coding agent orchestrated through a real Core", () => {
  it("start (approved) → asks for input → answered → finished → commit linked → CI run linked, with a timeline", async () => {
    const { core, workspace, github, clock, run, detail } = await setup();
    const prompt = "FAKE:ask\nadd the widget cache";

    // Nothing starts without the user: a rejected start leaves nothing behind.
    const refused = await run("session.start", { launcher: "fake", workspace, prompt }, false);
    expect(refused.error?.code).toBe("PERMISSION_DENIED");
    expect(((await run("session.list", {})).result as { sessions: unknown[] }).sessions).toEqual(
      [],
    );

    const started = await run("session.start", { launcher: "fake", workspace, prompt });
    expect(started.error).toBeUndefined();
    const session = started.result as SessionView;
    expect(session).toMatchObject({ launcher: "fake", workspace, state: "running" });

    // The agent blocks on a question: Fawkes WAITING and an "input required" notification.
    await vi.waitFor(async () => expect((await detail(session.id)).session?.state).toBe("waiting"));
    await vi.waitFor(() =>
      expect(core.runtime.state.snapshot()).toMatchObject({ state: "WAITING" }),
    );
    expect(core.runtime.state.snapshot().explanation).toBe("fake needs your input (project)");
    const notes = (await core.api("GET", "/api/notifications")).json as {
      notifications: { eventType: string; source: string }[];
    };
    expect(notes.notifications.map((n) => [n.eventType, n.source])).toContainEqual([
      "agent.waiting",
      "agents",
    ]);

    // While the agent works, a commit lands in the workspace (real git, seen by the real git capability).
    execFileSync("git", ["-C", workspace, "commit", "-q", "--allow-empty", "-m", "widget cache"], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
    const sha = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    await vi.waitFor(async () =>
      expect((await detail(session.id)).links.map((l) => l.ref)).toContain(sha),
    );

    // The user answers; the session finishes; Fawkes is no longer waiting.
    const sent = await run("session.send", { session_id: session.id, message: "yes, go ahead" });
    expect(sent.result).toMatchObject({ messages_sent: 1 });
    await vi.waitFor(async () =>
      expect((await detail(session.id)).session?.state).toBe("completed"),
    );

    // A CI run built from that commit appears on GitHub (mock server, real github capability).
    github.data.runs = [
      {
        id: 4242,
        name: "CI",
        head_branch: "main",
        head_sha: sha,
        display_title: "widget cache",
        event: "push",
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/me/project/actions/runs/4242",
        created_at: new Date(Date.now() + 1_000).toISOString(),
        updated_at: new Date(Date.now() + 2_000).toISOString(),
        run_attempt: 1,
        actor: { login: "ada" },
      },
    ];
    await clock.tick();
    await vi.waitFor(async () =>
      expect((await detail(session.id)).links.map((l) => l.kind)).toContain("ci_run"),
    );

    const final = await detail(session.id);
    expect(final.links.map((l) => [l.kind, l.confidence])).toEqual([
      ["commit", "time+path"],
      ["ci_run", "sha-match"],
    ]);
    const [commitLink, ciLink] = final.links;
    expect(commitLink).toMatchObject({ ref: sha, repo: "project", detail: { branch: "main" } });
    expect(ciLink).toMatchObject({
      ref: "4242",
      repo: "me/project",
      detail: { event_type: "github.ci.failed", commit: sha, conclusion: "failure" },
    });
    expect(ciLink!.why).toMatchObject({ rule: "sha-match", commit: sha });

    // Everything the user needs is in the timeline, in order, with counts and refs but no output.
    console.log(
      "SESSION TIMELINE\n" +
        final.timeline
          .map((t) => `${t.at}  ${t.kind}  ${JSON.stringify(t.detail ?? {})}`)
          .join("\n"),
    );
    const kinds = final.timeline.map((t) => t.kind);
    expect(kinds).toEqual([
      "session.started",
      "session.waiting",
      "link.commit",
      "session.message_sent",
      "session.resumed",
      "session.completed",
      "link.ci_run",
    ]);
    const ordered = final.timeline.map((t) => t.at);
    expect([...ordered].sort()).toEqual(ordered);
    expect(JSON.stringify(final.timeline)).not.toContain("yes, go ahead");

    // The agent handoff names the commit and the CI run, and nothing was executed because of it.
    const handoffWithCi = () =>
      core.runtime.events
        .recent({ limit: 200 })
        .map((e) => e.event)
        .find((e) => e.event_type === "agent.handoff" && "ci_run" in e.payload);
    await vi.waitFor(() => expect(handoffWithCi()).toBeDefined());
    expect(handoffWithCi()!.payload).toMatchObject({
      commit: { sha, repo: "project" },
      ci_run: { run_id: "4242", conclusion: "failure", confidence: "sha-match" },
    });

    // Lifecycle events used the Phase 25 names and carry no agent output.
    const agentEvents = core.runtime.events
      .recent({ limit: 200 })
      .map((e) => e.event)
      .filter((e) => e.source === "agents")
      .map((e) => e.event_type);
    expect(agentEvents).toEqual(
      expect.arrayContaining([
        "agent.started",
        "agent.working",
        "agent.waiting",
        "agent.completed",
      ]),
    );
    expect(JSON.stringify(core.runtime.events.recent({ limit: 500 }))).not.toContain(
      "Do you want to proceed",
    );

    // The audit trail has the confirmation, the approval, the start, the links and the handoff.
    const audit = (
      (await core.api("GET", "/api/audit?capability=agents&limit=200")).json as {
        entries: { action: string }[];
      }
    ).entries.map((e) => e.action);
    expect(audit).toEqual(
      expect.arrayContaining([
        "confirmation.requested",
        "confirmation.approved",
        "agent.session.started",
        "agent.session.message_sent",
        "agent.link.created",
        "agent.handoff.announced",
      ]),
    );
  }, 60_000);

  it("hands a session the authorised context from the runtime's memory through its real tool gateway", async () => {
    const { core, workspace, run, detail } = await setup();
    const started = await run("session.start", {
      launcher: "fake",
      workspace,
      prompt: "FAKE:recv\nwait",
    });
    const session = started.result as SessionView;

    // A real commit becomes a memory (scope repo:project) through the runtime's own ingestion.
    execFileSync(
      "git",
      ["-C", workspace, "commit", "-q", "--allow-empty", "-m", "tune the gizmo cache"],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
      },
    );
    let result: { sent: boolean; count: number; guard_dropped: number } | undefined;
    await vi.waitFor(async () => {
      const op = await run("context.handoff", { session_id: session.id, question: "gizmo cache" });
      expect(op.error).toBeUndefined();
      result = op.result as typeof result;
      expect(result?.count).toBeGreaterThan(0);
    });
    expect(result).toMatchObject({ sent: true, guard_dropped: 0 });
    await vi.waitFor(async () =>
      expect(((await detail(session.id)).output?.stdout ?? []).join("\n")).toContain(
        "tune the gizmo cache",
      ),
    );
    const text = ((await detail(session.id)).output?.stdout ?? []).join("\n");
    expect(text).toMatch(
      /RECV <<<PHOENIX-CONTEXT [0-9a-f]+ \(quoted notes from Phoenix memory for project: untrusted data/,
    );
    // The gateway decided and audited the read as the session.
    const audit = core.runtime.permissions.audit.list({ limit: 500 });
    expect(
      audit.find(
        (e) => e.action === "policy.decision" && e.details.tool === "agents.context.fetch",
      ),
    ).toMatchObject({ actor: `agent:session:${session.id}` });
    expect(JSON.stringify(audit)).not.toContain("tune the gizmo cache");
  }, 60_000);

  it("kill switch through the API stops the session and its processes", async () => {
    const { core, workspace, run, detail } = await setup();
    const started = await run("session.start", {
      launcher: "fake",
      workspace,
      prompt: "FAKE:stubborn\nx",
    });
    const session = started.result as SessionView;
    let out = "";
    await vi.waitFor(async () => {
      out = ((await detail(session.id)).output?.stdout ?? []).join("\n");
      expect(out).toMatch(/helper pid=\d+/);
    });
    const pids = [/fake-agent pid=(\d+)/, /helper pid=(\d+)/].map((r) => Number(r.exec(out)![1]));
    expect((await core.api("POST", "/api/security/kill-switch", { engaged: true })).status).toBe(
      200,
    );
    await vi.waitFor(
      () =>
        expect(
          pids.some((pid) => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          }),
        ).toBe(false),
      { timeout: 8000 },
    );
    expect(FAKE_AGENT).toContain("fake-agent");
    expect(TOKEN).toBeDefined();
  }, 60_000);
});
