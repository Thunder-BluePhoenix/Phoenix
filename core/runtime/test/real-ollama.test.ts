// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phases 79, 62 and 35 through a REAL in-process Core wired to a REAL local Ollama (llama3.2 only).
// Skipped unless PHOENIX_REAL_OLLAMA is set, so CI never runs it:
//   PHOENIX_REAL_OLLAMA=1 PHOENIX_EVIDENCE_OUT=/tmp/phoenix-real.json \
//     node_modules/.bin/vitest run core/runtime/test/real-ollama.test.ts --testTimeout=300000
// Every request Core makes goes through a recording fetch that REFUSES anything that is not the
// loopback Ollama or that names a `:cloud` model, so page and user text cannot leave the machine.
// The test never tunes anything to look good: it records every run (PHOENIX_EVIDENCE_OUT) and
// asserts only the guarantees the code itself claims. Model quality is recorded, not asserted.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { setImmediate } from "node:timers/promises";
import { join } from "node:path";
import { askAboutMeetings } from "@phoenix/ai-meetings";
import { generateWith } from "@phoenix/ai-context";
import type { FetchLike } from "@phoenix/ai-models";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { createEvent } from "@phoenix/protocol";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FAKE_BEARER,
  FAKE_GITHUB_TOKEN,
  FAKE_OPENAI_KEY,
} from "../../../protocol/testing/fake-secrets";
import { startCore, type TestCore } from "./helpers";

const OLLAMA = "http://127.0.0.1:11434";
const MODEL = "llama3.2";
const RUNS = 3;
const TIMEOUT_MS = 600_000;

interface Wire {
  url: string;
  model: string | null;
  body: string;
  status: number;
  ms: number;
}
const evidence: Record<string, unknown> = {};
const wire: Wire[] = [];
const refused: string[] = [];

/** Loopback Ollama only; any other host or any `:cloud` model is refused before it is sent. */
const guardedFetch: FetchLike = async (url, init) => {
  const body = typeof init?.body === "string" ? init.body : "";
  let model: string | null = null;
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    if (typeof parsed.model === "string") model = parsed.model;
  } catch {
    // not JSON (a GET probe)
  }
  if (!url.startsWith(`${OLLAMA}/`) || (model !== null && !/^llama3\.2(:latest)?$/.test(model))) {
    refused.push(`${url} model=${model}`);
    throw new TypeError("blocked by the real-Ollama test guard");
  }
  const t0 = Date.now();
  const res = await fetch(url, init);
  wire.push({ url, model, body, status: res.status, ms: Date.now() - t0 });
  return res;
};

const wireSince = (n: number): Wire[] => wire.slice(n).filter((w) => w.url.endsWith("/api/chat"));
const cleanups: (() => Promise<void> | void)[] = [];

async function boot(capabilities: CapabilityModule[] = []): Promise<TestCore> {
  const core = await startCore(
    {},
    {
      capabilities,
      secrets: new MemorySecretStore(),
      runtime: { fetch: guardedFetch },
    },
  );
  cleanups.push(() => core.runtime.stop());
  expect((await core.api("POST", "/api/ai/settings", { enabled: true })).status).toBe(200);
  return core;
}

beforeAll(async () => {
  if (!process.env.PHOENIX_REAL_OLLAMA) return;
  const version = (await (await fetch(`${OLLAMA}/api/version`)).json()) as { version: string };
  const tags = (await (await fetch(`${OLLAMA}/api/tags`)).json()) as {
    models: { name: string; digest: string; size: number }[];
  };
  const llama = tags.models.find((m) => m.name === "llama3.2:latest");
  evidence.environment = {
    date: new Date().toISOString(),
    ollama_version: version.version,
    model: llama ? { name: llama.name, digest: llama.digest, size: llama.size } : null,
    node: process.version,
  };
  expect(llama).toBeTruthy();
});

afterAll(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  evidence.refused_requests = refused;
  evidence.models_seen_on_wire = [...new Set(wire.map((w) => w.model).filter(Boolean))];
  const out = process.env.PHOENIX_EVIDENCE_OUT;
  if (out && process.env.PHOENIX_REAL_OLLAMA) writeFileSync(out, JSON.stringify(evidence, null, 2));
});

// ── Phase 79: handoff note summary ──────────────────────────────────────────────────────────

describe.skipIf(!process.env.PHOENIX_REAL_OLLAMA)(
  "phase 79: handoff note summary by a real local model",
  { timeout: TIMEOUT_MS },
  () => {
    it("writes a summary of a note built from a small synthetic session", async () => {
      // A small synthetic local repository the "agent session" worked in.
      const project = mkdtempSync(join(tmpdir(), "phoenix-real-shop-"));
      mkdirSync(join(project, "src"), { recursive: true });
      writeFileSync(
        join(project, "src", "cart.ts"),
        "export const total = (xs: number[]) => xs.length;\n",
      );
      writeFileSync(join(project, "src", "cart.test.ts"), "// tests for cart\n");
      writeFileSync(join(project, "README.md"), "# shop\n");
      execFileSync("git", ["-C", project, "init", "-q"]);

      const core = await boot();
      const session = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c12";
      const at = () => new Date().toISOString();
      const step = (over: Record<string, unknown>) =>
        core.api("POST", "/api/agent/live/step", {
          agent: "claude-code",
          session_id: session,
          project,
          at: at(),
          ...over,
        });
      await step({
        kind: "edit",
        tool: "Edit",
        target: join(project, "src/cart.ts"),
        file: { path: join(project, "src/cart.ts"), added: 12, removed: 3 },
      });
      await step({
        kind: "edit",
        tool: "Edit",
        target: join(project, "src/cart.test.ts"),
        file: { path: join(project, "src/cart.test.ts"), added: 20, removed: 0 },
      });
      await step({ kind: "run", tool: "Bash", target: "npm test" });
      // Commands that carry fake secrets: the note must mask them before any model sees the note.
      await step({
        kind: "run",
        tool: "Bash",
        target: `curl -H "Authorization: ${FAKE_BEARER}" https://api.example.test/deploy`,
      });
      await step({ kind: "run", tool: "Bash", target: `export OPENAI_API_KEY=${FAKE_OPENAI_KEY}` });
      await step({
        kind: "run",
        tool: "Bash",
        target: `git push https://x:${FAKE_GITHUB_TOKEN}@example.test/shop.git`,
      });
      core.runtime.bus.publish(
        createEvent({
          event_type: "agent.working",
          source: "agents",
          severity: "info",
          payload: {
            agent: "claude-code",
            agent_id: session,
            workspace: project,
            task: "Fix the cart total so it sums prices instead of counting items",
          },
        }),
      );
      for (let i = 0; i < 5; i++) await setImmediate();

      const made = await core.api("POST", "/api/handoff/notes", { session_id: session });
      expect(made.status).toBe(201);
      const noteText: string = made.json.text;
      const fakes = [FAKE_BEARER, FAKE_OPENAI_KEY, FAKE_GITHUB_TOKEN];
      for (const f of fakes) expect(noteText).not.toContain(f);
      expect(noteText).not.toContain(project);
      expect(made.json.summary).toBeNull();

      const runs: unknown[] = [];
      const wireStart = wire.length;
      for (let i = 1; i <= RUNS; i++) {
        const t0 = Date.now();
        const res = await core.api("POST", `/api/handoff/notes/${made.json.id}/summary`, {});
        const ms = Date.now() - t0;
        runs.push({
          run: i,
          status: res.status,
          ms,
          summary: res.json?.summary ?? null,
          error: res.status === 200 ? null : res.json,
        });
        expect(res.status, JSON.stringify(res.json)).toBe(200);
        const s = res.json.summary as {
          text: string;
          locality: string;
          model: string;
          provider: string;
          processed_by: string;
        };
        // Structural guarantees the code claims:
        for (const f of fakes) expect(s.text).not.toContain(f);
        expect(s.text.length).toBeGreaterThan(0);
        expect(s.text.length).toBeLessThanOrEqual(1_500);
        expect(s.locality).toBe("local");
        expect(s.provider).toBe("ollama");
        expect(s.model).toBe(MODEL);
        expect(s.processed_by).toMatch(/Ollama/);
        // Marked as model-written in the stored/rendered note.
        expect(res.json.text).toMatch(/## Summary \(written by .*Ollama.*; may be wrong\)/);
        expect(res.json.generated_by).toBe("rules");
      }
      const chats = wireSince(wireStart);
      for (const w of chats) for (const f of fakes) expect(w.body).not.toContain(f);
      const stored = (await core.api("GET", `/api/handoff/notes/${made.json.id}`)).json;
      evidence.phase79 = {
        note_text: noteText,
        runs,
        stored_note_text_after_last_run: stored.text,
        request_system_prompt_and_user_sent_run1: chats[0]
          ? (JSON.parse(chats[0].body) as { messages: unknown }).messages
          : null,
        chat_calls: chats.map((w) => ({ model: w.model, status: w.status, ms: w.ms })),
        fake_secrets_in_any_request_body: chats.some((w) => fakes.some((f) => w.body.includes(f))),
      };
    });
  },
);

// ── Phase 62: dropped text file answered by a real local model ──────────────────────────────

const RELEASE_NOTES = [
  "Lighthouse 2.4 release notes (draft, 14 March)",
  "",
  "Version 2.4.0 ships on 28 March. It adds offline mode for the mobile app and a new CSV export.",
  "Breaking change: the /v1/reports endpoint is removed; clients must move to /v2/reports.",
  "The migration deadline for partners is 30 April, after which /v1 returns HTTP 410.",
  "Known issue: CSV export times out for workspaces with more than 50,000 rows.",
  "Contact: release manager Ingrid Solberg.",
].join("\n");

const QUESTIONS: { q: string; expect: string }[] = [
  {
    q: "Which endpoint is removed and what must clients move to?",
    expect: "/v1/reports removed; move to /v2/reports",
  },
  { q: "What is the deadline for partners to migrate?", expect: "30 April" },
  {
    q: "What is the cost of the enterprise plan?",
    expect: "not in the file: a correct answer says so",
  },
];

describe.skipIf(!process.env.PHOENIX_REAL_OLLAMA)(
  "phase 62: a dropped text file answers a question with a real local model",
  { timeout: TIMEOUT_MS },
  () => {
    it("answers questions about a dropped .txt through the existing routes", async () => {
      const core = await boot();
      const dropped = await core.api("POST", "/api/attachments", {
        name: "release-notes.txt",
        kind: "text",
        mime: "text/plain",
        origin: "drop",
        content: RELEASE_NOTES,
      });
      expect(dropped.status).toBe(201);
      const id = dropped.json.id as string;
      const results: unknown[] = [];
      const wireStart = wire.length;
      for (const { q, expect: expected } of QUESTIONS) {
        for (let i = 1; i <= RUNS; i++) {
          const t0 = Date.now();
          const res = await core.api("POST", "/api/attachments/ask", {
            question: q,
            attachment_ids: [id],
          });
          const ms = Date.now() - t0;
          results.push({
            question: q,
            expected,
            run: i,
            status: res.status,
            ms,
            response: res.json,
          });
          expect(res.status, JSON.stringify(res.json)).toBe(200);
          expect(res.json.locality).toBe("local");
          expect(res.json.provider).toBe("ollama");
          expect(res.json.model).toBe(MODEL);
          expect(res.json.vision_model).toBeNull();
          expect((res.json.answer as string).length).toBeGreaterThan(0);
          expect(res.json.sources).toEqual([{ id, name: "release-notes.txt" }]);
        }
      }
      // The file reached the model only inside the data block of the user message.
      const chats = wireSince(wireStart);
      expect(chats.length).toBe(QUESTIONS.length * RUNS);
      for (const w of chats) {
        const messages = (JSON.parse(w.body) as { messages: { role: string; content: string }[] })
          .messages;
        expect(messages[0]!.content).not.toContain("Lighthouse");
        expect(messages[1]!.content).toContain("Lighthouse 2.4");
      }

      // An image drop: no vision model is installed or configured, so Core must refuse (409).
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      );
      const img = await core.api("POST", "/api/attachments", {
        name: "pixel.png",
        kind: "image",
        mime: "image/png",
        origin: "drop",
        content: png.toString("base64"),
      });
      const imgAsk =
        img.status === 201
          ? await core.api("POST", "/api/attachments/ask", {
              question: "what is in this image?",
              attachment_ids: [img.json.id],
            })
          : null;
      evidence.phase62 = {
        file: RELEASE_NOTES,
        results,
        chat_calls: chats.map((w) => ({ model: w.model, status: w.status, ms: w.ms })),
        image_drop: {
          attach_status: img.status,
          ask_status: imgAsk?.status ?? null,
          ask_body: imgAsk?.json ?? img.json,
        },
      };
      expect(imgAsk?.status).toBe(409);
    });
  },
);

// ── Phase 35: meeting extraction and ask with a real local model ────────────────────────────

const fakeKage: CapabilityModule = {
  manifest: {
    id: "kage",
    name: "Kage (test double)",
    version: "0.0.1",
    description: "Test double for the meeting capability",
    license: "GPL-3.0-or-later",
    events: ["kage.*"],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};

const TRANSCRIPT = [
  "Priya: Okay, let's get started. First topic is the database for the search feature.",
  "Marco: I think we should go with SQLite instead of Postgres, it is simpler to ship.",
  "Priya: Agreed. We decided to use SQLite for the search index.",
  "Dana: I will write the migration script by Friday.",
  "Priya: Good. Marco, can you update the install docs by next Wednesday?",
  "Marco: Yes, I will update the install docs by next Wednesday.",
  "Priya: Somebody needs to renew the domain name before the end of the month.",
  "Dana: Lunch is at noon, by the way.",
  "Priya: We also decided to postpone the mobile app until next quarter.",
  "Priya: Thanks everyone.",
].join("\n");

interface Item {
  id: string;
  kind: string;
  text: string;
  owner: string | null;
  due: string | null;
  status: string;
  extracted_by: string;
  evidence: { quote: string } | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

describe.skipIf(!process.env.PHOENIX_REAL_OLLAMA)(
  "phase 35: meeting extraction and ask with a real local model",
  { timeout: TIMEOUT_MS },
  () => {
    it("extracts proposals with grounded evidence and answers asks with a separate hypothesis", async () => {
      const runs: unknown[] = [];
      for (let run = 1; run <= RUNS; run++) {
        const core = await boot([fakeKage]);
        await core.runtime.capabilities.enable("kage");
        const m = core.runtime.meetings.upsert({
          capabilityId: "kage",
          externalId: `real-${run}`,
          status: "ready",
          title: "Search planning",
          startedAt: "2026-11-10T10:00:00Z",
        })!;
        core.runtime.meetings.setTranscript(m.id, { text: TRANSCRIPT });
        const wireStart = wire.length;

        const t0 = Date.now();
        const ex = await core.api("POST", `/api/meetings/${m.id}/items/extract`, {});
        const extractMs = Date.now() - t0;
        expect(ex.status, JSON.stringify(ex.json)).toBe(202);
        const listed = (await core.api("GET", `/api/meetings/${m.id}/items`)).json as {
          items: Item[];
        };
        const ai = listed.items.filter((i) => i.extracted_by.startsWith("ai:"));

        const violations: string[] = [];
        for (const i of ai) {
          if (i.status !== "proposed") violations.push(`not proposed: ${i.text}`);
          if (!i.evidence) {
            violations.push(`no evidence: ${i.text}`);
            continue;
          }
          const quote = norm(i.evidence.quote);
          if (!norm(TRANSCRIPT).includes(quote))
            violations.push(`quote not in transcript: ${quote}`);
          if (i.owner !== null) {
            const owner = norm(i.owner);
            const line = TRANSCRIPT.split("\n").find((l) => norm(l).includes(quote)) ?? "";
            const supported = quote.includes(owner) || norm(line).startsWith(`${owner}:`);
            if (!supported) violations.push(`owner unsupported: ${i.owner} for ${i.text}`);
            if (i.kind !== "action_item") violations.push(`owner on a ${i.kind}`);
          }
          if (i.due !== null && !quote.includes(norm(i.due)))
            violations.push(`due unsupported: ${i.due}`);
        }

        // The reviewer accepts every AI proposal so ask has reviewed facts to read (a user action).
        await core.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true });
        for (const i of ai) await core.api("POST", `/api/meeting-items/${i.id}/accept`, {});

        const asks: unknown[] = [];
        for (const question of [
          "What did we decide about the database?",
          "What did we decide about SQLite?",
          "What is the budget for the mobile app?",
        ]) {
          const a0 = Date.now();
          const res = await core.api("POST", "/api/meetings/ask", { question });
          asks.push({ question, ms: Date.now() - a0, status: res.status, response: res.json });
          expect(res.status, JSON.stringify(res.json)).toBe(200);
          // Consistency the view claims: an interpretation exists exactly when AI was used, it is
          // labelled with who processed it, and with no AI the reason is given. Whether the 3B model
          // produced one for a given question is RECORDED, not asserted.
          if (res.json.ai_used) {
            expect(typeof res.json.interpretation).toBe("string");
            expect(res.json.processed_by).toMatch(/Ollama/);
          } else {
            expect(res.json.interpretation).toBeNull();
            expect(typeof res.json.note).toBe("string");
          }
        }

        // The label the view cannot carry: the AI layer classifies generated text as a hypothesis.
        const { engine, viewer } = core.runtime.memory.agentContext();
        const direct = await askAboutMeetings(
          engine,
          generateWith(core.runtime.ai.service, 120_000),
          "What did we decide about SQLite?",
          viewer,
        );
        // This question matches stored facts, so a model was asked and its text must be a hypothesis.
        expect(direct.answer.facts.length).toBeGreaterThan(0);
        expect(direct.answer.interpretation).not.toBeNull();
        expect(direct.answer.interpretationClassification).toBe("hypothesis");
        expect(direct.answer.facts.every((f) => f.classification === "stored_fact")).toBe(true);

        const chats = wireSince(wireStart);
        evidence_push(runs, {
          run,
          extract_ms: extractMs,
          extract_response: ex.json,
          items: listed.items,
          violations,
          asks,
          direct_classification: direct.answer.interpretationClassification,
          direct_facts: direct.answer.facts.map((f) => ({
            ref: f.ref,
            text: f.text,
            classification: f.classification,
          })),
          chat_calls: chats.map((w) => ({ model: w.model, status: w.status, ms: w.ms })),
        });
        expect(violations, violations.join("; ")).toEqual([]);
      }
      evidence.phase35 = { transcript: TRANSCRIPT, runs };
    });
  },
);

function evidence_push(list: unknown[], row: unknown): void {
  list.push(row);
  evidence.phase35 = { transcript: TRANSCRIPT, runs: list };
}
