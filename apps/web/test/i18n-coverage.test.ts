// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// "Every UI string is translatable" (Phase 70): fails when a component writes English straight into
// its markup instead of using t(). The scanner is test/i18n-scan.ts; what is allowed to stay as
// written (brand names, units, code) is listed with reasons in test/i18n-allowlist.json.
//
// To add text to a component: put it in src/i18n/en/<namespace>.ts (and all nine other locales)
// and use useT(). A literal that must stay as written needs a reason in the allow-list.
import { describe, expect, it } from "vitest";
import allowlist from "./i18n-allowlist.json";
import { scanSource, unlisted, type Allowlist, type Finding } from "./i18n-scan";

const allow: Allowlist = allowlist;

// Every component, as raw text. Keys look like "../src/components/Navbar.tsx".
const sources = import.meta.glob("../src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const files = Object.entries(sources).map(([path, source]) => ({
  rel: path.replace(/^\.\.\//, ""),
  source,
}));

const show = (rel: string, found: Finding[]) =>
  found.map((f) => `${rel}:${f.line} [${f.kind}] "${f.text}"`).join("\n");

describe("i18n coverage: no hard-coded English in any component", () => {
  it("every component is free of hard-coded text", () => {
    const failures = files.flatMap((f) =>
      unlisted(allow, f.rel, f.source).map((x) => show(f.rel, [x])),
    );
    expect(
      failures,
      `Use t() (see src/i18n/README.md) or add a reason to i18n-allowlist.json:\n${failures.join("\n")}`,
    ).toEqual([]);
  });

  it("scans the whole app, not an empty set", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.rel === "src/components/Settings.tsx")).toBe(true);
    expect(files.some((f) => f.rel === "src/pill/PillApp.tsx")).toBe(true);
  });
});

describe("i18n scanner", () => {
  const scan = (source: string) => scanSource("x.tsx", source).map((f) => [f.kind, f.text]);

  it("finds JSX text, text attributes, message props and message calls", () => {
    expect(
      scan(`export const A = () => (
        <div title="Close the panel" aria-label={"Open " + "menu"} data-x="no letters 1">
          Hello <b>there</b>
          <input placeholder="Search" alt={flag ? "On" : "Off"} />
          <Feedback error="It broke" saved={ok && "Saved"} />
          {busy ? "Working…" : null}
          <button onClick={() => alert("Sure?")} />
        </div>
      );`),
    ).toEqual([
      ["attribute", "Close the panel"],
      ["attribute", "Open"],
      ["attribute", "menu"],
      ["jsx-text", "Hello"],
      ["jsx-text", "there"],
      ["attribute", "Search"],
      ["attribute", "On"],
      ["attribute", "Off"],
      ["message-prop", "It broke"],
      ["message-prop", "Saved"],
      ["jsx-text", "Working…"],
      ["message-call", "Sure?"],
    ]);
  });

  it("ignores what a person never reads or that has no letters", () => {
    expect(
      scan(`import x from "some text";
        // Hello in a comment
        export const A = ({ t }) => (
          <div className="card wide" id="main" role="status" data-testid="Thing">
            {t("shell.nav.home")}
            {count} / {total}
            <span aria-hidden="true">·</span> 42 %
            <a href="#/settings" title={t("shell.nav.settings")} />
          </div>
        );`),
    ).toEqual([]);
  });

  it("respects the allow-list for a file and for every file", () => {
    const allowed: Allowlist = {
      "*": [{ text: "Phoenix", reason: "brand" }],
      "a.tsx": [{ text: "Hello", reason: "test" }],
    };
    const source = "export const A = () => <p>Phoenix <b>Hello</b></p>;";
    expect(unlisted(allowed, "a.tsx", source)).toEqual([]);
    expect(unlisted(allowed, "b.tsx", source).map((f) => f.text)).toEqual(["Hello"]);
  });

  it("fails on a raw English string added to a converted component (mutation check)", () => {
    const navbar = files.find((f) => f.rel === "src/components/Navbar.tsx")!;
    expect(unlisted(allow, navbar.rel, navbar.source)).toEqual([]);
    const mutated = navbar.source.replace(
      "</header>",
      "<p>Untranslated English sentence</p></header>",
    );
    expect(mutated).not.toBe(navbar.source);
    expect(unlisted(allow, navbar.rel, mutated).map((f) => f.text)).toEqual([
      "Untranslated English sentence",
    ]);
  });
});
