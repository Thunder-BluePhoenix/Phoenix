// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 73/75: the awake files live in the directory Core owns for the capability (ctx.dataDir),
// and a journal an older Phoenix left in the old place is adopted without losing a pending entry.
// Fake disk, fake processes, recording Runner: no sudo, pmset or launchd is ever run.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAwakeCapability } from "../../src";
import { createRecoveryModule, powerServices, type PowerServices } from "../../src/power";
import {
  encodeLine,
  parseJournal,
  type ChangeRecord,
  type JournalRecord,
} from "../../src/power/format";
import { adoptLegacyJournal } from "../../src/power/legacy";
import { nodeJournalFs } from "../../src/power/journal";
import type { AwakeDeps, AwakeModule } from "../../src/system";
import { FakeContext } from "../../testing/ctx";
import { FakeFeed, FakeSystem, settle } from "../../testing/fakes";
import { FakeProcesses, MemFs } from "./fixtures";

const CORE = "/core/capabilities/awake";
const OLD = "/old";
const NEW_JOURNAL = `${CORE}/recovery-journal.jsonl`;
const OLD_JOURNAL = `${OLD}/awake/recovery-journal.jsonl`;
const SUDO_OFF = "/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0";

const owner = { pid: 100, started: "Mon Oct 20 08:00:00 2026" };
const change = (id: string, over: Partial<ChangeRecord> = {}): ChangeRecord => ({
  t: "change",
  id,
  kind: "pmset.disablesleep",
  apply: { argv: ["/usr/bin/pmset", "-a", "disablesleep", "1"] },
  undo: { argv: ["/usr/bin/pmset", "-a", "disablesleep", "0"] },
  at: 1_000,
  session: "awk_old",
  owner,
  ...over,
});
const text = (...recs: JournalRecord[]) => recs.map(encodeLine).join("");
const pendingIds = (fs: MemFs, path: string) =>
  parseJournal(fs.read(path) ?? "").pending.map((e) => e.id);

interface Booted {
  fake: FakeContext;
  sys: FakeSystem;
  services: () => PowerServices | undefined;
  sudo: () => string[];
  stop: () => Promise<void>;
}

/** The real capability with the recovery module, on a fake machine; `coreDir` plays ctx.dataDir. */
async function boot(
  fs: MemFs,
  procs: FakeProcesses,
  coreDir: string | undefined,
  options: { dir?: string } = {},
): Promise<Booted> {
  const sys = new FakeSystem({ platform: "darwin" });
  const fake = new FakeContext();
  fake.dataDir = coreDir;
  let deps: AwakeDeps | undefined;
  const recovery = createRecoveryModule({
    ...options,
    legacyDir: OLD,
    fs,
    probe: procs.probe(),
    pollMs: 5_000,
  });
  const spy: AwakeModule = {
    events: [],
    commandSpecs: [],
    commands: {},
    stateRules: [],
    init: (_ctx, d) => void (deps = d),
  };
  const module = createAwakeCapability({
    env: sys.env,
    feed: () => new FakeFeed(),
    battery: () => Promise.resolve({ kind: "none" }),
    batteryPollMs: 60_000,
    modules: [recovery, spy],
  });
  await module.init?.(fake.ctx);
  await settle();
  return {
    fake,
    sys,
    services: () => (deps ? powerServices(deps) : undefined),
    sudo: () =>
      sys.runs
        .map((x) => [x.file, ...x.args].join(" "))
        .filter((c) => c.startsWith("/usr/bin/sudo -n /usr/bin/pmset")),
    async stop() {
      fake.controller.abort();
      await module.shutdown?.(fake.ctx);
      await settle();
    },
  };
}

describe("the recovery journal follows ctx.dataDir", () => {
  it("writes the journal under the Core directory and nowhere else", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const b = await boot(fs, procs, CORE);
    expect(b.services()).toBeDefined();
    await b
      .services()
      ?.recovery.change("pmset.disablesleep", {}, {}, () => Promise.resolve(), null);
    expect([...fs.files.keys()]).toEqual([NEW_JOURNAL]);
    expect(fs.dirs).toContain(CORE);
    expect([...fs.files.keys()].some((p) => p.startsWith(OLD))).toBe(false);
  });

  it("without a Core directory (a harness) it falls back to the old place", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const b = await boot(fs, procs, undefined);
    await b
      .services()
      ?.recovery.change("pmset.disablesleep", {}, {}, () => Promise.resolve(), null);
    expect([...fs.files.keys()]).toEqual([OLD_JOURNAL]);
  });

  it("an explicit dir still wins over the context (tests that pin a place)", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const b = await boot(fs, procs, CORE, { dir: "/pinned" });
    await b
      .services()
      ?.recovery.change("pmset.disablesleep", {}, {}, () => Promise.resolve(), null);
    expect([...fs.files.keys()]).toEqual(["/pinned/awake/recovery-journal.jsonl"]);
  });

  it("refuses to start, and does not guess a place, when Core's directory is not absolute", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const b = await boot(fs, procs, "relative/dir");
    // The module failed to start (composeAwake logs it); no service, no file anywhere.
    expect(b.services()).toBeUndefined();
    expect(fs.files.size).toBe(0);
  });
});

describe("a journal an older Phoenix left in the old place", () => {
  it("is adopted: pending entries move to the Core directory and are undone, none lost", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    fs.files.set(
      OLD_JOURNAL,
      text(change("chg_old1"), { t: "applied", id: "chg_old1", at: 1_000 }),
    );
    procs.die(100);
    const b = await boot(fs, procs.as(200), CORE);
    // The old entry was reconciled (its owner is gone): the OFF line ran once.
    expect(b.sudo()).toEqual([SUDO_OFF]);
    expect(pendingIds(fs, NEW_JOURNAL)).toEqual([]);
    expect(fs.read(NEW_JOURNAL)).toContain('"undone"');
    // The old file is set aside, never left to be undone a second time.
    expect(fs.files.has(OLD_JOURNAL)).toBe(false);
    expect([...fs.files.keys()].some((p) => p.startsWith(`${OLD_JOURNAL}.adopted-`))).toBe(true);
    expect(b.services()?.canQuit().ok).toBe(true);
  });

  it("when both journals hold pending entries, the old ones are undone first, then the new", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    fs.files.set(OLD_JOURNAL, text(change("chg_old")));
    fs.files.set(NEW_JOURNAL, text(change("chg_new", { at: 2_000, session: "awk_new" })));
    procs.die(100);
    const order: string[] = [];
    const b = await boot(fs, procs.as(200), CORE);
    // Both entries were undone through the same rule (two OFF lines, none dropped).
    expect(b.sudo()).toEqual([SUDO_OFF, SUDO_OFF]);
    await settle();
    expect(pendingIds(fs, NEW_JOURNAL)).toEqual([]);
    const events = b.fake.events.filter((e) => e.event_type === "awake.privileged.undo");
    for (const e of events) order.push(String(e.payload?.id));
    // Undo is newest first: the adopted (old) entry sits after the new journal's own entry in the
    // file, so it is undone first.
    expect(order).toEqual(["chg_old", "chg_new"]);
  });

  it("does not add an entry twice when a crash left a copy in both places", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    fs.files.set(OLD_JOURNAL, text(change("chg_dup")));
    fs.files.set(NEW_JOURNAL, text(change("chg_dup")));
    procs.die(100);
    const b = await boot(fs, procs.as(200), CORE);
    expect(b.sudo()).toEqual([SUDO_OFF]);
    expect(parseJournal(fs.read(NEW_JOURNAL) ?? "").pending).toEqual([]);
    expect((fs.read(NEW_JOURNAL) ?? "").split('"t":"change"').length - 1).toBe(1);
  });

  it("an old journal with nothing pending is left exactly where it was", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const done = text(change("chg_done"), { t: "undone", id: "chg_done", at: 1_500 });
    fs.files.set(OLD_JOURNAL, done);
    await boot(fs, procs, CORE);
    expect(fs.read(OLD_JOURNAL)).toBe(done);
    expect(fs.files.has(NEW_JOURNAL)).toBe(false);
  });

  it("keeps using the OLD directory when the move cannot be done safely (nothing is dropped)", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    fs.files.set(OLD_JOURNAL, text(change("chg_old1")));
    fs.failRename = true;
    procs.die(100);
    const b = await boot(fs, procs.as(200), CORE);
    // The entry was still found and undone, in the old place, and the new journal is untouched.
    expect(b.sudo()).toEqual([SUDO_OFF]);
    expect(pendingIds(fs, OLD_JOURNAL)).toEqual([]);
    expect(fs.files.has(NEW_JOURNAL)).toBe(false);
    expect(b.services()).toBeDefined();
  });
});

describe("adoptLegacyJournal", () => {
  const run = (fs: MemFs) =>
    adoptLegacyJournal({ fs, legacyPath: OLD_JOURNAL, path: NEW_JOURNAL, now: () => 42 });

  it("copies pending entries with their applied and session-end marks, verified byte for byte", () => {
    const fs = new MemFs();
    fs.files.set(
      OLD_JOURNAL,
      text(
        change("a"),
        { t: "applied", id: "a", at: 1_000 },
        { t: "session_end", session: "awk_old", at: 1_100 },
        change("b", { session: null }),
        change("gone"),
        { t: "undone", id: "gone", at: 1_200 },
      ),
    );
    expect(run(fs)).toEqual({ status: "adopted", adopted: 2 });
    const moved = parseJournal(fs.read(NEW_JOURNAL) ?? "");
    expect(moved.pending.map((e) => [e.id, e.applied])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(moved.endedSessions.has("awk_old")).toBe(true);
    expect(moved.untrusted).toBe(0);
    expect(fs.files.has(`${OLD_JOURNAL}.adopted-42`)).toBe(true);
    expect(fs.files.has(OLD_JOURNAL)).toBe(false);
  });

  it("appends after the new journal's own entries and survives a torn last line there", () => {
    const fs = new MemFs();
    fs.files.set(OLD_JOURNAL, text(change("old")));
    fs.files.set(NEW_JOURNAL, text(change("new")) + '{"v":1,"sum":"cut');
    expect(run(fs).status).toBe("adopted");
    expect(pendingIds(fs, NEW_JOURNAL)).toEqual(["new", "old"]);
  });

  it("does not trust a forged old line: it is not copied", () => {
    const fs = new MemFs();
    fs.files.set(OLD_JOURNAL, text(change("real")) + '{"v":1,"sum":"0000","rec":{"t":"change"}}\n');
    expect(run(fs)).toEqual({ status: "adopted", adopted: 1 });
    expect(pendingIds(fs, NEW_JOURNAL)).toEqual(["real"]);
  });

  it("fails, and changes nothing, when the new journal cannot be written", () => {
    const fs = new MemFs();
    fs.files.set(OLD_JOURNAL, text(change("a")));
    fs.failReplace = true;
    expect(run(fs).status).toBe("failed");
    expect(fs.files.has(NEW_JOURNAL)).toBe(false);
    expect(pendingIds(fs, OLD_JOURNAL)).toEqual(["a"]);
  });

  it("fails and puts the new journal back when the old file cannot be set aside", () => {
    const fs = new MemFs();
    const before = text(change("new"));
    fs.files.set(OLD_JOURNAL, text(change("old")));
    fs.files.set(NEW_JOURNAL, before);
    fs.failRename = true;
    expect(run(fs).status).toBe("failed");
    expect(fs.read(NEW_JOURNAL)).toBe(before);
    expect(pendingIds(fs, OLD_JOURNAL)).toEqual(["old"]);
  });

  it("fails when the entries would not fit in the journal's size budget", () => {
    const fs = new MemFs();
    const big = "x".repeat(1 << 20);
    fs.files.set(OLD_JOURNAL, text(change("a", { apply: { pad: big } })));
    expect(run(fs).status).toBe("failed");
    expect(fs.files.has(NEW_JOURNAL)).toBe(false);
  });

  it("is a no-op when there is no old journal or both paths are the same", () => {
    const fs = new MemFs();
    expect(run(fs)).toEqual({ status: "none" });
    fs.files.set(NEW_JOURNAL, text(change("a")));
    expect(
      adoptLegacyJournal({ fs, legacyPath: NEW_JOURNAL, path: NEW_JOURNAL, now: () => 1 }),
    ).toEqual({ status: "none" });
  });
});

describe("adoption on the real file system (temp directory)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  it("moves the pending entries with an atomic rename of the old file and keeps both files private", () => {
    const root = mkdtempSync(join(tmpdir(), "zz-awake-adopt-"));
    roots.push(root);
    const legacy = join(root, "old", "awake");
    const core = join(root, "core", "capabilities", "awake");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "recovery-journal.jsonl"), text(change("real")), { mode: 0o600 });
    const result = adoptLegacyJournal({
      fs: nodeJournalFs,
      legacyPath: join(legacy, "recovery-journal.jsonl"),
      path: join(core, "recovery-journal.jsonl"),
      now: () => 7,
    });
    expect(result).toEqual({ status: "adopted", adopted: 1 });
    expect(
      parseJournal(readFileSync(join(core, "recovery-journal.jsonl"), "utf8")).pending,
    ).toHaveLength(1);
    expect(readdirSync(legacy)).toEqual(["recovery-journal.jsonl.adopted-7"]);
  });
});
