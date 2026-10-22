// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PhoenixEvent } from "@phoenix/protocol";
import type { Meeting } from "@phoenix/persistence";
import type { LiveSessionView } from "../../../api/src/agent-live-routes";
import { dayKeyOf, systemTimeZone } from "../recap-calendar";
import {
  cleanTitle,
  createDailyDigest,
  localGitRunner,
  readDigestCommits,
  type DailyDigest,
  type DigestSource,
  type DigestSourceId,
  type GitDigestRunner,
} from "./index";
import { eventDigestSources, meetingDigestSources, sessionDigestSources } from "./sources";

/** Rows the runtime asks the event store / meeting store for; reaching it means older rows may be missing. */
export const EVENT_WINDOW = 1_000;
export const MEETING_WINDOW = 500;

export interface DailyDigestDependencies {
  now: () => number;
  timeZone?: string;
  /** Explicitly watched local repositories only. No discovery of private files or remote APIs. */
  repositories: () => readonly string[];
  /** Local event history, newest window. A full window is reported as partial. */
  events: () => readonly PhoenixEvent[];
  /** Permission gate MUST be checked before reading sensitive meeting records. */
  meetingsAllowed: () => boolean;
  /** Newest meetings. A full window is reported as partial. */
  meetings: () => readonly Meeting[];
  sessions: () => readonly LiveSessionView[];
  /** Name the project folder in session lines. Off unless the user turned it on. */
  projectNames?: () => boolean;
  gitRunner?: GitDigestRunner;
}

/** No cloud model, network, sending, or write side effect. A source that fails is reported, never hidden. */
export class DailyDigestService {
  constructor(private readonly deps: DailyDigestDependencies) {}

  async generate(day?: string): Promise<DailyDigest> {
    const now = this.deps.now();
    const timeZone = this.deps.timeZone ?? systemTimeZone();
    const selectedDay = day ?? dayKeyOf(now, timeZone);
    const unavailable = new Set<DigestSourceId>();
    const partial = new Set<DigestSourceId>();
    const unattributed = new Set<DigestSourceId>();
    const sources: DigestSource[] = [];

    let repositories: readonly string[] = [];
    try {
      repositories = this.deps.repositories();
    } catch {
      unavailable.add("git");
    }
    const reads = await Promise.allSettled(
      repositories.map((repository) =>
        readDigestCommits(repository, selectedDay, timeZone, this.deps.gitRunner),
      ),
    );
    for (const read of reads) {
      if (read.status === "rejected") unavailable.add("git");
      else {
        sources.push(...read.value.sources);
        if (read.value.truncated) partial.add("git");
        if (!read.value.attributed) unattributed.add("git");
      }
    }

    try {
      const events = this.deps.events();
      if (events.length >= EVENT_WINDOW) partial.add("events");
      sources.push(...eventDigestSources(events));
    } catch {
      unavailable.add("events");
    }
    try {
      sources.push(
        ...sessionDigestSources(this.deps.sessions(), {
          projectNames: this.deps.projectNames?.() ?? false,
        }),
      );
    } catch {
      unavailable.add("sessions");
    }
    try {
      if (this.deps.meetingsAllowed()) {
        const meetings = this.deps.meetings();
        if (meetings.length >= MEETING_WINDOW) partial.add("meetings");
        sources.push(...meetingDigestSources(meetings));
      }
    } catch {
      unavailable.add("meetings");
    }

    return createDailyDigest({
      day: selectedDay,
      now: () => now,
      timeZone,
      sources,
      unavailable: [...unavailable],
      partial: [...partial],
      unattributed: [...unattributed],
    });
  }

  /** Resolve the same durable event currently eligible for the digest; no external URL is returned. */
  event(id: string): {
    id: string;
    title: string;
    kind: DigestSource["kind"];
    status: DigestSource["status"];
    occurredAt: string;
    verified: false;
  } | null {
    if (!/^evt_[A-Za-z0-9_-]{6,128}$/.test(id)) return null;
    const source = eventDigestSources(this.deps.events()).find(
      (candidate) => candidate.href === `#/digest/event/${id}`,
    );
    if (!source) return null;
    return {
      id,
      title: source.title,
      kind: source.kind,
      status: source.status,
      occurredAt: source.occurredAt,
      verified: false,
    };
  }

  /** Resolve only a commit in a watched repository (full 40-hex id, no path input). Author date, as in the digest. */
  async commit(sha: string): Promise<{ sha: string; title: string; occurredAt: string } | null> {
    if (!/^[a-f0-9]{40}$/.test(sha)) return null;
    const runner = this.deps.gitRunner ?? localGitRunner;
    let repositories: readonly string[];
    try {
      repositories = this.deps.repositories();
    } catch {
      return null;
    }
    for (const repository of repositories) {
      try {
        const output = await runner(repository, [
          "--no-pager",
          "-c",
          "log.showSignature=false",
          "log",
          "--no-show-signature",
          "--no-notes",
          "-1",
          "--format=%H%x00%aI%x00%s",
          "--end-of-options",
          sha,
        ]);
        const [found, occurredAt, title] = output.trim().split("\0");
        const clean = cleanTitle(title ?? "");
        if (found === sha && occurredAt && clean) return { sha, title: clean, occurredAt };
      } catch {
        /* Try the next explicitly watched repository. */
      }
    }
    return null;
  }
}
