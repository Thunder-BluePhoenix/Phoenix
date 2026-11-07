// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { shutdown } from "../src/shutdown";

describe("shutdown", () => {
  it("awaits each resource before releasing its dependencies", async () => {
    const order: string[] = [];
    await shutdown([
      {
        name: "producer",
        close: async () => {
          await Promise.resolve();
          order.push("producer");
        },
      },
      {
        name: "bus",
        close: () => {
          order.push("bus");
        },
      },
      {
        name: "database",
        close: () => {
          order.push("database");
        },
      },
    ]);
    expect(order).toEqual(["producer", "bus", "database"]);
  });

  it("releases later resources after synchronous and asynchronous failures", async () => {
    const first = new Error("producer failed");
    const second = new Error("listener failed");
    const released: string[] = [];
    const error = await shutdown([
      {
        name: "producer",
        close: () => {
          throw first;
        },
      },
      {
        name: "listener",
        close: async () => {
          throw second;
        },
      },
      {
        name: "database",
        close: () => {
          released.push("database");
        },
      },
      {
        name: "lock",
        close: () => {
          released.push("lock");
        },
      },
    ]).catch((err: unknown) => err);
    expect(released).toEqual(["database", "lock"]);
    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors as Error[];
    expect(errors.map((e) => e.message)).toEqual([
      "Failed to stop producer",
      "Failed to stop listener",
    ]);
    expect(errors.map((e) => e.cause)).toEqual([first, second]);
  });
});
