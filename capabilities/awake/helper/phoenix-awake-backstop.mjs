// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// phoenix-awake-backstop (Phase 73): the launchd safety net. launchd runs it every 60 seconds as
// the USER (never root). It reads Phoenix's recovery journal and, for a privileged change that is
// still applied but whose session ended or whose owning Phoenix process is gone, runs the undo
// through the same sudoers rule Phoenix uses: `sudo -n /usr/bin/pmset -a <setting> <value>`.
//
// Safety properties (all covered by test/power/backstop.test.ts, which never runs this as a
// process and never runs sudo):
//   - Only the four literal command lines in ALLOWED are ever run, whatever the journal says. The
//     journal is a user-writable file; a tampered undo entry cannot make this run anything else.
//   - Only well-formed, checksum-correct lines are acted on. A bad line is skipped and counted.
//   - It undoes (and records `undone`) one entry at a time; a failing command leaves the entry
//     pending for the next minute's run.
//   - If the lock file is fresh, another reconcile is running: it does nothing this minute.
//
// This file is self-contained on purpose: it is copied to ~/Library/Application Support/Phoenix/
// and must not import anything from the repository. Its journal format, allow-list and decision
// are kept identical to src/power/{format,helper-client,backstop}.ts by those tests.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PMSET = "/usr/bin/pmset";
export const SUDO = "/usr/bin/sudo";
export const ALLOWED = [
  [PMSET, "-a", "disablesleep", "1"],
  [PMSET, "-a", "disablesleep", "0"],
  [PMSET, "-a", "lowpowermode", "1"],
  [PMSET, "-a", "lowpowermode", "0"],
];
/** Kinds this script may undo: exactly the privileged ones. */
export const PRIVILEGED_KINDS = ["pmset.disablesleep", "pmset.lowpowermode"];
export const STALE_LOCK_MS = 10 * 60_000;
/** A lock file dated further ahead of the clock than this is forged or from a broken clock: stale. */
export const MAX_LOCK_SKEW_MS = 60_000;
/** A pending entry this old is undone even if its owner looks alive: a session never lasts longer. */
export const MAX_ENTRY_AGE_MS = 8 * 24 * 3600_000;
const JOURNAL_VERSION = 1;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const idText = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const epoch = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function checksum(recText) {
  return createHash("sha256").update(recText).digest("hex").slice(0, 32);
}

export function encodeLine(rec) {
  const body = JSON.stringify(rec);
  return `${JSON.stringify({ v: JOURNAL_VERSION, sum: checksum(body), rec })}\n`;
}

function ownerOf(v) {
  if (!isObject(v)) return undefined;
  const { pid, started } = v;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return undefined;
  if (typeof started !== "string" || started.length > 80) return undefined;
  return { pid, started };
}

export function validateRecord(value) {
  if (!isObject(value) || !epoch(value.at)) return undefined;
  const { t, id, at } = value;
  switch (t) {
    case "change": {
      const owner = ownerOf(value.owner);
      const session = value.session;
      if (
        !idText(id, 80) ||
        !idText(value.kind, 64) ||
        !/^[a-z][a-z0-9_.]{0,63}$/.test(value.kind)
      ) {
        return undefined;
      }
      if (!isObject(value.apply) || !isObject(value.undo) || !owner) return undefined;
      if (session !== null && !idText(session, 80)) return undefined;
      return { t, id, kind: value.kind, apply: value.apply, undo: value.undo, at, session, owner };
    }
    case "applied":
    case "undone":
      return idText(id, 80) ? { t, id, at } : undefined;
    case "undo_failed":
      if (!idText(id, 80) || typeof value.error !== "string") return undefined;
      return { t, id, at, error: value.error.slice(0, 200) };
    case "session_end":
      return idText(value.session, 80) ? { t, session: value.session, at } : undefined;
    default:
      return undefined;
  }
}

export function decodeLine(line) {
  let outer;
  try {
    outer = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(outer) || outer.v !== JOURNAL_VERSION || typeof outer.sum !== "string")
    return undefined;
  if (checksum(JSON.stringify(outer.rec)) !== outer.sum) return undefined;
  return validateRecord(outer.rec);
}

export function parseJournal(source) {
  const changes = new Map();
  const undone = new Set();
  const applied = new Set();
  const endedSessions = new Set();
  let untrusted = 0;
  let partialTail = false;
  const lines = source.split("\n");
  const tail = lines.pop() ?? "";
  const fold = (rec) => {
    if (rec.t === "change") {
      if (!changes.has(rec.id)) changes.set(rec.id, { ...rec, applied: false });
    } else if (rec.t === "applied") applied.add(rec.id);
    else if (rec.t === "undone") undone.add(rec.id);
    else if (rec.t === "session_end") endedSessions.add(rec.session);
  };
  for (const line of lines) {
    if (line.trim() === "") continue;
    const rec = decodeLine(line);
    if (rec) fold(rec);
    else untrusted += 1;
  }
  if (tail.trim() !== "") {
    const rec = decodeLine(tail);
    if (rec) fold(rec);
    else partialTail = true;
  }
  const pending = [];
  for (const entry of changes.values()) {
    if (!undone.has(entry.id)) pending.push({ ...entry, applied: applied.has(entry.id) });
  }
  return { pending, endedSessions, untrusted, partialTail };
}

/** The literal allowed entry for this argv, or undefined. No normalisation. */
export function allowedArgv(argv) {
  if (!Array.isArray(argv)) return undefined;
  return ALLOWED.find((a) => a.length === argv.length && a.every((part, i) => part === argv[i]));
}

/**
 * Which pending privileged entries to undo now, and why. `pidAlive(owner)` is synchronous here (the
 * caller resolves liveness first). Entries of other kinds are never touched.
 */
export function backstopDecision(journal, now, pidAlive) {
  const undo = [];
  const leave = [];
  for (const entry of journal.pending) {
    if (!PRIVILEGED_KINDS.includes(entry.kind)) {
      leave.push({ entry, why: "not_privileged" });
    } else if (entry.session !== null && journal.endedSessions.has(entry.session)) {
      undo.push({ entry, why: "session_ended" });
    } else if (!pidAlive(entry.owner)) {
      undo.push({ entry, why: "owner_dead" });
    } else if (now - entry.at > MAX_ENTRY_AGE_MS) {
      undo.push({ entry, why: "too_old" });
    } else {
      leave.push({ entry, why: "running" });
    }
  }
  return { undo, leave };
}

/** The start time of a pid as `ps -o lstart=` prints it: "" when it is not running. */
async function startOf(runFile, pid) {
  // Zone and locale pinned: `lstart` is printed in local time, and a zone change must not turn a live owner into a stranger.
  const r = await runFile("/usr/bin/env", [
    "TZ=UTC",
    "LC_ALL=C",
    "/bin/ps",
    "-o",
    "lstart=",
    "-p",
    String(pid),
  ]);
  if (r.code === null) return undefined;
  return r.code === 0 ? r.stdout.trim() : "";
}

/**
 * One run. Every effect is injected so tests drive it with fakes:
 *   deps.readFile(path) -> string | undefined    deps.appendFile(path, text)
 *   deps.runFile(file, args) -> {code, stdout}   deps.now()
 *   deps.lock: { acquire(): Promise<boolean>, release(): void }
 */
export async function runBackstop(journalPath, deps) {
  const report = { undone: [], failed: [], skipped: 0, locked: false, untrusted: 0 };
  if (!(await deps.lock.acquire())) {
    report.locked = true;
    return report;
  }
  try {
    const journal = parseJournal(deps.readFile(journalPath) ?? "");
    report.untrusted = journal.untrusted;
    const alive = new Map();
    for (const entry of journal.pending) {
      const started = await startOf(deps.runFile, entry.owner.pid);
      // `ps` that cannot run answers "alive": never undo from a guess.
      alive.set(
        entry.id,
        started === undefined ||
          (started !== "" && (entry.owner.started === "" || entry.owner.started === started)),
      );
    }
    const decision = backstopDecision(journal, deps.now(), (owner) => {
      const hit = journal.pending.find((e) => e.owner === owner);
      return hit ? (alive.get(hit.id) ?? true) : true;
    });
    report.skipped = decision.leave.length;
    for (const { entry } of decision.undo) {
      // An undo must be the OFF line of the entry's OWN setting: an allowed "... 1" line is not an undo.
      const argv = allowedArgv(entry.undo.argv);
      const setting = entry.kind === "pmset.disablesleep" ? "disablesleep" : "lowpowermode";
      if (!argv || argv[2] !== setting || argv[3] !== "0") {
        report.failed.push({ id: entry.id, error: "undo is not the allowed off command" });
        continue;
      }
      const r = await deps.runFile(SUDO, ["-n", ...argv]);
      if (r.code === 0) {
        deps.appendFile(journalPath, encodeLine({ t: "undone", id: entry.id, at: deps.now() }));
        report.undone.push(entry.id);
      } else {
        deps.appendFile(
          journalPath,
          encodeLine({ t: "undo_failed", id: entry.id, at: deps.now(), error: `exit ${r.code}` }),
        );
        report.failed.push({ id: entry.id, error: `exit ${r.code}` });
      }
    }
  } finally {
    deps.lock.release();
  }
  return report;
}

// ── the real thing: only reached when launchd (or a person) runs the file ────────────────────

function realRunFile(file, args) {
  return execFileAsync(file, args, { timeout: 20_000 }).then(
    (r) => ({ code: 0, stdout: String(r.stdout) }),
    (err) => ({ code: typeof err.code === "number" ? err.code : null, stdout: "" }),
  );
}

export function realLock(path, now = () => Date.now()) {
  let held = false;
  return {
    async acquire() {
      try {
        const age = now() - statSync(path).mtimeMs;
        // Fresh: another run is working. Older than STALE_LOCK_MS, or dated in the future, is stale.
        if (age >= -MAX_LOCK_SKEW_MS && age < STALE_LOCK_MS) return false;
        rmSync(path, { force: true });
      } catch {
        // no lock file
      }
      try {
        const fd = openSync(path, "wx", 0o600);
        writeSync(fd, JSON.stringify({ pid: process.pid, at: now() }));
        closeSync(fd);
        held = true;
        return true;
      } catch {
        return false;
      }
    },
    release() {
      if (held) rmSync(path, { force: true });
      held = false;
    },
  };
}

async function main(argv) {
  const journalPath = argv[2];
  if (typeof journalPath !== "string" || !journalPath.startsWith("/")) {
    process.stderr.write("usage: phoenix-awake-backstop <absolute journal path>\n");
    return 2;
  }
  const report = await runBackstop(journalPath, {
    readFile(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    appendFile(path, text) {
      const fd = openSync(path, "a", 0o600);
      try {
        writeSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    runFile: realRunFile,
    now: () => Date.now(),
    lock: realLock(`${journalPath}.backstop-lock`),
  });
  if (report.undone.length > 0 || report.failed.length > 0) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
  return report.failed.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => process.exit(code));
}
