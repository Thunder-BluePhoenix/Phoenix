// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 31 vertical slice against a REAL running Core:
//   enable automation → post a CI-failure task → wait → print the trace
//   (stages, tool calls with their audit ids, evidence, diagnosis, proposals).
//
//   PHOENIX_DATA_DIR=/tmp/phoenix-demo PHOENIX_PORT=47831 npx tsx core/runtime/src/main.ts &
//   PHOENIX_DATA_DIR=/tmp/phoenix-demo PHOENIX_PORT=47831 \
//     npx tsx scripts/demo-vertical-slice.ts [owner/name] [run_id] [--ai]
//
// Defaults: the failed run 37145498780 of Thunder-BluePhoenix/Phoenix and this repository's own
// git history. Read-only: GitHub is only ever read; nothing is written anywhere. With --ai the
// diagnosis also asks the local Ollama model (llama3.2); without it no model is contacted.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_REPOSITORY = "Thunder-BluePhoenix/Phoenix";
const DEFAULT_RUN = 37145498780;
const TIMEOUT_MS = 180_000;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const useAi = process.argv.includes("--ai");
const repository = args[0] ?? DEFAULT_REPOSITORY;
const runId = args[1] === undefined ? DEFAULT_RUN : Number(args[1]);

const port = Number(process.env.PHOENIX_PORT ?? 7421);
const base = process.env.PHOENIX_URL ?? `http://127.0.0.1:${port}`;
const dataDir = process.env.PHOENIX_DATA_DIR ?? join(homedir(), ".phoenix", "dev");
const token = readFileSync(join(dataDir, "session.token"), "utf8").trim();

interface Json {
  [key: string]: unknown;
}

async function api(method: string, path: string, body?: unknown): Promise<Json> {
  const res = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const json = (text ? JSON.parse(text) : {}) as Json;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const say = (title: string, value?: unknown) =>
  console.log(
    value === undefined ? `\n== ${title}` : `\n== ${title}\n${JSON.stringify(value, null, 2)}`,
  );

async function main(): Promise<void> {
  // Capabilities: read-only GitHub (unauthenticated is enough for a public repo) and git over
  // the repository this script runs in. Enabling asks for their permissions as the user would.
  // Disable first so a repository chosen on a previous run is replaced, not kept.
  await api("POST", "/api/capabilities/git/disable");
  await api("POST", "/api/capabilities/git/config", {
    config: { repositories: [process.cwd()], poll_ms: 60_000 },
  });
  await api("POST", "/api/capabilities/git/enable");
  await api("POST", "/api/capabilities/github/config", { config: { repositories: [] } });
  await api("POST", "/api/capabilities/github/enable");
  if (useAi) await api("POST", "/api/ai/settings", { enabled: true });

  say("automation", await api("POST", "/api/agent/settings", { enabled: true }));
  const created = await api("POST", "/api/agent/tasks", {
    kind: "ci_failure",
    input: { repository, run_id: runId },
  });
  const task = created.task as { id: string };
  say("task accepted (202)", created.task);

  const deadline = Date.now() + TIMEOUT_MS;
  let detail: Json = {};
  for (;;) {
    detail = await api("GET", `/api/agent/tasks/${task.id}`);
    const state = (detail.run as { state: string }).state;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(state)) break;
    if (state === "WAITING_APPROVAL") {
      say("waiting for approval", (await api("GET", "/api/confirmations")).confirmations);
      console.log("(this task has read-only tools, so this should not happen)");
    }
    if (Date.now() > deadline) throw new Error(`timed out in state ${state}`);
    const tick = Promise.withResolvers<void>();
    setTimeout(tick.resolve, 500);
    await tick.promise;
  }

  const steps = detail.steps as {
    kind: string;
    name: string;
    status: string;
    policy_audit_id: number | null;
    stage_audit_id: number | null;
    decision: string | null;
    risk: string | null;
  }[];
  say("run", detail.run);
  say(
    "stages (each has an audit record)",
    steps
      .filter((s) => s.kind === "stage")
      .map((s) => `${s.name}: ${s.status} (audit #${s.stage_audit_id})`),
  );
  say(
    "tool calls (each has a policy decision + audit record)",
    steps
      .filter((s) => s.kind === "tool_call")
      .map(
        (s) =>
          `${s.name}: ${s.status}, decision ${s.decision}, risk ${s.risk}, policy audit #${s.policy_audit_id}`,
      ),
  );
  say(
    "evidence",
    (detail.evidence as { id: string; kind: string; source: string; excerpt: string }[]).map(
      (e) => `${e.id} [${e.kind}] ${e.source}: ${e.excerpt.split("\n")[0]}`,
    ),
  );
  say("diagnosis", detail.diagnosis);
  say("proposals (advisory only; nothing is executed)", detail.proposals);
  say("verification", detail.verification);
  say("ai", {
    ai_used: detail.ai_used,
    processed_by: detail.processed_by,
    model_calls: detail.model_calls,
  });
  say("audit ids", detail.audit_ids);

  const audit = (await api("GET", "/api/audit?limit=1000")).entries as {
    id: number;
    action: string;
  }[];
  const have = new Set(audit.map((a) => a.id));
  const missing = (detail.audit_ids as number[]).filter((id) => !have.has(id));
  say("audit check", { recorded: (detail.audit_ids as number[]).length, missing });
  if (missing.length > 0 || (detail.run as { state: string }).state !== "COMPLETED")
    process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
