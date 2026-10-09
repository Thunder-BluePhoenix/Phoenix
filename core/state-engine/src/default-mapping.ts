// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { MappingRule } from "./rules";

/**
 * Wording for events that do not change Fawkes' state but appear in the
 * activity feed and notifications. Same placeholders as rule explanations.
 */
export const EVENT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "system.online": "Phoenix Core started",
  "capability.registered": "{payload.name} registered",
  "capability.enabled": "{payload.name} enabled",
  "capability.disabled": "{payload.name} disabled",
  "capability.available": "{payload.name} is available",
  "capability.uninstalled": "{payload.name} uninstalled",
  "capability.command.completed": "{payload.capability}: {payload.command} completed",
  "capability.command.failed": "{payload.capability}: {payload.command} failed",
  "security.confirmation.resolved": "Request {payload.outcome}",
  "security.permission.denied": "{payload.capability} was not allowed to run {payload.command}",
  "security.kill_switch.disengaged": "Emergency stop released",
  "agent_run.cancelled": "{payload.title} was cancelled",
  "git.commit.created": "New commit in {subject}",
  "git.merge_conflict_resolved": "Merge conflict resolved in {subject}",
  "git.branch.changed": "{subject} switched to {payload.to}",
  "git.working_tree.dirty": "Uncommitted changes in {subject}",
  "git.working_tree.clean": "Working tree clean in {subject}",
  "frappe.site.healthy": "Site {subject} is healthy again",
  "kage.connected": "Connected to Kage",
  "kage.meeting.archived": "Meeting archived",
  "kage.capture.finished": "Meeting capture finished; Kage is uploading it",
};

const MIN = 60_000;

/**
 * Default event → state mapping (Full System PRD v2.0, Appendix A).
 * Capabilities add their own rules through the capability manager (Phase 12).
 */
export const DEFAULT_MAPPING: readonly MappingRule[] = [
  // Build & test
  {
    match: "build.started",
    effect: { state: "WORKING", explain: "Build running ({source})", timeoutMs: 30 * MIN },
  },
  { match: "build.progress", effect: { heartbeat: true } },
  { match: "build.passed", effect: { state: "SUCCESS", explain: "Build passed", ttlMs: 5_000 } },
  { match: "build.failed", effect: { state: "ERROR", explain: "Build failed ({source})" } },
  {
    match: "test.started",
    effect: { state: "WORKING", explain: "Tests running", timeoutMs: 30 * MIN },
  },
  { match: "test.passed", effect: { state: "SUCCESS", explain: "Tests passed", ttlMs: 5_000 } },
  { match: "test.failed", effect: { state: "ERROR", explain: "Tests failed" } },

  // Terminal commands
  {
    match: "command.started",
    effect: { state: "WORKING", explain: "Running {payload.command}", timeoutMs: 30 * MIN },
  },
  {
    match: "command.completed",
    effect: { state: "SUCCESS", explain: "Finished {payload.command}", ttlMs: 3_000 },
  },
  {
    match: "command.failed",
    effect: { state: "ERROR", explain: "Command failed: {payload.command}" },
  },

  // Coding agents
  {
    match: "agent.started",
    effect: { state: "THINKING", explain: "{payload.agent} is working", timeoutMs: 60 * MIN },
  },
  {
    match: "agent.working",
    effect: { state: "WORKING", explain: "{payload.agent} is working", timeoutMs: 60 * MIN },
  },
  {
    match: "agent.waiting",
    effect: { state: "WAITING", explain: "{payload.agent} needs your input" },
  },
  {
    match: "agent.completed",
    effect: { state: "SUCCESS", explain: "{payload.agent} finished", ttlMs: 5_000 },
  },
  { match: "agent.failed", effect: { state: "ERROR", explain: "{payload.agent} failed" } },

  // Fawkes agent runs (Phase 31). One correlation id per run, so each event replaces the last.
  {
    match: "agent_run.started",
    effect: { state: "THINKING", explain: "{payload.title}", timeoutMs: 30 * MIN },
  },
  {
    match: "agent_run.thinking",
    effect: { state: "THINKING", explain: "{payload.title}", timeoutMs: 30 * MIN },
  },
  {
    match: "agent_run.waiting",
    effect: { state: "WAITING", explain: "Approval needed: {payload.title}" },
  },
  {
    match: "agent_run.completed",
    effect: { state: "SUCCESS", explain: "{payload.title}: done", ttlMs: 8_000 },
  },
  { match: "agent_run.failed", effect: { state: "ERROR", explain: "{payload.title} failed" } },
  { match: "agent_run.cancelled", effect: { clear: true } },

  // Deployments
  {
    match: "deploy.started",
    effect: {
      state: "DEPLOYING",
      explain: "Deploying to {payload.environment}",
      timeoutMs: 60 * MIN,
    },
  },
  { match: "deploy.progress", effect: { heartbeat: true } },
  {
    match: "deploy.succeeded",
    effect: { state: "SUCCESS", explain: "Deployed to {payload.environment}", ttlMs: 8_000 },
  },
  {
    match: "deploy.failed",
    effect: { state: "ERROR", explain: "Deployment to {payload.environment} failed" },
  },

  // Kage meetings (correlation_id = meeting_id ties these together)
  {
    match: "kage.meeting.started",
    effect: { state: "WORKING", explain: "Starting meeting capture", timeoutMs: 5 * MIN },
  },
  // No timeout: a recording indicator must never silently disappear.
  { match: "kage.meeting.recording", effect: { state: "RECORDING", explain: "Recording meeting" } },
  {
    match: "kage.meeting.ended",
    effect: { state: "WORKING", explain: "Processing meeting", timeoutMs: 120 * MIN },
  },
  {
    match: "kage.transcription.started",
    effect: { state: "WORKING", explain: "Transcribing meeting", timeoutMs: 120 * MIN },
  },
  {
    match: "kage.transcription.completed",
    effect: { state: "WORKING", explain: "Transcript ready", timeoutMs: 120 * MIN },
  },
  {
    match: "kage.summary.started",
    effect: { state: "THINKING", explain: "Summarising meeting", timeoutMs: 60 * MIN },
  },
  {
    match: "kage.summary.ready",
    effect: { state: "SUCCESS", explain: "Meeting summary ready", ttlMs: 10_000 },
  },
  { match: "kage.meeting.archived", effect: { clear: true } },
  {
    match: "kage.meeting.failed",
    effect: { state: "ERROR", explain: "Meeting processing failed" },
  },

  // Frappe
  {
    match: "frappe.site.unhealthy",
    effect: { state: "ERROR", explain: "Site {subject} is unhealthy" },
  },
  { match: "frappe.site.healthy", effect: { clear: true } },

  // Git
  {
    match: "git.merge_conflict",
    group: "git.merge",
    effect: { state: "WARNING", explain: "Merge conflict in {subject}" },
  },
  { match: "git.merge_conflict_resolved", group: "git.merge", effect: { clear: true } },

  // Security (Phase 11). Confirmation requests carry requires_action → WAITING.
  {
    match: "security.confirmation.requested",
    effect: { state: "WAITING", explain: "Approval needed: {payload.summary}" },
  },
  { match: "security.confirmation.resolved", effect: { clear: true } },
  {
    match: "security.kill_switch.engaged",
    group: "security.kill",
    effect: { state: "WARNING", explain: "Emergency stop: all capabilities are blocked" },
  },
  { match: "security.kill_switch.disengaged", group: "security.kill", effect: { clear: true } },

  // Capability health
  {
    match: "capability.unavailable",
    effect: { state: "WARNING", explain: "{payload.name} is unavailable" },
  },
  {
    match: "capability.failed",
    effect: { state: "ERROR", explain: "{payload.name} failed to start" },
  },
  { match: "capability.available", effect: { clear: true } },
  { match: "capability.enabled", effect: { clear: true } },
  { match: "capability.disabled", effect: { clear: true } },
  { match: "capability.uninstalled", effect: { clear: true } },
];
