// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 85 through a running Core (real HTTP, real permission gateway, real capability manager): the
// two image-attach commands of `issues` may carry a base64 PNG above the 256 KiB default body limit,
// and no other command route may. Nothing is approved, so no request leaves for any tracker.
import { createHash } from "node:crypto";
import { createIssuesCapability } from "@phoenix/capability-issues";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

function png(pad: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(4, 8);
  ihdr.writeUInt32BE(4, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    Buffer.alloc(pad, 7),
    Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]);
}

function input(image: Buffer, issue: string) {
  const prefix = createHash("sha256").update(image).digest("hex").slice(0, 12);
  return {
    issue,
    image_base64: image.toString("base64"),
    bytes: image.length,
    sha256_prefix: prefix,
    file_name: `phoenix-screenshot-${prefix}.png`,
  };
}

async function boot() {
  const core: TestCore = await startCore({}, { capabilities: [createIssuesCapability()] });
  stop = () => core.runtime.stop();
  await core.api("POST", "/api/capabilities/issues/enable", {});
  return core;
}

describe("issue image-attach body limit", () => {
  it("gives only the two attach commands a body above 256 KiB, and caps it at 7 MiB", async () => {
    const core = await boot();
    const refused = async (path: string, body: unknown) =>
      core.api("POST", path, body).then(
        (r) => r.status,
        // Core answers 413 and closes the connection, so the client may see the closed socket.
        () => 413,
      );
    const big = png(400 * 1024);
    for (const [command, key] of [
      ["jira.issue.attach", "PROJ-7"],
      ["linear.issue.attach", "ENG-12"],
    ] as const) {
      const res = await core.api("POST", `/api/capabilities/issues/commands/${command}`, {
        input: input(big, key),
      });
      // Accepted and read in full (an operation waiting for the person's confirmation).
      expect(res.status).toBe(202);
    }
    // A 5 MiB image (6.99 MB of base64) fits the attach limit.
    const full = await core.api("POST", "/api/capabilities/issues/commands/jira.issue.attach", {
      input: input(png(5 * 1024 * 1024 - png(0).length), "PROJ-7"),
    });
    expect(full.status).toBe(202);
    // Beyond 7 MiB it is refused even on the attach path.
    expect(
      await refused("/api/capabilities/issues/commands/jira.issue.attach", {
        input: { pad: "x".repeat(8 * 1024 * 1024) },
      }),
    ).toBe(413);
    // The same size to any other command route keeps the 256 KiB limit.
    expect(
      await refused("/api/capabilities/issues/commands/jira.issue.create", {
        input: { project: "PROJ", title: "t", body: "x".repeat(300 * 1024) },
      }),
    ).toBe(413);
    expect(
      await refused("/api/capabilities/issues/commands/list", {
        input: { pad: "x".repeat(300 * 1024) },
      }),
    ).toBe(413);
  });
});
