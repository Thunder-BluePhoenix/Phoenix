// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The last guard before the OS: `process.kill` is replaced by a spy, so this test can never signal
// anything, and the real signaler is shown to refuse group-like pids and Core's own pid.
import { afterEach, describe, expect, it, vi } from "vitest";
import { realSignaler } from "../src/real";

afterEach(() => vi.restoreAllMocks());

describe("realSignaler (process.kill is a spy)", () => {
  it("refuses pid <= 1, non-integers and Core's own pid without calling the OS", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    for (const pid of [0, 1, -1, -2, 1.5, Number.NaN, 2 ** 53, process.pid]) {
      expect(() => realSignaler(pid, "SIGTERM"), String(pid)).toThrow("refused");
    }
    expect(kill).not.toHaveBeenCalled();
  });

  it("maps the OS answers: sent, gone (ESRCH), denied (EPERM); anything else is an error", () => {
    const err = (code: string) => Object.assign(new Error("x"), { code });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const other = process.pid + 1;
    expect(realSignaler(other, "SIGTERM")).toBe("sent");
    expect(kill).toHaveBeenCalledWith(other, "SIGTERM");
    kill.mockImplementation(() => {
      throw err("ESRCH");
    });
    expect(realSignaler(other, "SIGKILL")).toBe("gone");
    kill.mockImplementation(() => {
      throw err("EPERM");
    });
    expect(realSignaler(other, "SIGKILL")).toBe("denied");
    kill.mockImplementation(() => {
      throw err("EINVAL");
    });
    expect(() => realSignaler(other, "SIGKILL")).toThrow();
  });
});
