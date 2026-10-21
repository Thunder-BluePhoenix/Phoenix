// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { runResultFromExec } from "../../src/system";

/** Built at runtime so no credential-shaped literal sits in the tree. */
const pw = ["fake", "-", "pw", String(1)].join("");

function failure(message: string, code?: unknown): Error & { code?: unknown } {
  return Object.assign(new Error(message), { code });
}

describe("runResultFromExec", () => {
  it("never leaks Node's `Command failed: <argv>` message (it can hold a hotspot password)", () => {
    const err = failure(`Command failed: networksetup -setairportnetwork en0 Net ${pw}`, 1);
    const result = runResultFromExec(err, "", "");
    expect(result).toEqual({ code: 1, stdout: "", stderr: "exec_failed" });
    expect(JSON.stringify(result)).not.toContain(pw);
  });

  it("never leaks a spawn error's message either, and a spawn failure has no exit code", () => {
    const result = runResultFromExec(failure(`spawn /usr/sbin/networksetup ENOENT ${pw}`, "ENOENT"), "", "");
    expect(result).toEqual({ code: null, stdout: "", stderr: "exec_failed" });
  });

  it("passes the tool's own stderr and stdout through when there is some", () => {
    const err = failure(`Command failed: x ${pw}`, 2);
    expect(runResultFromExec(err, "out", "real stderr")).toEqual({
      code: 2,
      stdout: "out",
      stderr: "real stderr",
    });
  });

  it("a success is code 0 with the output untouched", () => {
    expect(runResultFromExec(null, "a", "b")).toEqual({ code: 0, stdout: "a", stderr: "b" });
  });
});
