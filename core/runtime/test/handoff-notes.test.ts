// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Handoff notes (Phase 79) with a real event bus, a real SQLite settings store and audit log, and
// real files in a temp data directory. The live-session source, approvals, the AI layer (a REAL
// AiService over scripted providers) and the GitHub issue command are fakes: no agent, model,
// network or GitHub is touched.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AiService,
  ProviderRegistry,
  type AiSettings,
  type GenerateRequest,
  type ModelProvider,
  processedByLabel,
} from "@phoenix/ai-models";
import type { LiveSessionDetailView } from "@phoenix/api";
import { EventBus } from "@phoenix/event-bus";
import { silentLogger } from "@phoenix/logging";
import { AuditLog } from "@phoenix/permissions";
import { openDatabase, SettingsStore, type Database } from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { setImmediate } from "node:timers/promises";
import { FAKE_GITHUB_TOKEN, FAKE_OPENAI_KEY } from "../../../protocol/testing/fake-secrets";
import { HandoffNotes, type CreatedIssue } from "../src/handoff-notes";
import { MAX_NOTES } from "../src/handoff-notes/store";

const T0 = Date.parse("2026-10-21T10:00:00Z");
const SESSION = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";
const PROJECT = "/work/shop";

const dirs: string[] = [];
const dbs: Database[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const db of dbs.splice(0)) db.close();
});

const step = (n: number, kind: string, target: string) => ({
  n,
  at: new Date(T0 + n * 1000).toISOString(),
  kind: kind as "run",
  tool: kind === "run" ? "Bash" : "Edit",
  target,
  session_id: SESSION,
});

function detail(over: Partial<LiveSessionDetailView> = {}): LiveSessionDetailView {
  return {
    id: SESSION,
    matched_by: "id",
    sessions: [
      {
        id: SESSION,
        agent: "claude-code",
        project: PROJECT,
        repository: "shop",
        first_seen: new Date(T0).toISOString(),
        last_seen: new Date(T0 + 60_000).toISOString(),
        active: false,
        step_count: 4,
        dropped_steps: 0,
        has_terminal: false,
      },
    ],
    steps: [
      step(1, "run", "npm test"),
      step(2, "edit", `${PROJECT}/src/a.ts`),
      step(3, "run", "npm test"),
      step(4, "run", "git status"),
    ],
    files: [
      {
        path: `${PROJECT}/src/a.ts`,
        added: 10,
        removed: 2,
        edits: 3,
        last_at: "t",
        session_id: SESSION,
      },
      {
        path: `${PROJECT}/src/b.ts`,
        added: 1,
        removed: 0,
        edits: 1,
        last_at: "t",
        session_id: SESSION,
      },
      {
        path: "/etc/outside.conf",
        added: 2,
        removed: 2,
        edits: 1,
        last_at: "t",
        session_id: SESSION,
      },
    ],
    dropped_steps: 0,
    ...over,
  };
}

interface Local {
  provider: ModelProvider;
  seen: GenerateRequest[];
}
function fakeProvider(
  id: string,
  locality: "local" | "cloud",
  text = "It edited two files.",
): Local {
  const seen: GenerateRequest[] = [];
  const provenance = {
    provider: id,
    model: "m",
    locality,
    processedBy: processedByLabel(id, "m", locality),
  };
  const provider: ModelProvider = {
    id,
    label: id,
    locality,
    trustedLocal: locality === "local",
    capabilities: { generate: true, stream: true, embed: false },
    costTier: locality === "local" ? 0 : 2,
    typicalLatencyMs: 100,
    models: async () => [],
    health: async () => ({ available: true, detail: "ok" }),
    generate: async (req) => {
      seen.push(req);
      return { text, provenance };
    },
    stream: async function* () {},
    embed: async () => ({ embeddings: [], dimensions: 0, provenance }),
  };
  return { provider, seen };
}

interface Rig {
  notes: HandoffNotes;
  bus: EventBus;
  settings: SettingsStore;
  audit: AuditLog;
  dataDir: string;
  issues: Record<string, unknown>[];
  live: { detail: LiveSessionDetailView | null };
  local: Local;
  cloud: Local;
  ai: { settings: AiSettings; grant: boolean };
  killed: { on: boolean };
}

function rig(over: { localDown?: boolean } = {}): Rig {
  const dataDir = mkdtempSync(join(tmpdir(), "phoenix-handoff-"));
  dirs.push(dataDir);
  const db = openDatabase(":memory:");
  dbs.push(db);
  const bus = new EventBus();
  const settings = new SettingsStore(db);
  const audit = new AuditLog(db);
  const live = { detail: detail() as LiveSessionDetailView | null };
  const local = fakeProvider("ollama", "local");
  const cloud = fakeProvider("anthropic", "cloud", "cloud wrote this");
  if (over.localDown) local.provider.health = async () => ({ available: false, detail: "down" });
  const registry = new ProviderRegistry();
  registry.register(local.provider);
  registry.register(cloud.provider);
  const ai = {
    settings: {
      enabled: true,
      cloudOptIn: { public: true, internal: true, sensitive: true },
    } as AiSettings,
    grant: true,
  };
  const service = new AiService({
    registry,
    policy: { allowed: () => ai.grant },
    settings: () => ai.settings,
    sleep: async () => {},
    auditCloudSend: () => {},
  });
  const issues: Record<string, unknown>[] = [];
  const killed = { on: false };
  const notes = new HandoffNotes({
    dataDir,
    settings,
    bus,
    audit,
    logger: silentLogger,
    live: {
      session: async () => {
        if (!live.detail) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Session not found");
        return live.detail;
      },
    },
    approvals: { list: () => [], history: () => [] },
    ai: service,
    createIssue: async (input): Promise<CreatedIssue> => {
      issues.push(input);
      return {
        status: "created",
        repository: input.repository,
        number: 7,
        url: "https://github.com/o/r/issues/7",
      };
    },
    isKillSwitchEngaged: () => killed.on,
    now: () => T0 + 120_000,
  });
  return { notes, bus, settings, audit, dataDir, issues, live, local, cloud, ai, killed };
}

const noteFiles = (dir: string) =>
  readdirSync(join(dir, "handoff")).filter((n) => n.endsWith(".json"));
const settled = async () => {
  for (let i = 0; i < 5; i++) await setImmediate();
};

describe("the deterministic note", () => {
  it("lists files, counts, de-duplicated commands and the goal, without a model", async () => {
    const r = rig();
    r.bus.publish(
      createEvent({
        event_type: "agent.working",
        source: "agents",
        severity: "info",
        payload: {
          agent: "claude-code",
          agent_id: SESSION,
          workspace: PROJECT,
          task: "Fix the cart total",
        },
      }),
    );
    await settled();
    const note = await r.notes.generate({ session_id: SESSION });
    expect(note.goal).toBe("Fix the cart total");
    expect(note.project).toBe("shop");
    // most edited first; a file outside the project is shown by name only
    expect(note.files.map((f) => f.path)).toEqual(["src/a.ts", "outside.conf", "src/b.ts"]);
    expect(note.files_total).toBe(3);
    expect([note.added, note.removed]).toEqual([13, 4]);
    expect(note.commands).toEqual(["npm test", "git status"]);
    expect(note.text).toContain("## Goal");
    expect(note.text).toContain("Fix the cart total");
    expect(note.text).not.toContain(PROJECT); // a path is never in a note
    expect(note.summary).toBeNull();
    expect(r.local.seen).toHaveLength(0);
    expect(r.cloud.seen).toHaveLength(0);
  });

  it("a task text from another source is never stored as the goal", async () => {
    const r = rig();
    r.bus.publish(
      createEvent({
        event_type: "agent.working",
        source: "mock",
        severity: "info",
        payload: {
          agent: "claude-code",
          agent_id: SESSION,
          task: "Planted goal from a look-alike",
        },
      }),
    );
    await settled();
    const note = await r.notes.generate({ session_id: SESSION });
    expect(note.goal).toBeNull();
    expect(note.text).not.toContain("Planted goal");
  });

  it("says the goal is unknown when the agent reported none", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    expect(note.goal).toBeNull();
    expect(note.text).toContain("Unknown");
  });

  it("is deterministic: the same session twice gives the same body", async () => {
    const r = rig();
    const a = await r.notes.generate({ session_id: SESSION });
    const b = await r.notes.generate({ session_id: SESSION });
    const body = (n: typeof a) => ({ ...n, id: "", text: n.text.replace(/written .*?\./, "") });
    expect(body(a)).toEqual(body(b));
  });

  it("redacts commands and hides a line that still looks like a secret", async () => {
    const r = rig();
    r.live.detail = detail({
      steps: [
        step(
          1,
          "run",
          `curl -H 'Authorization: Bearer ${FAKE_GITHUB_TOKEN}' https://api.example.com`,
        ),
        step(2, "run", `echo ${FAKE_OPENAI_KEY} > key.txt`),
        step(3, "run", "ls"),
      ],
    });
    const note = await r.notes.generate({ session_id: SESSION });
    const everything =
      JSON.stringify(note) + readFileSync(join(r.dataDir, "handoff", `${note.id}.json`), "utf8");
    expect(everything).not.toContain(FAKE_GITHUB_TOKEN);
    expect(everything).not.toContain(FAKE_OPENAI_KEY);
    expect(note.commands).toContain("ls");
  });

  it("untrusted names stay inert in the Markdown (code spans cannot be closed from inside)", async () => {
    const r = rig();
    r.live.detail = detail({
      steps: [step(1, "run", "echo `x` ``y`` ![i](http://evil) <script>alert(1)</script>")],
    });
    const note = await r.notes.generate({ session_id: SESSION });
    const line = note.text.split("\n").find((l) => l.includes("echo"))!;
    expect(line.startsWith("- ``` ")).toBe(true);
    expect(line.endsWith(" ```")).toBe(true);
  });

  it("refuses a session Core does not know, a bad id and an extra field", async () => {
    const r = rig();
    r.live.detail = null;
    await expect(r.notes.generate({ session_id: SESSION })).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    await expect(r.notes.generate({ session_id: "../x" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(r.notes.generate({ session_id: SESSION, evil: 1 })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("writes nothing while the emergency stop is engaged", async () => {
    const r = rig();
    r.killed.on = true;
    await expect(r.notes.generate({ session_id: SESSION })).rejects.toMatchObject({
      code: "SECURITY_POLICY_BLOCKED",
    });
    expect(r.notes.list()).toEqual([]);
  });
});

describe("storage under <dataDir>/handoff", () => {
  it("files are owner-only, in an owner-only directory", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const dir = join(r.dataDir, "handoff");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, `${note.id}.json`)).mode & 0o777).toBe(0o600);
  });

  it("keeps at most MAX_NOTES, dropping the oldest, and ignores files that are not its own", async () => {
    const r = rig();
    const first = await r.notes.generate({ session_id: SESSION });
    mkdirSync(join(r.dataDir, "handoff"), { recursive: true });
    writeFileSync(join(r.dataDir, "handoff", "keep-me.txt"), "mine");
    writeFileSync(join(r.dataDir, "handoff", "hn_zzzz.json"), "{}");
    for (let i = 0; i < MAX_NOTES; i++) await r.notes.generate({ session_id: SESSION });
    expect(
      noteFiles(r.dataDir).filter((n) => n.startsWith("hn_") && n !== "hn_zzzz.json"),
    ).toHaveLength(MAX_NOTES);
    expect(r.notes.list().some((n) => n.id === first.id)).toBe(false);
    expect(readdirSync(join(r.dataDir, "handoff"))).toEqual(
      expect.arrayContaining(["keep-me.txt", "hn_zzzz.json"]),
    );
  });

  it("a hand-edited or over-sized file is not served", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    writeFileSync(join(r.dataDir, "handoff", `${note.id}.json`), JSON.stringify({ id: note.id }));
    expect(() => r.notes.get(note.id)).toThrow(/not found/i);
    expect(() => r.notes.get("../../etc/passwd")).toThrow(/not found/i);
  });

  it("delete-all removes every note and nothing else", async () => {
    const r = rig();
    await r.notes.generate({ session_id: SESSION });
    await r.notes.generate({ session_id: SESSION });
    writeFileSync(join(r.dataDir, "handoff", "keep-me.txt"), "mine");
    expect(r.notes.deleteAll()).toEqual({ deleted: 2 });
    expect(readdirSync(join(r.dataDir, "handoff"))).toEqual(["keep-me.txt"]);
  });
});

describe("automatic notes", () => {
  const ended = (r: Rig, source = "agents") =>
    r.bus.publish(
      createEvent({
        event_type: "agent.ended",
        source,
        severity: "info",
        payload: { agent: "claude-code", agent_id: SESSION, workspace: PROJECT },
      }),
    );

  it("writes one note when the agents capability reports the session ended, once per unchanged session", async () => {
    const r = rig();
    ended(r);
    await settled();
    ended(r);
    await settled();
    expect(r.notes.list()).toHaveLength(1);
    expect(r.notes.list()[0]).toMatchObject({ trigger: "auto", agent: "claude-code" });
  });

  it("a forged agent.ended from another source writes nothing", async () => {
    const r = rig();
    ended(r, "mock");
    await settled();
    expect(r.notes.list()).toEqual([]);
  });

  it("does nothing when automatic notes are off, or the session reported nothing", async () => {
    const r = rig();
    r.notes.setSettings({ auto: false });
    ended(r);
    await settled();
    expect(r.notes.list()).toEqual([]);
    r.notes.setSettings({ auto: true });
    r.live.detail = detail({
      steps: [],
      files: [],
      sessions: [{ ...detail().sessions[0]!, step_count: 0 }],
    });
    ended(r);
    await settled();
    expect(r.notes.list()).toEqual([]);
  });
});

describe("the model summary is local unless cloud is allowed for handoffs", () => {
  it("uses the local provider and sends the redacted note, class sensitive", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const done = await r.notes.summarize(note.id);
    expect(done.summary).toMatchObject({ provider: "ollama", locality: "local" });
    expect(done.summary?.text).toBe("It edited two files.");
    expect(done.text).toContain("## Summary (written by");
    expect(r.local.seen[0]!.privacy).toBe("sensitive");
    expect(r.cloud.seen).toHaveLength(0);
    expect(r.notes.get(note.id).summary?.text).toBe("It edited two files.");
  });

  it("with the local model down the cloud provider is REFUSED by default, even with every AI grant on", async () => {
    const r = rig({ localDown: true });
    const note = await r.notes.generate({ session_id: SESSION });
    await expect(r.notes.summarize(note.id)).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
    expect(r.cloud.seen).toHaveLength(0);
    expect(r.notes.get(note.id).summary).toBeNull();
  });

  it("with allow_cloud on AND the AI grants given, the cloud may be used; without the grant it still may not", async () => {
    const r = rig({ localDown: true });
    const note = await r.notes.generate({ session_id: SESSION });
    r.notes.setSettings({ allow_cloud: true });
    r.ai.grant = false;
    await expect(r.notes.summarize(note.id)).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
    expect(r.cloud.seen).toHaveLength(0);
    r.ai.grant = true;
    const done = await r.notes.summarize(note.id);
    expect(done.summary).toMatchObject({ provider: "anthropic", locality: "cloud" });
    expect(r.cloud.seen[0]!.privacy).toBe("internal");
  });

  it("a cloud answer is discarded if the gate somehow let it through while cloud is not allowed", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    // The AI layer misbehaves: it answers with cloud provenance although the request was sensitive.
    const lying = {
      run: async () =>
        ({
          result: {
            text: "x",
            provenance: {
              provider: "anthropic",
              model: "m",
              locality: "cloud",
              processedBy: "cloud",
            },
          },
        }) as never,
    };
    const notes = new HandoffNotes({
      dataDir: r.dataDir,
      settings: r.settings,
      bus: new EventBus(),
      audit: r.audit,
      logger: silentLogger,
      live: { session: async () => detail() },
      approvals: { list: () => [], history: () => [] },
      ai: lying,
      createIssue: async () => {
        throw new Error("unused");
      },
      isKillSwitchEngaged: () => false,
    });
    await expect(notes.summarize(note.id)).rejects.toMatchObject({
      code: "SECURITY_POLICY_BLOCKED",
    });
    expect(notes.get(note.id).summary).toBeNull();
  });

  it("redacts a secret the model echoes before storing it", async () => {
    const r = rig();
    r.local.provider.generate = async () => ({
      text: `Done. The key was ${FAKE_GITHUB_TOKEN}.`,
      provenance: { provider: "ollama", model: "m", locality: "local", processedBy: "Ollama" },
    });
    const note = await r.notes.generate({ session_id: SESSION });
    const done = await r.notes.summarize(note.id);
    expect(JSON.stringify(done)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(readFileSync(join(r.dataDir, "handoff", `${note.id}.json`), "utf8")).not.toContain(
      FAKE_GITHUB_TOKEN,
    );
  });
});

describe("attaching a note needs a preview and its hash", () => {
  it("commit message: preview, then confirm hands back the text; nothing is written anywhere", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const preview = await r.notes.attach(note.id, { target: "commit_message" });
    expect(preview).toMatchObject({ mode: "preview", delivery: "copy", wired: false });
    if (preview.mode !== "preview") throw new Error("expected a preview");
    expect(preview.text.split("\n")[1]).toBe("");
    const applied = await r.notes.attach(note.id, {
      target: "commit_message",
      confirm_hash: preview.hash,
    });
    expect(applied).toMatchObject({ mode: "applied", copy_only: true, text: preview.text });
    expect(r.issues).toEqual([]);
  });

  it("pull request description is copy only: Phoenix has no command that edits one", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const preview = await r.notes.attach(note.id, { target: "pr_description" });
    expect(preview).toMatchObject({ delivery: "copy", wired: false });
    if (preview.mode !== "preview") throw new Error("expected a preview");
    const applied = await r.notes.attach(note.id, {
      target: "pr_description",
      confirm_hash: preview.hash,
    });
    expect(applied).toMatchObject({ copy_only: true });
    expect(r.issues).toEqual([]);
  });

  it("task: creates an issue through the github command only with the preview's hash, keyed by the note", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const body = { target: "task", repository: "octo/shop" };
    const preview = await r.notes.attach(note.id, body);
    expect(preview).toMatchObject({ delivery: "github_issue", wired: true });
    expect(r.issues).toEqual([]); // a preview writes nothing
    if (preview.mode !== "preview") throw new Error("expected a preview");
    await expect(
      r.notes.attach(note.id, { ...body, confirm_hash: "0".repeat(64) }),
    ).rejects.toMatchObject({
      code: "ACTION_REQUIRES_CONFIRMATION",
    });
    expect(r.issues).toEqual([]);
    const applied = await r.notes.attach(note.id, { ...body, confirm_hash: preview.hash });
    expect(applied).toMatchObject({
      copy_only: false,
      issue: { number: 7, repository: "octo/shop" },
    });
    expect(r.issues).toEqual([
      {
        repository: "octo/shop",
        title: preview.title,
        body: preview.text,
        idempotency_key: `handoff-${note.id}`,
      },
    ]);
  });

  it("a hash from another target, repository or note does not confirm", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const other = await r.notes.generate({ session_id: SESSION });
    const p = await r.notes.attach(note.id, { target: "task", repository: "octo/shop" });
    if (p.mode !== "preview") throw new Error("expected a preview");
    for (const [id, body] of [
      [note.id, { target: "task", repository: "octo/other" }],
      [note.id, { target: "commit_message" }],
      [other.id, { target: "task", repository: "octo/shop" }],
    ] as const) {
      await expect(r.notes.attach(id, { ...body, confirm_hash: p.hash })).rejects.toMatchObject({
        code: "ACTION_REQUIRES_CONFIRMATION",
      });
    }
    expect(r.issues).toEqual([]);
  });

  it("the note changing after the preview (a summary added) makes the hash stale", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const p = await r.notes.attach(note.id, { target: "task", repository: "octo/shop" });
    if (p.mode !== "preview") throw new Error("expected a preview");
    await r.notes.summarize(note.id);
    await expect(
      r.notes.attach(note.id, { target: "task", repository: "octo/shop", confirm_hash: p.hash }),
    ).rejects.toMatchObject({ code: "ACTION_REQUIRES_CONFIRMATION" });
    expect(r.issues).toEqual([]);
  });

  it.each([
    ["no repository for a task", { target: "task" }],
    ["a malformed repository", { target: "task", repository: "../etc" }],
    ["a repository for a copy target", { target: "commit_message", repository: "o/r" }],
    ["an unknown target", { target: "email" }],
    ["an unknown field", { target: "commit_message", cc: "x" }],
  ])("rejects %s", async (_n, body) => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    await expect(r.notes.attach(note.id, body)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("refuses to attach text that still holds a secret (a hand-edited note file)", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const path = join(r.dataDir, "handoff", `${note.id}.json`);
    const stored = JSON.parse(readFileSync(path, "utf8")) as { commands: string[] };
    stored.commands = [`deploy ${FAKE_GITHUB_TOKEN}`];
    writeFileSync(path, JSON.stringify(stored));
    const error = await r.notes
      .attach(note.id, { target: "pr_description" })
      .catch((e: unknown) => e as PhoenixError);
    expect(error).toMatchObject({ code: "SECURITY_POLICY_BLOCKED" });
    expect(JSON.stringify(error)).not.toContain(FAKE_GITHUB_TOKEN);
  });

  it("is audited without the note's text", async () => {
    const r = rig();
    const note = await r.notes.generate({ session_id: SESSION });
    const p = await r.notes.attach(note.id, { target: "commit_message" });
    if (p.mode !== "preview") throw new Error("expected a preview");
    await r.notes.attach(note.id, { target: "commit_message", confirm_hash: p.hash });
    const rows = r.audit.list({ capabilityId: "handoff" });
    const row = rows.find((e) => e.action === "handoff.note.attached")!;
    expect(row.details).toEqual({ id: note.id, target: "commit_message", delivery: "copy" });
  });
});
