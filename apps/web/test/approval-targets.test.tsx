// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmTargetRows } from "../src/core/confirm-targets";
import type { Confirmation } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { confirmation, mount, openPanel } from "./harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

function show(c: Confirmation) {
  mount({ "GET /api/confirmations": () => ({ confirmations: [c] }) });
  openPanel();
  return screen.findByRole("listitem", { name: c.summary });
}

describe("confirmTargetRows (Phase 67)", () => {
  it("keeps plain names and drops anything that is not [A-Za-z0-9_-]{1,40}", () => {
    expect(
      confirmTargetRows({
        project_id: "p1",
        "bad name": "x",
        "<b>": "x",
        "a:b": "x",
        ["n".repeat(41)]: "x",
        ["n".repeat(40)]: "ok",
        é: "x",
      }),
    ).toEqual([
      ["project_id", "p1"],
      ["n".repeat(40), "ok"],
    ]);
  });

  it("strips control, format and bidi characters from values and drops empty or non-string ones", () => {
    const rows = confirmTargetRows({
      a: "he\u202Ello\u0007 wor\u200Bld\u2066",
      b: "\u202E\u0000",
      c: 5,
      d: null,
    });
    expect(rows).toEqual([["a", "hello world"]]);
  });

  it("clips values to 80 characters (by code point)", () => {
    const value = confirmTargetRows({ a: "x".repeat(200) })[0]![1];
    expect(value).toHaveLength(80);
    const emoji = confirmTargetRows({ a: "😀".repeat(100) })[0]![1];
    expect(Array.from(emoji)).toHaveLength(80);
  });

  it("returns at most 16 rows", () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`n${i}`, `v${i}`]));
    const rows = confirmTargetRows(many);
    expect(rows).toHaveLength(16);
    expect(rows[15]).toEqual(["n15", "v15"]);
  });

  it("returns nothing for missing, array or non-object targets", () => {
    for (const bad of [undefined, null, "x", 3, ["a"]]) expect(confirmTargetRows(bad)).toEqual([]);
  });
});

describe("Approval card targets (Phase 67)", () => {
  it("renders name: value rows with a heading, before the approve button", async () => {
    const el = await show(
      confirmation({ details: { targets: { project_id: "acme", target: "main" } } }),
    );
    const c = within(el);
    expect(c.getByText("Named inputs this request will act on")).toBeTruthy();
    const list = el.querySelector("[data-confirm-targets]")!;
    expect([...list.querySelectorAll(".approval-target")].map((r) => r.textContent)).toEqual([
      "project_idacme",
      "targetmain",
    ]);
    const approve = c.getByRole("button", { name: /^Approve:/ });
    expect(list.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows markup-looking values and hidden characters as inert text", async () => {
    const el = await show(
      confirmation({
        details: {
          targets: {
            id: '<img src=x onerror="alert(1)"><a href="https://evil.example">go</a>',
            project: "abc\u202Edef",
          },
        },
      }),
    );
    const list = el.querySelector("[data-confirm-targets]")!;
    expect(list.querySelector("img, a, script, [href], [onerror]")).toBeNull();
    expect(list.textContent).toContain(
      '<img src=x onerror="alert(1)"><a href="https://evil.example">go</a>',
    );
    expect(list.textContent).toContain("abcdef");
    expect(list.textContent).not.toContain("\u202E");
  });

  it("renders nothing when there are no targets", async () => {
    const cases: Confirmation["details"][] = [
      undefined,
      {},
      { targets: {} },
      { targets: { "bad name": "x" } },
    ];
    for (const details of cases) {
      cleanup();
      FakeWebSocket.reset();
      const el = await show(confirmation({ details }));
      expect(el.querySelector("[data-confirm-targets]")).toBeNull();
      expect(within(el).queryByText("Named inputs this request will act on")).toBeNull();
    }
  });

  it("shows at most 16 rows", async () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`n${i}`, `v${i}`]));
    const el = await show(confirmation({ details: { targets: many } }));
    expect(el.querySelectorAll("[data-confirm-targets] .approval-target")).toHaveLength(16);
  });
});
