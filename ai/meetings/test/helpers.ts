// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ContextEngine } from "@phoenix/ai-context";
import {
  MemoryPipeline,
  MemoryStore,
  createDefaultPolicy,
  ownerViewer,
  type Viewer,
} from "@phoenix/ai-memory";
import {
  MeetingStore,
  openDatabase,
  type Database,
  type Summary,
  type Transcript,
} from "@phoenix/persistence";
import type { GenerateFn } from "@phoenix/ai-context";
import type { GenerateRequest, GenerateResult } from "@phoenix/ai-models";
import { MeetingItemService } from "../src";

export const NOW = new Date("2026-10-08T12:00:00.000Z");

export interface AuditRecord {
  action: string;
  details: Record<string, unknown>;
}

export interface Rig {
  db: Database;
  meetings: MeetingStore;
  memory: MemoryStore;
  pipeline: MemoryPipeline;
  engine: ContextEngine;
  service: MeetingItemService;
  audit: AuditRecord[];
  owner: Viewer;
  generate: { fn: GenerateFn | null };
  /** Creates a meeting (with transcript and summary when given) and returns its id. */
  meeting(
    externalId: string,
    parts?: { transcript?: Transcript | string; summary?: Summary; title?: string },
  ): string;
}

export interface RigOptions {
  allowSensitive?: boolean;
}

export function rig(options: RigOptions = {}): Rig {
  const db = openDatabase(":memory:");
  const meetings = new MeetingStore(db);
  let n = 0;
  const memory = new MemoryStore(db, { now: () => NOW, newId: () => `mem_${++n}` });
  const pipeline = new MemoryPipeline({
    store: memory,
    owner: "me",
    policy: createDefaultPolicy({
      isSourceEnabled: () => true,
      allowSensitive: () => options.allowSensitive ?? true,
    }),
  });
  const audit: AuditRecord[] = [];
  const generate: { fn: GenerateFn | null } = { fn: null };
  let m = 0;
  const service = new MeetingItemService({
    db,
    meetings,
    memory,
    pipeline,
    now: () => NOW,
    newId: () => `item_${++m}`,
    audit: (action, details) => audit.push({ action, details }),
    generate: () => generate.fn,
    nonce: () => "NONCE",
  });
  return {
    db,
    meetings,
    memory,
    pipeline,
    engine: new ContextEngine({ store: memory, clock: { now: () => NOW, timeZone: "UTC" } }),
    service,
    audit,
    owner: ownerViewer("me"),
    generate,
    meeting(externalId, parts = {}) {
      const meeting = meetings.upsert({
        capabilityId: "kage",
        externalId,
        status: "summarized",
        title: parts.title ?? `Meeting ${externalId}`,
        startedAt: "2026-10-07T09:00:00.000Z",
      });
      if (!meeting) throw new Error("meeting not created");
      const t = parts.transcript;
      if (t !== undefined)
        meetings.setTranscript(meeting.id, typeof t === "string" ? { text: t } : t);
      if (parts.summary) meetings.setSummary(meeting.id, parts.summary);
      return meeting.id;
    },
  };
}

/** A generate function that replies with `reply` and records the requests. */
export function scripted(
  reply: string | ((request: GenerateRequest) => string),
  model = "llama3.2",
): { fn: GenerateFn; requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  const fn: GenerateFn = (request) => {
    requests.push(request);
    const text = typeof reply === "string" ? reply : reply(request);
    const result: GenerateResult = {
      text,
      provenance: {
        provider: "ollama",
        model,
        locality: "local",
        processedBy: `Ollama · ${model} · on this device`,
      },
    };
    return Promise.resolve(result);
  };
  return { fn, requests };
}

export const reply = (...items: unknown[]): string => JSON.stringify({ items });

export const PLANNING = [
  "Maya: Let's start with the release. We decided to ship the Phoenix release on Friday.",
  "Sam: Agreed. Sam will write the migration guide by Thursday.",
  "Maya: We also decided to drop support for Node 18.",
  "Lee: I will review the security notes before the release.",
].join("\n");
