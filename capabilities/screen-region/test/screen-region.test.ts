// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The region-capture adapter and capability with a FAKE runner and a real temporary directory.
// Simulated: the macOS `screencapture` program is never started, no screen is read and no Screen
// Recording permission is involved. The fake writes (or does not write) the file the real program
// would have written, so validation, cleanup and the confirmation gate are exercised for real.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureRegion,
  createScreenRegionCapability,
  inspectPng,
  MAX_IMAGE_BYTES,
  RegionCaptureError,
  SCREENCAPTURE,
  type RegionCaptureEnv,
  type RunOptions,
  type RunResult,
} from "../src";

/** A small but structurally complete PNG header + IEND (not decodable pixels; the checks are structural). */
function png(width = 40, height = 30, extra = 0): Uint8Array {
  const out = new Uint8Array(8 + 4 + 4 + 13 + 4 + extra + 12);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set(
    [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
    out.length - 12,
  );
  return out;
}

interface Call {
  file: string;
  args: string[];
  options: RunOptions;
  dirMode: number;
}

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "phoenix-region-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const leftovers = () => readdirSync(root);

type Behaviour = (path: string, options: RunOptions) => Promise<RunResult> | RunResult;
function rig(behaviour: Behaviour, platform: NodeJS.Platform = "darwin") {
  const calls: Call[] = [];
  const env: RegionCaptureEnv = {
    platform,
    tmpRoot: root,
    run: async (file, args, options) => {
      const path = args[args.length - 1]!;
      calls.push({
        file,
        args: [...args],
        options,
        dirMode: statSync(dirname(path)).mode & 0o777,
      });
      return behaviour(path, options);
    },
  };
  return { env, calls };
}
const writes = (bytes: Uint8Array, code = 0): Behaviour => {
  return (path) => {
    writeFileSync(path, bytes);
    return { code, timedOut: false, aborted: false };
  };
};
const nothing = (result: Partial<RunResult> = {}): Behaviour => {
  return () => ({ code: 0, timedOut: false, aborted: false, ...result });
};
const live = new AbortController().signal;

describe("captureRegion", () => {
  it("returns the chosen region, runs only the fixed argv in a private directory and removes it", async () => {
    const { env, calls } = rig(writes(png(40, 30, 10)));
    const shot = await captureRegion(env, live);
    expect(shot.status).toBe("captured");
    if (shot.status !== "captured") return;
    expect([shot.width, shot.height]).toEqual([40, 30]);
    expect(shot.png.length).toBe(png(40, 30, 10).length);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.file).toBe(SCREENCAPTURE);
    // Interactive region selection only, PNG, and a single file argument.
    expect(call.args.slice(0, 4)).toEqual(["-i", "-s", "-t", "png"]);
    expect(call.args).toHaveLength(5);
    expect(call.dirMode).toBe(0o700);
    const file = call.args[4]!;
    expect(dirname(dirname(file))).toBe(root);
    expect(basename(dirname(file))).toMatch(/^phoenix-region-[A-Za-z0-9]+$/);
    expect(basename(file)).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(call.options.timeoutMs).toBeGreaterThan(0);
    expect(leftovers()).toEqual([]);
  });

  it("uses a different random name each time", async () => {
    const { env, calls } = rig(writes(png()));
    await captureRegion(env, live);
    await captureRegion(env, live);
    expect(new Set(calls.map((c) => c.args[4])).size).toBe(2);
  });

  it("reports Esc (no file, clean exit) as cancelled, not as an error", async () => {
    const { env } = rig(nothing());
    expect(await captureRegion(env, live)).toEqual({ status: "cancelled" });
    expect(leftovers()).toEqual([]);
  });

  it("fails when the program ends with an error and no file", async () => {
    const { env } = rig(nothing({ code: 1 }));
    await expect(captureRegion(env, live)).rejects.toMatchObject({ kind: "failed" });
    expect(leftovers()).toEqual([]);
  });

  it("fails when the program cannot start", async () => {
    const { env } = rig(nothing({ code: null }));
    await expect(captureRegion(env, live)).rejects.toMatchObject({ kind: "failed" });
    expect(leftovers()).toEqual([]);
  });

  it("times out, passes the hard timeout to the runner and removes a partial file", async () => {
    const { env, calls } = rig((path) => {
      writeFileSync(path, png().subarray(0, 20));
      return { code: null, timedOut: true, aborted: false };
    });
    env.timeoutMs = 1234;
    await expect(captureRegion(env, live)).rejects.toMatchObject({ kind: "timeout" });
    expect(calls[0]!.options.timeoutMs).toBe(1234);
    expect(leftovers()).toEqual([]);
  });

  it("stops when cancelled by the caller, before or during the capture", async () => {
    const early = new AbortController();
    early.abort();
    const first = rig(nothing());
    await expect(captureRegion(first.env, early.signal)).rejects.toMatchObject({ kind: "stopped" });
    expect(first.calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);

    const during = new AbortController();
    const second = rig((path) => {
      writeFileSync(path, png());
      during.abort();
      return { code: null, timedOut: false, aborted: true };
    });
    await expect(captureRegion(second.env, during.signal)).rejects.toMatchObject({
      kind: "stopped",
    });
    expect(leftovers()).toEqual([]);
  });

  it.each([
    ["not a PNG at all", new TextEncoder().encode("GIF89a not a png image at all, just text....")],
    ["a JPEG header", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(80).fill(1)])],
    [
      "a file whose only fault is the PNG signature (JPEG magic)",
      Uint8Array.from(png(), (b, i) => (i < 3 ? [0xff, 0xd8, 0xff][i]! : b)),
    ],
    ["an empty file", new Uint8Array(0)],
    ["a truncated PNG (no IEND)", png().subarray(0, png().length - 12)],
    ["a PNG with zero width", png(0, 10)],
    ["a PNG that claims a huge height", png(10, 0xffffffff)],
  ])("refuses %s and removes it", async (_name, bytes) => {
    const { env } = rig(writes(bytes));
    await expect(captureRegion(env, live)).rejects.toMatchObject({ kind: "invalid_image" });
    expect(leftovers()).toEqual([]);
  });

  it("refuses an image over the byte cap and removes it", async () => {
    const { env } = rig(writes(png(40, 30, MAX_IMAGE_BYTES)));
    await expect(captureRegion(env, live)).rejects.toMatchObject({ kind: "too_large" });
    expect(leftovers()).toEqual([]);
  });

  it("accepts an image exactly at the cap", async () => {
    const exact = png(40, 30, MAX_IMAGE_BYTES - png().length);
    expect(exact.length).toBe(MAX_IMAGE_BYTES);
    const { env } = rig(writes(exact));
    expect((await captureRegion(env, live)).status).toBe("captured");
    expect(leftovers()).toEqual([]);
  });

  it("discards an image when the program reported an error, even if a file exists", async () => {
    const { env } = rig(writes(png(), 1));
    await expect(captureRegion(env, live)).rejects.toMatchObject({ kind: "failed" });
    expect(leftovers()).toEqual([]);
  });

  it("refuses a file that is not a regular file (a symlink to somewhere else)", async () => {
    const outside = join(root, "elsewhere.png");
    writeFileSync(outside, png());
    const { env } = rig(async (path) => {
      const { symlinkSync } = await import("node:fs");
      symlinkSync(outside, path);
      return { code: 0, timedOut: false, aborted: false };
    });
    await expect(captureRegion(env, live)).rejects.toMatchObject({ kind: "invalid_image" });
    expect(readdirSync(root)).toEqual(["elsewhere.png"]);
  });

  it.each(["linux", "win32", "freebsd"] as const)(
    "reports %s as unsupported without running anything or touching the disk",
    async (platform) => {
      const { env, calls } = rig(writes(png()), platform);
      expect(await captureRegion(env, live)).toEqual({ status: "unsupported", platform });
      expect(calls).toHaveLength(0);
      expect(leftovers()).toEqual([]);
    },
  );

  it("never puts a path or program output in an error message", async () => {
    const { env } = rig(nothing({ code: 1 }));
    const err = await captureRegion(env, live).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegionCaptureError);
    expect((err as Error).message).not.toContain(root);
    expect((err as Error).message).not.toContain("phoenix-region");
  });
});

describe("inspectPng", () => {
  it("reads the dimensions", () => expect(inspectPng(png(7, 9))).toEqual({ width: 7, height: 9 }));
});

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function ready(behaviour: Behaviour, platform: NodeJS.Platform = "darwin", ms = 60_000) {
  const r = rig(behaviour, platform);
  h = createHarness({
    modules: [createScreenRegionCapability({ env: r.env, imageRetentionMs: ms })],
  });
  await h.enable("screen-region");
  return r;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("the capture_region command", () => {
  it("is an execute command with the screen_capture permission", async () => {
    await ready(nothing());
    const view = h!.manager.get("screen-region");
    const command = view.commands.find((c) => c.name === "capture_region");
    expect(command?.side_effect).toBe("execute");
    expect(view.permissions.map((p) => p.permission)).toContain("screen_capture");
  });

  it("asks for confirmation before anything runs, even though the permission is granted", async () => {
    const { calls } = await ready(writes(png(40, 30)));
    const op = h!.manager.invoke("screen-region", "capture_region", {});
    await settle();
    expect(h!.permissions.pendingConfirmations()).toHaveLength(1);
    expect(op.status).toBe("pending");
    expect(calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);
    h!.permissions.resolveConfirmation(h!.permissions.pendingConfirmations()[0]!.id, true);
    while (op.status === "pending" || op.status === "running") await settle();
    expect(op.status).toBe("succeeded");
    expect(calls).toHaveLength(1);
  });

  it("captures nothing when the confirmation is declined", async () => {
    const { calls } = await ready(writes(png()));
    const op = await h!.run("screen-region", "capture_region", {}, false);
    expect(op.status).toBe("failed");
    expect(op.error?.code).toBe("PERMISSION_DENIED");
    expect(calls).toHaveLength(0);
    expect(leftovers()).toEqual([]);
  });

  it("returns the PNG, its size and no path once approved", async () => {
    await ready(writes(png(40, 30, 10)));
    const op = await h!.run("screen-region", "capture_region", {});
    expect(op.status).toBe("succeeded");
    const result = op.result as {
      status: string;
      mime: string;
      width: number;
      height: number;
      bytes: number;
      image: string;
    };
    expect(result).toMatchObject({ status: "captured", mime: "image/png", width: 40, height: 30 });
    expect(Buffer.from(result.image, "base64").length).toBe(result.bytes);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(leftovers()).toEqual([]);
  });

  it("blanks the image in the operation record after the retention time", async () => {
    await ready(writes(png()), "darwin", 30);
    const op = await h!.run("screen-region", "capture_region", {});
    const result = op.result as { image: string | null; expired: boolean };
    expect(result.image).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(result).toMatchObject({ image: null, expired: true });
  });

  it("blanks held images when the capability is disabled", async () => {
    await ready(writes(png()));
    const op = await h!.run("screen-region", "capture_region", {});
    const result = op.result as { image: string | null; expired: boolean };
    await h!.manager.disable("screen-region");
    expect(result).toMatchObject({ image: null, expired: true });
  });

  it("reports cancel as a successful 'cancelled' result", async () => {
    await ready(nothing());
    const op = await h!.run("screen-region", "capture_region", {});
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({ status: "cancelled" });
  });

  it.each([
    ["a timeout", nothing({ code: null, timedOut: true }), "OPERATION_TIMEOUT"],
    [
      "bad magic bytes",
      writes(new TextEncoder().encode("not a png, but long enough......")),
      "CAPABILITY_UNAVAILABLE",
    ],
    ["an oversize image", writes(png(40, 30, MAX_IMAGE_BYTES)), "INVALID_REQUEST"],
  ])("fails visibly and cleans up on %s", async (_name, behaviour, code) => {
    await ready(behaviour);
    const op = await h!.run("screen-region", "capture_region", {});
    expect(op.status).toBe("failed");
    expect(op.error?.code).toBe(code);
    expect(op.error?.message).not.toContain(root);
    expect(leftovers()).toEqual([]);
  });

  it.each(["linux", "win32"] as const)(
    "reports unsupported on %s and runs nothing",
    async (platform) => {
      const { calls } = await ready(writes(png()), platform);
      const op = await h!.run("screen-region", "capture_region", {});
      expect(op.result).toEqual({ status: "unsupported", platform });
      expect(calls).toHaveLength(0);
      expect(leftovers()).toEqual([]);
      expect(h!.manager.get("screen-region").health.status).not.toBe("healthy");
    },
  );

  it.each([
    { path: "/etc/passwd" },
    { args: ["-x"] },
    { file: "../../escape.png" },
    { command: "rm -rf ~" },
    { region: "0,0,10,10" },
  ])("rejects any input at all, so a caller cannot influence the program: %j", async (input) => {
    const { calls } = await ready(writes(png()));
    expect(() => h!.manager.invoke("screen-region", "capture_region", input)).toThrow();
    expect(calls).toHaveLength(0);
    expect(h!.permissions.pendingConfirmations()).toHaveLength(0);
  });

  it("allows one capture at a time", async () => {
    const gate = Promise.withResolvers<void>();
    const { calls } = await ready(async (path) => {
      await gate.promise;
      writeFileSync(path, png());
      return { code: 0, timedOut: false, aborted: false };
    });
    const first = h!.run("screen-region", "capture_region", {});
    while (calls.length === 0) await settle();
    const second = await h!.run("screen-region", "capture_region", {});
    expect(second.status).toBe("failed");
    expect(second.error?.message).toMatch(/already in progress/);
    gate.resolve();
    expect((await first).status).toBe("succeeded");
    expect(calls).toHaveLength(1);
    expect(leftovers()).toEqual([]);
  });

  it("records the confirmation and the outcome in the audit trail", async () => {
    await ready(writes(png()));
    await h!.run("screen-region", "capture_region", {});
    const actions = h!.db
      .prepare("SELECT action FROM audit_log WHERE capability_id = 'screen-region'")
      .all() as { action: string }[];
    expect(actions.map((a) => a.action)).toContain("action.succeeded");
  });
});
