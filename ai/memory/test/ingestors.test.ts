// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { MeetingStore, openDatabase } from "@phoenix/persistence";
import { createEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import {
  DOC_CHUNK_CHARS,
  MAX_DOC_BYTES,
  MemoryPipeline,
  buildMatchQuery,
  chunkMarkdown,
  createDefaultPolicy,
  ingestCommits,
  ingestDocs,
  ingestGitEvent,
  ingestMeetings,
  parseGitLog,
  GIT_LOG_FORMAT,
  type DocReader,
} from "../src";
import { FAKE_AWS_KEY } from "../../../protocol/testing/fake-secrets";
import { rig } from "./helpers";

describe("git ingestor", () => {
  const event = (over: Record<string, unknown> = {}) =>
    createEvent({
      event_id: "evt_1",
      event_type: "git.commit.created",
      source: "git",
      severity: "info",
      timestamp: "2026-10-08T09:00:00.000Z",
      payload: {
        repository: "phoenix",
        sha: "0123456789abcdef",
        branch: "main",
        message: "fix database lock on startup",
        ...over,
      },
    });

  it("stores a commit event as episodic git memory with its provenance", () => {
    const r = rig();
    const report = ingestGitEvent(r.pipeline, event());
    expect(report.stored).toBe(1);
    expect(r.store.list({ limit: 1 })[0]).toMatchObject({
      source: "git",
      scope: "repo:phoenix",
      layer: "episodic",
      domain: "git",
      kind: "fact",
      sensitivity: "internal",
      observedAt: "2026-10-08T09:00:00.000Z",
      provenance: {
        repository: "phoenix",
        sha: "0123456789abcdef",
        branch: "main",
        event_id: "evt_1",
      },
    });
    expect(r.store.list({ limit: 1 })[0]!.text).toContain("fix database lock on startup");
  });

  it("the same commit reported twice is one memory; other events and bad payloads are ignored", () => {
    const r = rig();
    ingestGitEvent(r.pipeline, event());
    expect(ingestGitEvent(r.pipeline, event({}))).toMatchObject({ stored: 0, duplicate: 1 });
    expect(
      ingestGitEvent(r.pipeline, { ...event(), event_type: "git.branch.changed" }).stored,
    ).toBe(0);
    expect(ingestGitEvent(r.pipeline, event({ sha: undefined })).stored).toBe(0);
    expect(r.store.count()).toBe(1);
  });

  it("redacts a token that ended up in a commit message", () => {
    const r = rig();
    ingestGitEvent(r.pipeline, event({ message: "oops ghp_abcdefghijklmnopqrstuvwxyz0123456789" }));
    expect(r.store.list({ limit: 1 })[0]!.text).not.toContain("ghp_");
  });

  it("parses git log output and skips malformed records", () => {
    const sep = "\u001f";
    const out = [
      `\u001eabcdef1234567${sep}2026-10-01T10:00:00+02:00${sep}first: with colon`,
      `\u001enot-a-sha${sep}2026-10-01T10:00:00+02:00${sep}bad`,
      `\u001e0123456789ab${sep}garbage-date${sep}bad date`,
    ].join("\n");
    expect(GIT_LOG_FORMAT).toContain("%H");
    const commits = parseGitLog("phoenix", out);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ sha: "abcdef1234567", message: "first: with colon" });
    const r = rig();
    ingestCommits(r.pipeline, commits);
    expect(ingestCommits(r.pipeline, commits)).toMatchObject({ stored: 0, duplicate: 1 });
  });
});

describe("meeting ingestor", () => {
  function meetingRig() {
    const base = rig();
    const db = openDatabase(":memory:");
    const meetings = new MeetingStore(db);
    meetings.upsert({
      capabilityId: "kage",
      externalId: "7",
      status: "ready",
      title: "Standup",
      startedAt: "2026-10-07T09:00:00.000Z",
    });
    meetings.setTranscript("kage:7", { text: "TRANSCRIPT-ONLY-WORDS zebra giraffe" });
    meetings.setSummary("kage:7", {
      text: "The team agreed to ship the Kage adapter this week.",
      decisions: ["Ship the Kage adapter", "  "],
      action_items: [{ text: "Write the docs", owner: "Ada", due: null }, "Review PR", 42, {}],
    });
    return { ...base, meetings };
  }
  const ingest = (m: ReturnType<typeof meetingRig>) =>
    ingestMeetings({
      pipeline: m.pipeline,
      store: m.store,
      meetings: m.meetings,
      capabilities: ["kage"],
    });

  it("stores summary, each decision and each action item as separate facts with meeting ids", () => {
    const m = meetingRig();
    const report = ingest(m);
    expect(report.stored).toBe(4);
    const items = m.store.list({ limit: 10 });
    expect(items.map((i) => i.text).sort()).toEqual([
      'Action item in "Standup": Review PR',
      'Action item in "Standup": Write the docs (owner: Ada)',
      'Decision in "Standup": Ship the Kage adapter',
      'Summary of "Standup": The team agreed to ship the Kage adapter this week.',
    ]);
    for (const i of items) {
      expect(i).toMatchObject({
        kind: "fact",
        domain: "meeting",
        sensitivity: "sensitive",
        scope: "meeting:kage:7",
        observedAt: "2026-10-07T09:00:00.000Z",
        provenance: { meeting_id: "kage:7" },
      });
    }
  });

  it("never stores the transcript", () => {
    const m = meetingRig();
    ingest(m);
    expect(m.store.search({ match: buildMatchQuery("zebra giraffe")!, limit: 5 })).toEqual([]);
    expect(JSON.stringify(m.store.list({ limit: 20 }))).not.toContain("TRANSCRIPT-ONLY");
  });

  it("is idempotent, and sensitive meeting data is refused without the explicit allow", () => {
    const m = meetingRig();
    ingest(m);
    expect(ingest(m)).toMatchObject({ stored: 0, duplicate: 4 });
    expect(m.store.count()).toBe(4);

    const strict = meetingRig();
    const denied = ingestMeetings({
      pipeline: new MemoryPipeline({
        store: strict.store,
        owner: "me",
        policy: createDefaultPolicy({ isSourceEnabled: () => true }),
      }),
      store: strict.store,
      meetings: strict.meetings,
      capabilities: ["kage"],
    });
    expect(denied.stored).toBe(0);
    expect(denied.refused[0]?.count).toBe(4);
    expect(strict.store.count()).toBe(0);
  });

  it("replaces items when the summary changes and removes them when the meeting is deleted", () => {
    const m = meetingRig();
    ingest(m);
    m.meetings.setSummary("kage:7", { text: "Changed plan.", decisions: [] });
    const changed = ingest(m);
    expect(changed).toMatchObject({ stored: 1, removed: 4 });
    expect(m.store.count()).toBe(1);
    expect(m.store.indexedCount()).toBe(1);

    m.meetings.delete("kage:7");
    expect(ingest(m).removed).toBe(1);
    expect(m.store.count()).toBe(0);
    expect(m.store.indexedCount()).toBe(0);
  });

  it("ignores meetings of capabilities that are not listed", () => {
    const m = meetingRig();
    m.meetings.upsert({ capabilityId: "zoom", externalId: "1", status: "ready", title: "x" });
    m.meetings.setSummary("zoom:1", { text: "zoom words" });
    ingest(m);
    expect(m.store.search({ match: buildMatchQuery("zoom")!, limit: 5 })).toEqual([]);
  });
});

describe("markdown chunking", () => {
  it("splits by heading path, ignores headings inside code fences, drops empty sections", () => {
    const md = [
      "intro line",
      "# Title",
      "## Tasks",
      "- one",
      "```sh",
      "# not a heading",
      "```",
      "## Empty",
      "## Notes",
      "text",
      "# Second",
      "body",
    ].join("\n");
    expect(chunkMarkdown(md)).toEqual([
      { heading: "", body: "intro line" },
      { heading: "Title > Tasks", body: "- one\n```sh\n# not a heading\n```" },
      { heading: "Title > Notes", body: "text" },
      { heading: "Second", body: "body" },
    ]);
  });

  it("splits an oversized section instead of truncating it", () => {
    const para = (c: string) => `${c} `.repeat(900).trim();
    const bullets = Array.from(
      { length: 80 },
      (_, i) => `- bullet number ${i} with some words`,
    ).join("\n");
    const chunks = chunkMarkdown(
      `# Big\n${para("a")}\n\n${para("b")}\n\n${para("c")}\n\n## List\n${bullets}`,
    );
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.map((c) => c.body).join(" ")).toContain("c c c");
    // Every bullet survives whole: line-aware splitting never cuts a line that fits.
    const joined = chunks
      .filter((c) => c.heading === "Big > List")
      .map((c) => c.body)
      .join("\n");
    expect(joined).toBe(bullets);
    for (const c of chunks)
      expect(c.body.length + c.heading.length).toBeLessThanOrEqual(DOC_CHUNK_CHARS);
  });
});

describe("docs ingestor", () => {
  const A = "/docs/a.md";
  const B = "/docs/b.md";

  function fakeFs(files: Record<string, string>): DocReader & {
    files: Record<string, string>;
    reads: string[];
  } {
    const reads: string[] = [];
    return {
      files,
      reads,
      async stat(path) {
        const content = files[path];
        return content === undefined
          ? null
          : { size: Buffer.byteLength(content), modifiedAt: "2026-10-01T00:00:00.000Z" };
      },
      async read(path) {
        reads.push(path);
        const content = files[path];
        if (content === undefined) throw new Error("gone");
        return content;
      },
    };
  }
  const run = (r: ReturnType<typeof rig>, reader: DocReader, paths: string[]) =>
    ingestDocs({ pipeline: r.pipeline, store: r.store, reader, paths });

  it("stores chunks with path scope, heading and content hash provenance", async () => {
    const r = rig();
    const fs = fakeFs({ [A]: "# Locks\nThe database lock is a sqlite exclusive lock.\n" });
    const report = await run(r, fs, [A]);
    expect(report.stored).toBe(1);
    expect(r.store.list({ limit: 1 })[0]).toMatchObject({
      source: "project-docs",
      scope: `path:${A}`,
      layer: "project",
      domain: "project",
      sensitivity: "internal",
      freshnessTtlDays: 30,
      provenance: { path: A, heading: "Locks" },
    });
    expect(r.store.list({ limit: 1 })[0]!.text).toContain("a.md › Locks");
  });

  it("does not re-read or re-ingest an unchanged file but still confirms it", async () => {
    const r = rig();
    const fs = fakeFs({ [A]: "# T\nbody text\n" });
    await run(r, fs, [A]);
    r.clock.now = new Date("2026-10-20T00:00:00.000Z");
    const again = await run(r, fs, [A]);
    expect(again).toMatchObject({ stored: 0, duplicate: 0, removed: 0 });
    expect(r.store.list({ limit: 1 })[0]!.lastConfirmedAt).toBe("2026-10-20T00:00:00.000Z");
  });

  it("re-ingests only changed chunks and removes chunks that disappeared", async () => {
    const r = rig();
    const fs = fakeFs({ [A]: "# One\nfirst body\n# Two\nsecond body\n" });
    await run(r, fs, [A]);
    fs.files[A] = "# One\nfirst body\n# Two\nsecond body rewritten\n# Three\nthird\n";
    const report = await run(r, fs, [A]);
    expect(report).toMatchObject({ stored: 2, duplicate: 1, removed: 1 });
    const texts = r.store.list({ limit: 10 }).map((i) => i.text);
    expect(texts.filter((t) => t.includes("second body rewritten"))).toHaveLength(1);
    expect(texts.filter((t) => /second body$/.test(t))).toEqual([]);
    expect(texts).toHaveLength(3);
    expect(r.store.indexedCount()).toBe(3);
  });

  it("removes memories of a deleted file and of a path dropped from the list", async () => {
    const r = rig();
    const fs = fakeFs({ [A]: "# A\nalpha words\n", [B]: "# B\nbeta words\n" });
    await run(r, fs, [A, B]);
    expect(r.store.count()).toBe(2);
    delete fs.files[A];
    expect(await run(r, fs, [A, B])).toMatchObject({
      removed: 1,
      skipped: [{ source: A, reason: "file not found" }],
    });
    expect(await run(r, fs, [])).toMatchObject({ removed: 1 });
    expect(r.store.count()).toBe(0);
    expect(r.store.indexedCount()).toBe(0);
    expect(r.store.sourceHash(B)).toBeNull();
  });

  it("skips oversized files, relative paths and non-markdown files, and says why", async () => {
    const r = rig();
    const fs = fakeFs({ [A]: "x".repeat(MAX_DOC_BYTES + 1), "/docs/c.txt": "text" });
    const report = await run(r, fs, [A, "docs/rel.md", "/docs/c.txt"]);
    expect(report.stored).toBe(0);
    expect(report.skipped.map((s) => s.reason)).toEqual([
      `larger than ${MAX_DOC_BYTES} bytes`,
      "path must be absolute",
      "only .md files are ingested",
    ]);
    expect(fs.reads).toEqual([]);
  });

  it("an oversized file that used to be fine loses its old memories", async () => {
    const r = rig();
    const fs = fakeFs({ [A]: "# A\nalpha words\n" });
    await run(r, fs, [A]);
    fs.files[A] = "x".repeat(MAX_DOC_BYTES + 1);
    expect(await run(r, fs, [A])).toMatchObject({ removed: 1 });
    expect(r.store.count()).toBe(0);
  });

  it("retries refused chunks next run instead of remembering the file as done", async () => {
    const r = rig();
    const fs = fakeFs({
      [A]: `# A\ntext with ${FAKE_AWS_KEY} key\n-----BEGIN PRIVATE KEY-----\n`,
    });
    const first = await run(r, fs, [A]);
    expect(first.rejected).toEqual([{ reason: "contains_private_key", count: 1 }]);
    expect(r.store.sourceHash(A)).toBeNull();
    expect((await run(r, fs, [A])).rejected).toHaveLength(1);
  });

  it("a memory the user deleted stays deleted when its file is unchanged or re-ingested", async () => {
    const r = rig();
    const fs = fakeFs({ [A]: "# A\nalpha words\n" });
    await run(r, fs, [A]);
    r.store.forget(r.store.list({ limit: 1 })[0]!.id);
    // Force a re-ingest: content changed elsewhere in the file, same chunk remains.
    fs.files[A] = "# A\nalpha words\n# B\nnew words\n";
    const report = await run(r, fs, [A]);
    expect(report).toMatchObject({ tombstoned: 1, stored: 1 });
    expect(r.store.count()).toBe(1);
  });
});
