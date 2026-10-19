// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The scanner must itself catch what it claims to: each case below is a plausible way a write
// could slip into the package. (Mutation check: change a regex in scan.ts and a case here fails.)
import { describe, expect, it } from "vitest";
import { scan } from "./scan";

describe("the read-only scanner", () => {
  it.each([
    ["ServiceClient import", 'import { ServiceClient } from "@phoenix/service-kit";'],
    ["client.post call", "await client.post('/x', {}, parse);"],
    ["put", "client.put(url)"],
    ["method option", 'fetch(url, { method: "POST" })'],
    ["method option lowercase", "const init = { method: 'delete' };"],
    ["bare verb string", 'const verb = "PATCH";'],
    ["order verb", "function placeOrder() {}"],
    ["withdraw", "const withdrawAll = 1;"],
    ["transfer", "export const transfer = 1;"],
    ["swap", "async function swap() {}"],
    ["trade", "const trade = 1"],
    ["hidden after a string containing //", 'const s = "a // b"; client.post("/x", {}, parse);'],
    ["a comment that names a forbidden thing", "// TODO: withdraw support\nconst a = 1;"],
    ["raw fetch", "await fetch(url);"],
    ["node http", 'import { request } from "node:https";'],
  ])("flags %s", (_name, code) => {
    expect(scan("x.ts", code).length).toBeGreaterThan(0);
  });

  it.each([
    [
      "a GET through ReadOnlyClient",
      'import { ReadOnlyClient } from "@phoenix/service-kit";\nclient.get("/x", parse);',
    ],
    ["method GET", 'const init = { method: "GET" };'],
    ["a URL with // inside a string", 'const u = "https://x.example/a";'],
  ])("does not flag %s", (_name, code) => {
    expect(scan("x.ts", code)).toEqual([]);
  });
});
