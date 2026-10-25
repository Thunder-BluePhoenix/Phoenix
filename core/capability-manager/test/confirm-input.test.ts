// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { confirmInputs, MAX_CONFIRM_INPUT_CHARS } from "../src";

const schema = {
  type: "object",
  properties: {
    text: { type: "string", "x-phoenix-confirm-input": true },
    other: { type: "string" },
    n: { type: "number", "x-phoenix-confirm-input": true },
  },
};

describe("confirmInputs", () => {
  it("passes only flagged string properties, unclipped and unredacted", () => {
    const long = "x".repeat(2000);
    expect(confirmInputs({ text: long, other: "no", n: 3 }, schema)).toEqual({
      confirm_input: { text: long },
    });
  });
  it("skips values over the cap, unflagged input and non-objects", () => {
    expect(confirmInputs({ text: "x".repeat(MAX_CONFIRM_INPUT_CHARS + 1) }, schema)).toEqual({});
    expect(confirmInputs({ other: "no" }, schema)).toEqual({});
    expect(confirmInputs("text", schema)).toEqual({});
    expect(confirmInputs({ text: "a" }, undefined)).toEqual({});
  });
});
