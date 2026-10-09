// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Which commits, CI runs and pull requests happened during which orchestrated agent session
// (migration 15, `agent_links`).
//
// A link says "this happened during that session", never "that session wrote it". The rules are
// deliberately narrow, and each link stores WHY it exists (rule + inputs):
//   commit   `git.commit.created` for a repository path inside the session's workspace, committed
//            at or after the session started (second granularity: git stores whole seconds) and
//            not after it ended, detected while the session was active or within a short window
//            after. Commits older than the session start are never linked: later cannot cause earlier.
//   ci_run   `github.ci.*` whose head commit is a commit already linked ('sha-match').
//   pr       `github.pr.*` whose head branch is the branch of a commit already linked
//            ('branch-match'; GitHub's PR events carry no head sha).
// If more than one session qualifies the thing is linked to NEITHER: one `ambiguous` row names the
// candidates and waits for the user (`link.resolve`).
import { realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { PhoenixEvent } from "@phoenix/protocol";
import { isRecord } from "./guards";

/** Commits detected this long after a session ended can still belong to it (git polling lag). */
export const LINK_WINDOW_AFTER_MS = 2 * 60_000;
/** Clock tolerance between the commit's timestamp and Phoenix's own clock. */
export const CLOCK_TOLERANCE_MS = 1_000;

export const LINK_KINDS = ["commit", "ci_run", "pr", "task"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type Confidence = "time+path" | "sha-match" | "branch-match" | "user" | "ambiguous";

export interface LinkView {
  id: number;
  session_id: string | null;
  kind: LinkKind;
  ref: string;
  repo: string;
  confidence: Confidence;
  source: string;
  why: Record<string, unknown>;
  detail?: Record<string, unknown>;
  /** Only for `ambiguous`: the sessions that qualified. */
  candidates?: string[];
  created_at: string;
  resolved_at?: string;
}

interface LinkRow {
  id: number;
  session_id: string | null;
  kind: LinkKind;
  ref: string;
  repo: string;
  confidence: Confidence;
  source: string;
  why: string;
  detail: string | null;
  candidates: string | null;
  created_at: number;
  resolved_at: number | null;
}

export interface NewLink {
  sessionId: string;
  kind: LinkKind;
  ref: string;
  repo: string;
  confidence: Exclude<Confidence, "ambiguous">;
  source: string;
  why: Record<string, unknown>;
  detail?: Record<string, unknown>;
}

function parseObject(text: string | null): Record<string, unknown> | undefined {
  if (text === null) return undefined;
  const value: unknown = JSON.parse(text);
  return isRecord(value) ? value : undefined;
}

function toView(row: LinkRow): LinkView {
  const detail = parseObject(row.detail);
  const candidates: unknown = row.candidates === null ? undefined : JSON.parse(row.candidates);
  return {
    id: row.id,
    session_id: row.session_id,
    kind: row.kind,
    ref: row.ref,
    repo: row.repo,
    confidence: row.confidence,
    source: row.source,
    why: parseObject(row.why) ?? {},
    ...(detail ? { detail } : {}),
    ...(Array.isArray(candidates)
      ? { candidates: candidates.filter((c): c is string => typeof c === "string") }
      : {}),
    created_at: new Date(row.created_at).toISOString(),
    ...(row.resolved_at === null ? {} : { resolved_at: new Date(row.resolved_at).toISOString() }),
  };
}

export class LinkStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
  ) {}

  /** Adds a link, or refreshes the detail of the same link (a CI run moves started → failed). */
  upsert(link: NewLink): { link: LinkView; created: boolean; changed: boolean } {
    const existing = this.db
      .prepare(
        "SELECT * FROM agent_links WHERE session_id = ? AND kind = ? AND ref = ? AND repo = ?",
      )
      .get(link.sessionId, link.kind, link.ref, link.repo) as LinkRow | undefined;
    const detail = link.detail ? JSON.stringify(link.detail) : null;
    if (existing) {
      const changed = existing.detail !== detail;
      if (changed) {
        this.db.prepare("UPDATE agent_links SET detail = ? WHERE id = ?").run(detail, existing.id);
      }
      return { link: this.byId(existing.id)!, created: false, changed };
    }
    const result = this.db
      .prepare(
        `INSERT INTO agent_links (session_id, kind, ref, repo, confidence, source, why, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        link.sessionId,
        link.kind,
        link.ref,
        link.repo,
        link.confidence,
        link.source,
        JSON.stringify(link.why),
        detail,
        this.now(),
      );
    return { link: this.byId(Number(result.lastInsertRowid))!, created: true, changed: true };
  }

  /** Records that several sessions qualified. Idempotent: one open ambiguity per thing. */
  addAmbiguous(input: {
    kind: LinkKind;
    ref: string;
    repo: string;
    source: string;
    why: Record<string, unknown>;
    candidates: string[];
  }): LinkView | undefined {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO agent_links
           (session_id, kind, ref, repo, confidence, source, why, candidates, created_at)
         VALUES (NULL, ?, ?, ?, 'ambiguous', ?, ?, ?, ?)`,
      )
      .run(
        input.kind,
        input.ref,
        input.repo,
        input.source,
        JSON.stringify(input.why),
        JSON.stringify([...input.candidates].sort()),
        this.now(),
      );
    return result.changes === 0 ? undefined : this.byId(Number(result.lastInsertRowid));
  }

  byId(id: number): LinkView | undefined {
    const row = this.db.prepare("SELECT * FROM agent_links WHERE id = ?").get(id) as
      LinkRow | undefined;
    return row ? toView(row) : undefined;
  }

  forSession(sessionId: string): LinkView[] {
    return (
      this.db
        .prepare("SELECT * FROM agent_links WHERE session_id = ? ORDER BY created_at, id")
        .all(sessionId) as unknown as LinkRow[]
    ).map(toView);
  }

  /** Open ambiguities that name this session as a candidate. */
  ambiguousFor(sessionId: string): LinkView[] {
    return this.ambiguous().filter((l) => l.candidates?.includes(sessionId));
  }

  ambiguous(): LinkView[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM agent_links WHERE confidence = 'ambiguous' AND resolved_at IS NULL ORDER BY id",
        )
        .all() as unknown as LinkRow[]
    ).map(toView);
  }

  /** Linked commits of a repository whose sha starts with `prefix` (a CI run carries 7 characters). */
  commitsByPrefix(repo: string, prefix: string): LinkView[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM agent_links WHERE kind = 'commit' AND repo = ? AND session_id IS NOT NULL
           AND substr(ref, 1, ?) = ?`,
        )
        .all(repo, prefix.length, prefix) as unknown as LinkRow[]
    ).map(toView);
  }

  /** Linked commits of a repository that were made on `branch`. */
  commitsOnBranch(repo: string, branch: string): LinkView[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM agent_links WHERE kind = 'commit' AND repo = ? AND session_id IS NOT NULL",
        )
        .all(repo) as unknown as LinkRow[]
    )
      .map(toView)
      .filter((l) => l.detail?.branch === branch);
  }

  /** The user picks the session for an ambiguous link; the link then reads confidence 'user'. */
  resolve(linkId: number, sessionId: string): LinkView {
    const link = this.byId(linkId);
    if (!link || link.confidence !== "ambiguous" || link.resolved_at !== undefined) {
      throw new Error("That link is not an open ambiguity");
    }
    if (!link.candidates?.includes(sessionId)) {
      throw new Error("That session was not one of the candidates");
    }
    const why = JSON.stringify({ ...link.why, resolved_by: "user", candidates: link.candidates });
    try {
      this.db
        .prepare(
          `UPDATE agent_links SET session_id = ?, confidence = 'user', why = ?, resolved_at = ?
           WHERE id = ?`,
        )
        .run(sessionId, why, this.now(), linkId);
    } catch {
      throw new Error("That session is already linked to this item");
    }
    return this.byId(linkId)!;
  }

  /** Forgets every link of a session, and removes it from open ambiguities (deleted when empty). */
  forgetSession(sessionId: string): { removed: number } {
    this.db.exec("BEGIN");
    try {
      let removed = Number(
        this.db.prepare("DELETE FROM agent_links WHERE session_id = ?").run(sessionId).changes,
      );
      for (const open of this.ambiguousFor(sessionId)) {
        const rest = (open.candidates ?? []).filter((c) => c !== sessionId);
        if (rest.length === 0) {
          this.db.prepare("DELETE FROM agent_links WHERE id = ?").run(open.id);
        } else {
          this.db
            .prepare("UPDATE agent_links SET candidates = ? WHERE id = ?")
            .run(JSON.stringify(rest), open.id);
        }
        removed++;
      }
      this.db.exec("COMMIT");
      return { removed };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** What the correlator knows of a session. */
export interface SessionFacts {
  id: string;
  launcher: string;
  /** Real path. */
  workspace: string;
  startedAt: number;
  endedAt?: number;
}

/** When was this commit made (ms), or undefined when that cannot be established. */
export type CommitTimeReader = (repoPath: string, sha: string) => Promise<number | undefined>;

export interface LinkNotice {
  link: LinkView;
  sessionId: string;
  /** Absent when the session is no longer held in memory (its links are still stored). */
  session: SessionFacts | undefined;
  created: boolean;
  changed: boolean;
}

export interface CorrelatorOptions {
  links: LinkStore;
  sessions: () => SessionFacts[];
  commitTime: CommitTimeReader;
  now: () => number;
  onLink: (notice: LinkNotice) => void;
  warn: (message: string, extra: Record<string, unknown>) => void;
}

const SHA = /^[0-9a-f]{7,64}$/;
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max && !/\p{Cc}/u.test(v) ? v : undefined;

/** `repo` is the folder inside `workspace` (or the workspace itself). Symlinks are resolved. */
function relation(repoPath: string, workspace: string): "same" | "inside" | undefined {
  if (!isAbsolute(repoPath)) return undefined;
  let real: string;
  try {
    real = realpathSync(repoPath);
  } catch {
    real = resolve(repoPath);
  }
  if (real === workspace) return "same";
  return real.startsWith(workspace.endsWith(sep) ? workspace : workspace + sep)
    ? "inside"
    : undefined;
}

export class Correlator {
  constructor(private readonly o: CorrelatorOptions) {}

  /** Never throws: a hostile or malformed event is simply not linked. */
  async handle(event: PhoenixEvent): Promise<void> {
    try {
      if (event.event_type === "git.commit.created") await this.commit(event);
      else if (event.event_type.startsWith("github.ci.")) this.ci(event);
      else if (event.event_type.startsWith("github.pr.")) this.pr(event);
    } catch (err) {
      this.o.warn("agent correlation failed", { event_type: event.event_type, error: String(err) });
    }
  }

  private async commit(event: PhoenixEvent): Promise<void> {
    const { payload } = event;
    const repository = str(payload.repository, 200);
    const path = str(payload.path, 2_000);
    const sha = typeof payload.sha === "string" ? payload.sha.toLowerCase() : "";
    if (!repository || !path || !SHA.test(sha)) return;
    const branch = str(payload.branch, 200);
    const detectedAt = Date.parse(event.timestamp);
    const arrival = Number.isFinite(detectedAt) ? detectedAt : this.o.now();

    // Cheap filters first (no process is started for an unrelated repository or session).
    const near = this.o
      .sessions()
      .filter((s) => arrival >= s.startedAt)
      .filter((s) => s.endedAt === undefined || arrival <= s.endedAt + LINK_WINDOW_AFTER_MS)
      .flatMap((s) => {
        const rel = relation(path, s.workspace);
        return rel ? [{ s, rel }] : [];
      });
    if (near.length === 0) return;

    const committedAt = await this.o.commitTime(path, sha);
    if (committedAt === undefined) {
      this.o.warn("commit time unknown, not linked", { repository });
      return;
    }
    const qualified = near.filter(({ s }) => {
      const startedSecond = Math.floor(s.startedAt / 1000) * 1000;
      if (committedAt < startedSecond) return false; // older than the session: never linked
      const end = s.endedAt ?? arrival;
      return committedAt <= end + CLOCK_TOLERANCE_MS;
    });
    if (qualified.length === 0) return;

    const why = (rel: "same" | "inside", s: SessionFacts): Record<string, unknown> => ({
      rule: "time+path",
      repository_path: path,
      workspace: s.workspace,
      path_relation:
        rel === "same" ? "repository is the workspace" : "repository is inside the workspace",
      committed_at: new Date(committedAt).toISOString(),
      detected_at: new Date(arrival).toISOString(),
      session_started_at: new Date(s.startedAt).toISOString(),
      session_ended_at: s.endedAt === undefined ? null : new Date(s.endedAt).toISOString(),
      meaning:
        "the commit appeared while the session was active; it does not say the agent wrote it",
    });
    if (qualified.length > 1) {
      this.o.links.addAmbiguous({
        kind: "commit",
        ref: sha,
        repo: repository,
        source: event.event_id,
        why: {
          rule: "ambiguous",
          repository_path: path,
          reason: "more than one session qualified",
          committed_at: new Date(committedAt).toISOString(),
        },
        candidates: qualified.map(({ s }) => s.id),
      });
      return;
    }
    const only = qualified[0]!;
    this.notify(
      only.s.id,
      this.o.links.upsert({
        sessionId: only.s.id,
        kind: "commit",
        ref: sha,
        repo: repository,
        confidence: "time+path",
        source: event.event_id,
        why: why(only.rel, only.s),
        detail: {
          ...(branch ? { branch } : {}),
          committed_at: new Date(committedAt).toISOString(),
        },
      }),
    );
  }

  private ci(event: PhoenixEvent): void {
    const { payload } = event;
    const repository = str(payload.repository, 200);
    const commit = typeof payload.commit === "string" ? payload.commit.toLowerCase() : "";
    const runId = payload.run_id;
    if (!repository || !SHA.test(commit) || !Number.isSafeInteger(runId)) return;
    const name = repository.split("/").pop() ?? repository;
    const linked = this.o.links.commitsByPrefix(name, commit);
    if (linked.length === 0) return;
    const sessions = [...new Set(linked.flatMap((l) => (l.session_id ? [l.session_id] : [])))];
    const shas = new Set(linked.map((l) => l.ref));
    const ref = String(runId);
    if (sessions.length > 1 || shas.size > 1) {
      this.o.links.addAmbiguous({
        kind: "ci_run",
        ref,
        repo: repository,
        source: event.event_id,
        why: { rule: "ambiguous", reason: "the commit prefix matches commits of several sessions" },
        candidates: sessions,
      });
      return;
    }
    const first = linked[0]!;
    const sessionId = first.session_id;
    if (!sessionId) return;
    const conclusion = str(payload.conclusion, 40);
    const workflow = str(payload.workflow, 120);
    const url =
      typeof payload.url === "string" && payload.url.startsWith("https://github.com/")
        ? str(payload.url, 300)
        : undefined;
    this.notify(
      sessionId,
      this.o.links.upsert({
        sessionId,
        kind: "ci_run",
        ref,
        repo: repository,
        confidence: "sha-match",
        source: event.event_id,
        why: {
          rule: "sha-match",
          commit: first.ref,
          commit_link: first.id,
          meaning: "the CI run was built from a commit linked to this session",
        },
        detail: {
          event_type: event.event_type,
          commit: first.ref,
          ...(conclusion ? { conclusion } : {}),
          ...(workflow ? { workflow } : {}),
          ...(url ? { url } : {}),
        },
      }),
    );
  }

  private pr(event: PhoenixEvent): void {
    const { payload } = event;
    const repository = str(payload.repository, 200);
    const branch = str(payload.branch, 200);
    const base = str(payload.base, 200);
    const number = payload.number;
    if (!repository || !branch || !Number.isSafeInteger(number) || branch === base) return;
    const name = repository.split("/").pop() ?? repository;
    const linked = this.o.links.commitsOnBranch(name, branch);
    if (linked.length === 0) return;
    const sessions = [...new Set(linked.flatMap((l) => (l.session_id ? [l.session_id] : [])))];
    const ref = String(number);
    if (sessions.length > 1) {
      this.o.links.addAmbiguous({
        kind: "pr",
        ref,
        repo: repository,
        source: event.event_id,
        why: { rule: "ambiguous", reason: "commits of several sessions are on the PR's branch" },
        candidates: sessions,
      });
      return;
    }
    const sessionId = sessions[0];
    if (!sessionId) return;
    this.notify(
      sessionId,
      this.o.links.upsert({
        sessionId,
        kind: "pr",
        ref,
        repo: repository,
        confidence: "branch-match",
        source: event.event_id,
        why: {
          rule: "branch-match",
          branch,
          commits: linked.map((l) => l.ref),
          meaning:
            "the PR's head branch holds a commit linked to this session (GitHub PR events carry no head sha)",
        },
        detail: { event_type: event.event_type, branch },
      }),
    );
  }

  private sessionById(id: string | null | undefined): SessionFacts | undefined {
    return this.o.sessions().find((s) => s.id === id);
  }

  private notify(
    sessionId: string,
    result: { link: LinkView; created: boolean; changed: boolean },
  ): void {
    if (result.changed) {
      this.o.onLink({ ...result, sessionId, session: this.sessionById(sessionId) });
    }
  }
}
