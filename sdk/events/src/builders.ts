// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Typed builders for the well-known event types Fawkes understands
// (Full System PRD v2.0 Appendix A). Builders return events without a
// `source`; Phoenix fills it in with the emitting capability's id.
import { createEvent, type NewEvent, type PhoenixEvent, type Severity } from "@phoenix/protocol";

export type EventInput = Omit<NewEvent, "source">;

interface Extra {
  correlation_id?: string;
  subject?: string;
  payload?: Record<string, unknown>;
}

function ev(
  event_type: string,
  severity: Severity,
  payload: Record<string, unknown>,
  extra: Extra = {},
): EventInput {
  return {
    event_type,
    severity,
    ...(extra.correlation_id ? { correlation_id: extra.correlation_id } : {}),
    ...(extra.subject ? { subject: extra.subject } : {}),
    payload: { ...payload, ...extra.payload },
  };
}

export const build = {
  started: (command?: string, x?: Extra) =>
    ev("build.started", "info", command ? { command } : {}, x),
  progress: (progress: number, x?: Extra) => ev("build.progress", "info", { progress }, x),
  passed: (x?: Extra) => ev("build.passed", "success", {}, x),
  failed: (reason?: string, x?: Extra) => ev("build.failed", "error", reason ? { reason } : {}, x),
};

export const test = {
  started: (x?: Extra) => ev("test.started", "info", {}, x),
  passed: (x?: Extra) => ev("test.passed", "success", {}, x),
  failed: (failures?: number, x?: Extra) =>
    ev("test.failed", "error", failures !== undefined ? { failures } : {}, x),
};

export const command = {
  started: (cmd: string, x?: Extra) => ev("command.started", "info", { command: cmd }, x),
  completed: (cmd: string, x?: Extra) => ev("command.completed", "success", { command: cmd }, x),
  failed: (cmd: string, exitCode: number, x?: Extra) =>
    ev("command.failed", "error", { command: cmd, exit_code: exitCode }, x),
};

export const agent = {
  started: (name: string, x?: Extra) => ev("agent.started", "info", { agent: name }, x),
  working: (name: string, x?: Extra) => ev("agent.working", "info", { agent: name }, x),
  waiting: (name: string, prompt?: string, x?: Extra) => ({
    ...ev("agent.waiting", "warning", { agent: name, ...(prompt ? { prompt } : {}) }, x),
    requires_action: true,
  }),
  completed: (name: string, x?: Extra) => ev("agent.completed", "success", { agent: name }, x),
  failed: (name: string, x?: Extra) => ev("agent.failed", "error", { agent: name }, x),
};

export const deploy = {
  started: (environment: string, x?: Extra) => ev("deploy.started", "info", { environment }, x),
  progress: (progress: number, x?: Extra) => ev("deploy.progress", "info", { progress }, x),
  succeeded: (environment: string, x?: Extra) =>
    ev("deploy.succeeded", "success", { environment }, x),
  failed: (environment: string, x?: Extra) => ev("deploy.failed", "error", { environment }, x),
};

export const git = {
  commitCreated: (repository: string, sha: string, x?: Extra) =>
    ev("git.commit.created", "info", { repository, sha }, { subject: repository, ...x }),
  mergeConflict: (repository: string, x?: Extra) =>
    ev("git.merge_conflict", "warning", { repository }, { subject: repository, ...x }),
  mergeConflictResolved: (repository: string, x?: Extra) =>
    ev("git.merge_conflict_resolved", "success", { repository }, { subject: repository, ...x }),
};

/** Kage meeting lifecycle; all events share correlation_id = meeting id. */
export const kage = {
  connected: () => ev("kage.connected", "info", {}),
  meetingStarted: (meetingId: string, title?: string) =>
    ev(
      "kage.meeting.started",
      "info",
      { meeting_id: meetingId, ...(title ? { title } : {}) },
      { correlation_id: meetingId },
    ),
  recording: (meetingId: string) =>
    ev("kage.meeting.recording", "info", { meeting_id: meetingId }, { correlation_id: meetingId }),
  ended: (meetingId: string) =>
    ev("kage.meeting.ended", "info", { meeting_id: meetingId }, { correlation_id: meetingId }),
  transcriptionStarted: (meetingId: string) =>
    ev(
      "kage.transcription.started",
      "info",
      { meeting_id: meetingId },
      { correlation_id: meetingId },
    ),
  transcriptionCompleted: (meetingId: string) =>
    ev(
      "kage.transcription.completed",
      "success",
      { meeting_id: meetingId },
      { correlation_id: meetingId },
    ),
  summaryStarted: (meetingId: string) =>
    ev("kage.summary.started", "info", { meeting_id: meetingId }, { correlation_id: meetingId }),
  summaryReady: (meetingId: string, summaryId: string) =>
    ev(
      "kage.summary.ready",
      "success",
      { meeting_id: meetingId, summary_id: summaryId },
      { correlation_id: meetingId },
    ),
  failed: (meetingId: string, reason?: string) =>
    ev(
      "kage.meeting.failed",
      "error",
      { meeting_id: meetingId, ...(reason ? { reason } : {}) },
      { correlation_id: meetingId },
    ),
};

export const frappe = {
  siteUnhealthy: (site: string) =>
    ev("frappe.site.unhealthy", "error", { site }, { subject: site }),
  siteHealthy: (site: string) => ev("frappe.site.healthy", "success", { site }, { subject: site }),
};

/** Completes an event input into a full envelope for a given source. */
export function withSource(source: string, input: EventInput): PhoenixEvent {
  return createEvent({ ...input, source } as NewEvent);
}
