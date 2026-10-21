// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { createLidObserver, parseClamshell } from "../../src/power/lid";
import { readThermal } from "../../src/power/thermal";
import type { Platform, RunResult } from "../../src/system";

/** `ioreg -r -k AppleClamshellState -d 4` as observed on macOS (trimmed to the relevant lines). */
const ioreg = (value: string) =>
  `+-o IOPMrootDomain  <class IOPMrootDomain, id 0x1000002d5, registered, matched, active, busy 0 (3116 ms), retain 189>\n  | {\n  |   "AppleClamshellCausesSleep" = No\n  |   "AppleClamshellState" = ${value}\n  | }\n`;

describe("parseClamshell", () => {
  it("reads Yes as closed and No as open", () => {
    expect(parseClamshell(ioreg("Yes"))).toBe("closed");
    expect(parseClamshell(ioreg("No"))).toBe("open");
  });

  it("does not confuse AppleClamshellCausesSleep with the state", () => {
    expect(parseClamshell('  |   "AppleClamshellCausesSleep" = Yes\n')).toBe("unknown");
  });

  it.each([
    ["empty", ""],
    ["no key", "+-o IOPMrootDomain\n"],
    ["a value that is neither", ioreg("Maybe")],
    ["both values", `${ioreg("Yes")}${ioreg("No")}`],
  ])("is unknown for %s", (_name, text) => {
    expect(parseClamshell(text)).toBe("unknown");
  });

  it("accepts the same value twice (two matching registry entries)", () => {
    expect(parseClamshell(`${ioreg("Yes")}${ioreg("Yes")}`)).toBe("closed");
  });
});

function observer(platform: Platform, script: () => RunResult) {
  const ran: string[] = [];
  const obs = createLidObserver({
    platform,
    run: (file, args) => {
      ran.push([file, ...args].join(" "));
      return Promise.resolve(script());
    },
  });
  return { obs, ran };
}

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });

describe("lid observer", () => {
  it("polls ioreg read-only and reports the state", async () => {
    const { obs, ran } = observer("darwin", () => ok(ioreg("No")));
    expect(obs.state()).toBe("unknown");
    expect(await obs.poll()).toBe("open");
    expect(ran).toEqual(["/usr/sbin/ioreg -r -k AppleClamshellState -d 4"]);
  });

  it("tells listeners about closed and opened, not about the first reading or repeats", async () => {
    let value = "No";
    const { obs } = observer("darwin", () => ok(ioreg(value)));
    const seen: string[] = [];
    obs.onLid((s) => seen.push(s));
    await obs.poll();
    await obs.poll();
    value = "Yes";
    await obs.poll();
    await obs.poll();
    value = "No";
    await obs.poll();
    expect(seen).toEqual(["closed", "open"]);
  });

  it("an unreadable poll keeps the old state out of events: unknown then closed is not a transition", async () => {
    let script: RunResult = ok(ioreg("No"));
    const { obs } = observer("darwin", () => script);
    const seen: string[] = [];
    obs.onLid((s) => seen.push(s));
    await obs.poll();
    script = { code: 1, stdout: "", stderr: "" };
    expect(await obs.poll()).toBe("unknown");
    script = ok(ioreg("Yes"));
    await obs.poll();
    expect(seen).toEqual([]);
  });

  it("a throwing listener does not stop the others", async () => {
    let value = "No";
    const { obs } = observer("darwin", () => ok(ioreg(value)));
    const seen: string[] = [];
    obs.onLid(() => {
      throw new Error("bad listener");
    });
    obs.onLid((s) => seen.push(s));
    await obs.poll();
    value = "Yes";
    await obs.poll();
    expect(seen).toEqual(["closed"]);
  });

  it("unsubscribe stops delivery", async () => {
    let value = "No";
    const { obs } = observer("darwin", () => ok(ioreg(value)));
    const seen: string[] = [];
    const off = obs.onLid((s) => seen.push(s));
    await obs.poll();
    off();
    value = "Yes";
    await obs.poll();
    expect(seen).toEqual([]);
  });

  it("is unsupported off macOS and never runs a command", async () => {
    for (const platform of ["linux", "win32"] as const) {
      const { obs, ran } = observer(platform, () => ok(ioreg("Yes")));
      expect(obs.supported()).toBe(false);
      expect(await obs.poll()).toBe("unsupported");
      expect(ran).toEqual([]);
    }
  });

  it("a command that cannot run is unknown, not closed", async () => {
    const { obs } = observer("darwin", () => ({ code: null, stdout: "", stderr: "" }));
    expect(await obs.poll()).toBe("unknown");
  });
});

describe("readThermal", () => {
  it("runs only the read-only `pmset -g therm` on macOS", async () => {
    const ran: string[] = [];
    const reading = await readThermal({
      platform: "darwin",
      run: (file, args) => (
        ran.push([file, ...args].join(" ")),
        Promise.resolve(ok("CPU_Speed_Limit = 60\n"))
      ),
    });
    expect(ran).toEqual(["/usr/bin/pmset -g therm"]);
    expect(reading).toEqual({ kind: "level", level: "serious" });
  });

  it("is unsupported elsewhere without running anything, and unknown when the command fails", async () => {
    const ran: string[] = [];
    const run = (file: string, args: readonly string[]) => (
      ran.push([file, ...args].join(" ")),
      Promise.resolve(ok(""))
    );
    expect(await readThermal({ platform: "linux", run })).toEqual({ kind: "unsupported" });
    expect(ran).toEqual([]);
    expect(
      await readThermal({
        platform: "darwin",
        run: () => Promise.resolve({ code: 1, stdout: "", stderr: "" }),
      }),
    ).toEqual({ kind: "unknown" });
    expect(
      await readThermal({ platform: "darwin", run: () => Promise.reject(new Error("boom")) }),
    ).toEqual({ kind: "unknown" });
  });
});
