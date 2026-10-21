// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The launchd backstop (Phase 73), Node side: the decision, and the text of the files the install
// script writes (sudoers rule, launchd plist). All pure. Nothing here runs launchctl, sudo or any
// command. scripts/awake/install-helper.sh renders the same text in shell (`--print-sudoers`,
// `--print-plist`); test/power/scripts.test.ts executes those modes and compares them with these
// functions, so the two cannot drift. The script that launchd runs is
// helper/phoenix-awake-backstop.mjs, whose decision test/power/backstop.test.ts compares with this one.
import type { Owner, ParsedJournal, PendingEntry } from "./format";
import { ALLOWED_HELPER_LINES } from "./helper-client";

/** Privileged kinds: the only ones the backstop may undo, because only they need the sudo rule. */
export const PRIVILEGED_KINDS: readonly string[] = ["pmset.disablesleep", "pmset.lowpowermode"];
/** A pending entry older than this is undone even if its owner looks alive: sessions end by then. */
export const MAX_ENTRY_AGE_MS = 8 * 24 * 3600_000;

export type BackstopReason =
  "session_ended" | "owner_dead" | "too_old" | "running" | "not_privileged";

export interface BackstopVerdict {
  entry: PendingEntry;
  why: BackstopReason;
}

export interface BackstopDecision {
  undo: BackstopVerdict[];
  leave: BackstopVerdict[];
}

/**
 * Which pending entries the backstop undoes now. A privileged entry is undone when its session has
 * ended, its owning process is gone, or it is older than any session can be. Everything else is
 * left alone. `pidAlive` must answer true when liveness cannot be determined (never undo from a
 * guess about a process that may be running).
 */
export function backstopDecision(
  journal: ParsedJournal,
  now: number,
  pidAlive: (owner: Owner) => boolean,
): BackstopDecision {
  const undo: BackstopVerdict[] = [];
  const leave: BackstopVerdict[] = [];
  for (const entry of journal.pending) {
    if (!PRIVILEGED_KINDS.includes(entry.kind)) leave.push({ entry, why: "not_privileged" });
    else if (entry.session !== null && journal.endedSessions.has(entry.session)) {
      undo.push({ entry, why: "session_ended" });
    } else if (!pidAlive(entry.owner)) undo.push({ entry, why: "owner_dead" });
    else if (now - entry.at > MAX_ENTRY_AGE_MS) undo.push({ entry, why: "too_old" });
    else leave.push({ entry, why: "running" });
  }
  return { undo, leave };
}

export const BACKSTOP_LABEL = "dev.phoenix.awake-backstop";
export const SUDOERS_FILE_NAME = "phoenix-awake";
export const BACKSTOP_INTERVAL_SECONDS = 60;

const SUDO_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const SAFE_PATH = /^\/[A-Za-z0-9._+@%/ -]*$/;

/** The sudoers.d file: the user may run exactly the allowed command lines, without a password. */
export function renderSudoers(user: string): string {
  if (!SUDO_USER.test(user)) throw new Error("not a plain account name");
  return [
    "# Phoenix keep-awake helper (scripts/awake/install-helper.sh). Remove with uninstall-helper.sh.",
    "# Allows the user below to run EXACTLY these command lines as root, without a password.",
    "# No wildcards: sudo matches the arguments one by one, so nothing else is permitted.",
    `${user} ALL = (root) NOPASSWD: ${ALLOWED_HELPER_LINES.join(", ")}`,
    "",
  ].join("\n");
}

function xml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export interface PlistInput {
  /** Absolute path of the `node` binary that runs the script. */
  node: string;
  /** Absolute path of the installed phoenix-awake-backstop script. */
  script: string;
  /** Absolute path of the recovery journal. */
  journal: string;
  /** Absolute path of the log file launchd writes stdout and stderr to. */
  log: string;
}

/** The user-level launchd job: runs the backstop every 60 s, at load, as the user. */
export function renderLaunchdPlist(input: PlistInput): string {
  for (const path of [input.node, input.script, input.journal, input.log]) {
    if (!SAFE_PATH.test(path) || path.includes("..")) throw new Error("not a plain absolute path");
  }
  const args = [input.node, input.script, input.journal].map(
    (a) => `    <string>${xml(a)}</string>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${BACKSTOP_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args,
    "  </array>",
    "  <key>StartInterval</key>",
    `  <integer>${BACKSTOP_INTERVAL_SECONDS}</integer>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${xml(input.log)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xml(input.log)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}
