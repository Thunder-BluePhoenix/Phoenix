// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The launchd backstop. The script is imported as a module and driven with fakes: it is never
// started as a process, and no sudo, launchctl or pmset ever runs.
import { describe, expect, it } from "vitest";
// @ts-expect-error the helper is plain ESM JavaScript, installed on its own
import * as script from "../../helper/phoenix-awake-backstop.mjs";
import { backstopDecision, MAX_ENTRY_AGE_MS, PRIVILEGED_KINDS } from "../../src/power/backstop";
import { encodeLine, parseJournal, type JournalRecord, type Owner } from "../../src/power/format";
import { ALLOWED_HELPER_ARGV } from "../../src/power/helper-client";

const NOW = 10 * 24 * 3600_000;
const OWNER: Owner = { pid: 100, started: "start-100" };
const change = (
  id: string,
  over: Partial<Extract<JournalRecord, { t: "change" }>> = {},
): JournalRecord => ({
  t: "change",
  id,
  kind: "pmset.disablesleep",
  apply: { argv: [...ALLOWED_HELPER_ARGV[0]!] },
  undo: { argv: [...ALLOWED_HELPER_ARGV[1]!] },
  at: NOW - 1000,
  session: "awk_1",
  owner: OWNER,
  ...over,
});
const journalOf = (...recs: JournalRecord[]) => parseJournal(recs.map(encodeLine).join(""));

describe("backstopDecision", () => {
  it("undoes an entry whose session ended, even if its owner is alive", () => {
    const j = journalOf(change("c1"), { t: "session_end", session: "awk_1", at: NOW - 10 });
    const d = backstopDecision(j, NOW, () => true);
    expect(d.undo.map((v) => [v.entry.id, v.why])).toEqual([["c1", "session_ended"]]);
  });

  it("undoes an entry whose owner process is dead", () => {
    const d = backstopDecision(journalOf(change("c1")), NOW, () => false);
    expect(d.undo.map((v) => v.why)).toEqual(["owner_dead"]);
  });

  it("leaves an entry alone while its session runs and its owner lives", () => {
    const d = backstopDecision(journalOf(change("c1")), NOW, () => true);
    expect(d.undo).toEqual([]);
    expect(d.leave.map((v) => v.why)).toEqual(["running"]);
  });

  it("undoes an entry older than any session can be, even if the pid looks alive", () => {
    const d = backstopDecision(
      journalOf(change("c1", { at: NOW - MAX_ENTRY_AGE_MS - 1 })),
      NOW,
      () => true,
    );
    expect(d.undo.map((v) => v.why)).toEqual(["too_old"]);
  });

  it("never touches a kind that is not privileged (it could not undo it through sudo anyway)", () => {
    const j = journalOf(change("c1", { kind: "lid.mute" }), {
      t: "session_end",
      session: "awk_1",
      at: 1,
    });
    const d = backstopDecision(j, NOW, () => false);
    expect(d.undo).toEqual([]);
    expect(d.leave.map((v) => v.why)).toEqual(["not_privileged"]);
  });

  it("an entry with no session is judged by its owner alone", () => {
    expect(
      backstopDecision(journalOf(change("c1", { session: null })), NOW, () => false).undo,
    ).toHaveLength(1);
    expect(
      backstopDecision(journalOf(change("c1", { session: null })), NOW, () => true).undo,
    ).toHaveLength(0);
  });

  it("an already undone entry is not pending, so it is never undone again", () => {
    const j = journalOf(change("c1"), { t: "undone", id: "c1", at: 2 });
    expect(backstopDecision(j, NOW, () => false).undo).toEqual([]);
  });

  it("the privileged kinds are exactly the two pmset kinds", () => {
    expect([...PRIVILEGED_KINDS]).toEqual(["pmset.disablesleep", "pmset.lowpowermode"]);
  });
});

describe("the installed script stays in step with the TypeScript module", () => {
  it("has the same allow-list and privileged kinds", () => {
    expect(script.ALLOWED).toEqual(ALLOWED_HELPER_ARGV.map((a) => [...a]));
    expect(script.PRIVILEGED_KINDS).toEqual([...PRIVILEGED_KINDS]);
    expect(script.MAX_ENTRY_AGE_MS).toBe(MAX_ENTRY_AGE_MS);
  });

  it("reads and writes the same journal bytes", () => {
    const rec = change("c1");
    expect(script.encodeLine(rec)).toBe(encodeLine(rec));
    const text =
      [rec, { t: "applied", id: "c1", at: 3 } as JournalRecord].map(encodeLine).join("") + "junk\n";
    const mine = parseJournal(text);
    const theirs = script.parseJournal(text);
    expect(theirs.untrusted).toBe(mine.untrusted);
    expect(theirs.pending).toEqual(mine.pending);
  });

  it("decides the same way on a table of cases", () => {
    const cases: [JournalRecord[], boolean][] = [
      [[change("c1")], true],
      [[change("c1")], false],
      [[change("c1"), { t: "session_end", session: "awk_1", at: 1 }], true],
      [[change("c1", { kind: "lid.mute" })], false],
      [[change("c1", { at: 1 })], true],
    ];
    for (const [recs, alive] of cases) {
      const j = journalOf(...recs);
      const mine = backstopDecision(j, NOW, () => alive).undo.map((v) => [v.entry.id, v.why]);
      const theirs = script
        .backstopDecision(j, NOW, () => alive)
        .undo.map((v: { entry: { id: string }; why: string }) => [v.entry.id, v.why]);
      expect(theirs).toEqual(mine);
    }
  });
});

interface Fake {
  files: Map<string, string>;
  ran: string[];
  failSudo: boolean;
  alive: Set<number>;
  lockHeld: boolean;
  released: number;
}

interface ScriptResult {
  code: number | null;
  stdout: string;
}

function deps(f: Fake) {
  return {
    readFile: (p: string) => f.files.get(p),
    appendFile: (p: string, t: string) => void f.files.set(p, (f.files.get(p) ?? "") + t),
    runFile: (file: string, args: string[]): Promise<ScriptResult> => {
      f.ran.push([file, ...args].join(" "));
      if (file === "/bin/ps") {
        const pid = Number(args[3]);
        return Promise.resolve(
          f.alive.has(pid) ? { code: 0, stdout: `start-${pid}\n` } : { code: 1, stdout: "" },
        );
      }
      return Promise.resolve({ code: f.failSudo ? 1 : 0, stdout: "" });
    },
    now: () => NOW,
    lock: {
      acquire: () => Promise.resolve(!f.lockHeld),
      release: () => void (f.released += 1),
    },
  };
}

const J = "/data/awake/recovery-journal.jsonl";
const fake = (recs: JournalRecord[]): Fake => ({
  files: new Map([[J, recs.map(encodeLine).join("")]]),
  ran: [],
  failSudo: false,
  alive: new Set(),
  lockHeld: false,
  released: 0,
});

describe("runBackstop", () => {
  it("undoes a dead owner's disablesleep through the sudo rule, once, and records it", async () => {
    const f = fake([change("c1")]);
    const report = await script.runBackstop(J, deps(f));
    expect(report.undone).toEqual(["c1"]);
    expect(f.ran.filter((c) => c.startsWith("/usr/bin/sudo"))).toEqual([
      "/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0",
    ]);
    expect(parseJournal(f.files.get(J) ?? "").pending).toEqual([]);
    // The next minute finds nothing to do.
    f.ran.length = 0;
    await script.runBackstop(J, deps(f));
    expect(f.ran.filter((c) => c.startsWith("/usr/bin/sudo"))).toEqual([]);
    expect(f.released).toBe(2);
  });

  it("does nothing while the owner is alive and the session has not ended", async () => {
    const f = fake([change("c1")]);
    f.alive.add(100);
    const report = await script.runBackstop(J, deps(f));
    expect(report.undone).toEqual([]);
    expect(f.ran.some((c) => c.startsWith("/usr/bin/sudo"))).toBe(false);
  });

  it("undoes once the session ended even though the owner is alive", async () => {
    const f = fake([change("c1"), { t: "session_end", session: "awk_1", at: NOW - 5 }]);
    f.alive.add(100);
    expect((await script.runBackstop(J, deps(f))).undone).toEqual(["c1"]);
  });

  it("treats a reused pid as dead (start time differs)", async () => {
    const f = fake([change("c1", { owner: { pid: 100, started: "start-OLD" } })]);
    f.alive.add(100);
    expect((await script.runBackstop(J, deps(f))).undone).toEqual(["c1"]);
  });

  it("runs ONLY the off command of the entry's own setting, even when a tampered entry says otherwise (checksum recomputed)", async () => {
    const f = fake([
      change("evil", { undo: { argv: ["/bin/sh", "-c", "reboot"] } }),
      change("turn-on", { undo: { argv: ["/usr/bin/pmset", "-a", "disablesleep", "1"] } }),
      change("wrong-setting", { undo: { argv: ["/usr/bin/pmset", "-a", "lowpowermode", "0"] } }),
    ]);
    const report = await script.runBackstop(J, deps(f));
    expect(report.failed.map((x: { id: string }) => x.id)).toEqual([
      "evil",
      "turn-on",
      "wrong-setting",
    ]);
    expect(f.ran.filter((c) => c.startsWith("/usr/bin/sudo"))).toEqual([]);
  });

  it("ignores lines that fail their checksum", async () => {
    const f = fake([]);
    f.files.set(
      J,
      encodeLine(change("c1")).replace('"pmset.disablesleep"', '"pmset.lowpowermode"'),
    );
    const report = await script.runBackstop(J, deps(f));
    expect(report.untrusted).toBe(1);
    expect(report.undone).toEqual([]);
    expect(f.ran).toEqual([]);
  });

  it("keeps a failed undo pending for the next minute and does not mark it undone", async () => {
    const f = fake([change("c1")]);
    f.failSudo = true;
    const report = await script.runBackstop(J, deps(f));
    expect(report.failed).toHaveLength(1);
    expect(parseJournal(f.files.get(J) ?? "").pending.map((e) => e.id)).toEqual(["c1"]);
  });

  it("does nothing, and takes no action, while another reconcile holds the lock", async () => {
    const f = fake([change("c1")]);
    f.lockHeld = true;
    const report = await script.runBackstop(J, deps(f));
    expect(report.locked).toBe(true);
    expect(f.ran).toEqual([]);
  });

  it("does not undo from a guess when `ps` cannot run", async () => {
    const f = fake([change("c1")]);
    const d = deps(f);
    const run = d.runFile;
    d.runFile = (file, args) =>
      file === "/bin/ps" ? Promise.resolve({ code: null, stdout: "" }) : run(file, args);
    expect((await script.runBackstop(J, d)).undone).toEqual([]);
  });
});
