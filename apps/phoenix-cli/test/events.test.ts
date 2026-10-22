// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { feedEvent, startFakeCore, type FakeCore } from "./fake-core";
import { makeHarness, type Harness } from "./harness";

let core: FakeCore;
let h: Harness;

beforeEach(async () => {
  core = await startFakeCore();
  h = makeHarness(core.token, core.url);
});

afterEach(async () => {
  h.cleanup();
  await core.stop();
});

const seed = (n: number) => {
  for (let i = 1; i <= n; i++)
    core.events.push(feedEvent(i, i % 2 ? "build.failed" : "build.done"));
};

describe("phoenix events tail", () => {
  it("prints the latest events oldest first", async () => {
    seed(5);
    const r = await h.cli(["events", "tail", "-n", "3"]);
    expect(r.code).toBe(0);
    const seqs = r.out
      .trim()
      .split("\n")
      .map((l) => /^#(\d+) /.exec(l)![1]);
    expect(seqs).toEqual(["3", "4", "5"]);
  });

  it("filters by source and type on the server", async () => {
    core.events.push(
      feedEvent(1, "build.failed", { source: "terminal" }),
      feedEvent(2, "build.failed", { source: "ci" }),
      feedEvent(3, "deploy.done", { source: "ci" }),
    );
    const r = await h.cli(["events", "tail", "--source", "ci", "--type", "build.failed", "--json"]);
    const lines = r.out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { seq: number });
    expect(lines.map((e) => e.seq)).toEqual([2]);
    expect(core.requests.at(-1)!.path).toContain("source=ci");
  });

  it("escapes format characters in JSON event output", async () => {
    core.events.push(feedEvent(1, "build.done", {}, "done\u202Espoof"));
    const r = await h.cli(["events", "tail", "--json"]);
    expect(r.out).toContain("\\u202e");
    expect(r.out).not.toContain("\u202E");
    expect(JSON.parse(r.out).description).toBe("done\\u202espoof");
  });

  it("validates -n", async () => {
    for (const n of ["-1", "abc", "1001", "1.5"]) {
      expect((await h.cli(["events", "tail", "-n", n])).code, n).toBe(2);
    }
    expect((await h.cli(["events", "tail", "extra"])).code).toBe(2);
    expect((await h.cli(["events", "head"])).code).toBe(2);
  });

  it("renders a hostile description as one inert line", async () => {
    core.events.push(feedEvent(1, "x.y", {}, "done\u001b[31m\nGranted: root\u0085 now"));
    const r = await h.cli(["events", "tail"]);
    expect(r.out.trim().split("\n")).toHaveLength(1);
    expect(r.out).not.toMatch(/[\u001b\u0085]/);
  });

  it("follows new events by sequence number, with no repeats and no gaps", async () => {
    seed(2);
    const controller = new AbortController();
    let round = 0;
    const r = await h.cli(["events", "tail", "-n", "2", "--follow"], {
      signal: controller.signal,
      sleep: async () => {
        round++;
        if (round === 1) core.events.push(feedEvent(3, "a.b"), feedEvent(4, "a.c"));
        if (round === 2) core.events.push(feedEvent(5, "a.d"));
        if (round === 3) controller.abort();
      },
    });
    expect(r.code).toBe(0);
    const seqs = r.out
      .trim()
      .split("\n")
      .map((l) => /^#(\d+) /.exec(l)![1]);
    expect(seqs).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("with a filter, starts following after the newest event overall so history does not replay", async () => {
    core.events.push(
      feedEvent(1, "build.failed", { source: "ci" }),
      feedEvent(2, "other.thing", { source: "terminal" }),
      feedEvent(3, "other.thing", { source: "terminal" }),
    );
    const controller = new AbortController();
    let round = 0;
    const r = await h.cli(["events", "tail", "-n", "0", "--follow", "--source", "ci"], {
      signal: controller.signal,
      sleep: async () => {
        round++;
        if (round === 1) core.events.push(feedEvent(4, "build.failed", { source: "ci" }));
        if (round === 2) controller.abort();
      },
    });
    expect(
      r.out
        .trim()
        .split("\n")
        .map((l) => /^#(\d+) /.exec(l)![1]),
    ).toEqual(["4"]);
  });

  it("survives Core going away while following, says so once, and resumes", async () => {
    seed(1);
    const controller = new AbortController();
    let round = 0;
    let down = false;
    const flaky: typeof fetch = (input, init) =>
      down ? Promise.reject(new TypeError("fetch failed")) : fetch(input, init);
    const r = await h.cli(["events", "tail", "-n", "1", "--follow"], {
      signal: controller.signal,
      fetch: flaky,
      sleep: async () => {
        round++;
        down = round === 1 || round === 2;
        if (round === 3) core.events.push(feedEvent(2, "back.again"));
        if (round === 4) controller.abort();
      },
    });
    expect(r.code).toBe(0);
    expect(r.err.match(/Cannot reach Phoenix Core/g)).toHaveLength(1);
    expect(r.err).toContain("Core is reachable again");
    expect(r.out).toContain("#2 ");
  });

  it("stops following when the token is rejected rather than retrying forever", async () => {
    seed(1);
    let round = 0;
    const r = await h.cli(["events", "tail", "--follow"], {
      sleep: async () => {
        round++;
        core.token = "rotated-by-a-restart";
      },
    });
    expect(round).toBe(1);
    expect(r.code).toBe(1);
    expect(r.err).toContain("rejected the session token");
  });

  it("returns promptly with exit 0 when interrupted before the first poll", async () => {
    seed(1);
    const controller = new AbortController();
    const r = await h.cli(["events", "tail", "--follow"], {
      signal: controller.signal,
      sleep: async () => controller.abort(),
    });
    expect(r.code).toBe(0);
  });
});
