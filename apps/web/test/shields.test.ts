// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shields (Phase 93): the per-site and global switches, the counts, the YouTube exemption read from
// the music connector policy, and a request matcher that stays fast on a large or hostile list.
// The lists used here are synthetic; nothing is downloaded from easylist.to.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_RULES,
  RequestBlocker,
  STARTER_RULES,
  type RequestInfo,
  type ResourceType,
} from "../src/core/browser/blocklist";
import { BrowserGuard } from "../src/core/browser/guard";
import { Shields, MAX_COUNTED_SITES, type ShieldsMusicSite } from "../src/core/browser/shields";

const req = (url: string, documentUrl = "https://news.test/", type: ResourceType = "script") =>
  ({ url, documentUrl, type }) satisfies RequestInfo;

const YOUTUBE_ON: ShieldsMusicSite = {
  hosts: ["youtube.com", "www.youtube.com", "music.youtube.com"],
  adBlocking: "exempt",
};
const YOUTUBE_OFF: ShieldsMusicSite = { ...YOUTUBE_ON, adBlocking: "normal" };

describe("shields model", () => {
  const lists = [{ id: "easylist", text: "||ads.test^\n||tracker.test^$third-party" }];

  it("blocks from the enabled list text and counts per site, keeping only the host", () => {
    const shields = new Shields({ lists });
    expect(shields.source).toBe("lists");
    expect(shields.ruleCount).toBe(2);
    const verdict = shields.decide(req("https://ads.test/a.js?uid=42&email=a@b.c"));
    expect(verdict).toMatchObject({ blocked: true, exempt: null, rule: "||ads.test^" });
    shields.recordBlocked("www.news.test");
    shields.recordBlocked("m.news.test");
    shields.recordBlocked("other.test");
    expect(shields.blockedOnSite("news.test")).toBe(2);
    expect(shields.blockedOnSite("deep.sub.news.test")).toBe(2);
    expect(shields.blockedOnSite("other.test")).toBe(1);
    expect(shields.blockedTotal).toBe(3);
    expect(shields.topSites()).toEqual([
      { site: "news.test", blocked: 2 },
      { site: "other.test", blocked: 1 },
    ]);
    // Counts hold host names and numbers only.
    expect(JSON.stringify(shields.topSites())).not.toMatch(/uid|email|https?:|\//);
    shields.resetCounts();
    expect(shields.blockedTotal).toBe(0);
    expect(shields.topSites()).toEqual([]);
  });

  it("falls back to the starter rules only when no list contributed a rule", () => {
    expect(new Shields().source).toBe("starter");
    expect(new Shields({ lists: [{ id: "easylist", text: "! Title: empty\n" }] }).source).toBe(
      "starter",
    );
    const starter = new Shields();
    expect(starter.ruleCount).toBe(
      new RequestBlocker().report.rules + STARTER_RULES.split("\n").length,
    );
    expect(starter.decide(req("https://securepubads.g.doubleclick.net/t.js")).blocked).toBe(true);
    // A loaded list replaces the starter rules rather than adding to them.
    const loaded = new Shields({ lists });
    expect(loaded.decide(req("https://securepubads.g.doubleclick.net/t.js")).blocked).toBe(false);
  });

  it("the global switch turns everything off and on", () => {
    const shields = new Shields({ lists });
    const ad = req("https://ads.test/a.js");
    shields.setEnabled(false);
    expect(shields.decide(ad)).toMatchObject({ blocked: false, exempt: "shields_off" });
    shields.setEnabled(true);
    expect(shields.decide(ad).blocked).toBe(true);
    const off = new Shields({ lists, settings: { enabled: false, offSites: [] } });
    expect(off.decide(ad).exempt).toBe("shields_off");
  });

  it("a per-site switch covers the site and its subdomains, and the most specific entry wins", () => {
    const shields = new Shields({ lists });
    shields.setSiteBlocking("News.Test", false);
    expect(shields.offSites).toEqual(["news.test"]);
    expect(shields.decide(req("https://ads.test/a.js", "https://www.news.test/")).exempt).toBe(
      "site_off",
    );
    expect(shields.decide(req("https://ads.test/a.js", "https://notnews.test/")).blocked).toBe(
      true,
    );
    expect(
      shields.decide(req("https://ads.test/a.js", "https://news.test.evil.test/")).blocked,
    ).toBe(true);
    shields.setSiteBlocking("news.test", true);
    expect(shields.offSites).toEqual([]);
    expect(shields.decide(req("https://ads.test/a.js")).blocked).toBe(true);
    const preset = new Shields({
      lists,
      settings: { enabled: true, offSites: ["Live.News.test"] },
    });
    expect(preset.blockingEnabled("live.news.test")).toBe(false);
    expect(preset.blockingEnabled("news.test")).toBe(true);
  });

  it("leaves YouTube's own ads alone exactly while the connector policy says exempt", () => {
    const off = new Shields({ lists, music: [YOUTUBE_OFF] });
    const on = new Shields({ lists, music: [YOUTUBE_ON] });
    const none = new Shields({ lists });
    const page = "https://www.youtube.com/watch?v=x";
    expect(on.decide(req("https://ads.test/a.js", page))).toMatchObject({
      blocked: false,
      exempt: "site_ads_exempt",
    });
    expect(off.decide(req("https://ads.test/a.js", page)).blocked).toBe(true);
    expect(none.decide(req("https://ads.test/a.js", page)).blocked).toBe(true);
    // Only the hosts the policy names, not subdomains or look-alikes of them.
    expect(on.decide(req("https://ads.test/a.js", "https://evil.youtube.com.test/")).blocked).toBe(
      true,
    );
    expect(on.decide(req("https://ads.test/a.js", "https://studio.youtube.com/")).blocked).toBe(
      true,
    );
    // Other sites are unaffected.
    expect(on.decide(req("https://ads.test/a.js")).blocked).toBe(true);
  });

  it("the guard uses the shields: counts, exemptions and audit stay host-only", () => {
    const events: unknown[] = [];
    const shields = new Shields({ lists, music: [YOUTUBE_ON] });
    const guard = new BrowserGuard({ shields, audit: { record: (e) => events.push(e) } });
    expect(guard.request("t", req("https://ads.test/a.js?token=abc")).blocked).toBe(true);
    expect(guard.blockedCount("t")).toBe(1);
    expect(shields.blockedOnSite("news.test")).toBe(1);
    expect(
      guard.request("t", req("https://ads.test/a.js", "https://www.youtube.com/")),
    ).toMatchObject({ blocked: false, exempt: "site_ads_exempt" });
    expect(guard.blockedCount("t")).toBe(1);
    // The old per-guard switches are not consulted when shields decide.
    guard.setSiteBlocking("news.test", false);
    expect(guard.request("t", req("https://ads.test/b.js")).blocked).toBe(true);
    shields.setSiteBlocking("news.test", false);
    expect(guard.request("t", req("https://ads.test/c.js"))).toMatchObject({
      blocked: false,
      exempt: "site_off",
    });
    expect(JSON.stringify(events)).not.toMatch(/token|abc/);
  });

  it("caps how many sites get a count of their own, not the total", () => {
    const shields = new Shields();
    for (let i = 0; i < MAX_COUNTED_SITES + 5; i++) shields.recordBlocked(`site${i}.example`);
    expect(shields.blockedTotal).toBe(MAX_COUNTED_SITES + 5);
    expect(shields.topSites(MAX_COUNTED_SITES + 10)).toHaveLength(MAX_COUNTED_SITES);
  });

  it("honours the rule cap across lists and reports what it dropped", () => {
    const rules = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `||${prefix}${i}.test^`).join("\n");
    const shields = new Shields({
      lists: [
        { id: "a", text: rules("a", 60) },
        { id: "b", text: rules("b", 60) },
      ],
      maxRules: 100,
    });
    expect(shields.ruleCount).toBe(100);
    expect(shields.blocker.droppedRules).toBe(20);
    expect(shields.decide(req("https://a59.test/x")).blocked).toBe(true);
    expect(shields.decide(req("https://b59.test/x")).blocked).toBe(false);
  });
});

describe("matcher without regular expressions", () => {
  const blocker = (...lines: string[]) => {
    const b = new RequestBlocker();
    b.load(lines.join("\n"));
    return b;
  };
  const blocked = (b: RequestBlocker, url: string, doc = "https://s.test/") =>
    b.match(req(url, doc)).blocked;

  it("anchors: || at any host label, | at the start and end of the URL", () => {
    const b = blocker("||ads.example.com^", "|https://exact.test/a|", "/path/only.js|");
    expect(blocked(b, "https://ads.example.com/x")).toBe(true);
    expect(blocked(b, "https://sub.ads.example.com/x")).toBe(true);
    expect(blocked(b, "https://xads.example.com/x")).toBe(false);
    expect(blocked(b, "https://example.com/?ads.example.com")).toBe(false);
    expect(blocked(b, "https://user:pw@ads.example.com/x")).toBe(true);
    expect(blocked(b, "https://exact.test/a")).toBe(true);
    expect(blocked(b, "https://exact.test/a?x")).toBe(false);
    expect(blocked(b, "https://z.test/path/only.js")).toBe(true);
    expect(blocked(b, "https://z.test/path/only.js?x=1")).toBe(false);
  });

  it("separator ^ matches punctuation and the end of the URL, not letters, digits, _ - . %", () => {
    const b = blocker("||t.test/pixel^", "/a^b/c");
    expect(blocked(b, "https://t.test/pixel")).toBe(true);
    expect(blocked(b, "https://t.test/pixel?x=1")).toBe(true);
    expect(blocked(b, "https://t.test/pixel/")).toBe(true);
    expect(blocked(b, "https://t.test/pixels")).toBe(false);
    expect(blocked(b, "https://t.test/pixel.gif")).toBe(false);
    expect(blocked(b, "https://t.test/pixel_x")).toBe(false);
    expect(blocked(b, "https://t.test/pixel%20")).toBe(false);
    expect(blocked(b, "https://q.test/a/b/c")).toBe(true);
    expect(blocked(b, "https://q.test/aXb/c")).toBe(false);
  });

  it("wildcards match pieces in order, case-insensitively", () => {
    const b = blocker("/banner/*/img*.png|", "||x.test/*/ad-*-v2");
    expect(blocked(b, "https://s.test/BANNER/300/IMG7.png")).toBe(true);
    expect(blocked(b, "https://s.test/banner/300/img7.png?x")).toBe(false);
    expect(blocked(b, "https://s.test/img7.png/banner/300")).toBe(false);
    expect(blocked(b, "https://x.test/a/ad-foo-v2")).toBe(true);
    expect(blocked(b, "https://x.test/a/ad-v2-foo")).toBe(false);
  });

  it("indexes by word without losing a rule: generic, in-word and anchored patterns", () => {
    const b = blocker("-ad-manager/$~stylesheet", "&adunit=", "/ads/banner.", "swfobject*.js");
    expect(blocked(b, "https://s.test/x-ad-manager/y")).toBe(true);
    expect(blocked(b, "https://s.test/x?a=1&adunit=3")).toBe(true);
    expect(blocked(b, "https://s.test/ads/banner.gif")).toBe(true);
    expect(blocked(b, "https://s.test/js/swfobject-2.js")).toBe(true);
    expect(blocked(b, "https://s.test/js/other.js")).toBe(false);
  });

  it("does not match a rule that is only anchors and wildcards", () => {
    const b = new RequestBlocker();
    b.load("*\n||*\n|\n**\n|*|");
    expect(b.ruleCount).toBe(0);
    expect(b.report.unsupported).toBe(5);
  });

  it("ignores cosmetic rules and says how many", () => {
    const b = blocker("example.org##.ad", "example.org#@#.ad", "||ok.test^");
    expect(b.report).toMatchObject({ rules: 1, cosmetic: 2 });
  });
});

/** A synthetic list shaped like a real one: mostly host rules, some path and wildcard rules. */
function syntheticList(targetBytes: number): { text: string; lines: number } {
  const lines: string[] = ["[Adblock Plus 2.0]", "! Title: Synthetic", "! Version: 1"];
  let bytes = lines.join("\n").length;
  let i = 0;
  while (bytes < targetBytes) {
    const n = i++;
    const rule =
      n % 10 < 6
        ? `||host${n}.ad-network${n % 977}.example^$third-party`
        : n % 10 < 8
          ? `/ads-${n}/banner*.js`
          : n % 10 < 9
            ? `||cdn${n}.example/track/${n}^$script,domain=a${n}.test|b${n}.test|~c${n}.test`
            : n % 20 === 9
              ? `@@||host${n - 9}.ad-network${(n - 9) % 977}.example/ok.js`
              : `&utm_${n}=`;
    lines.push(rule);
    bytes += rule.length + 1;
  }
  return { text: lines.join("\n"), lines: lines.length };
}

describe("matcher cost on a large list", () => {
  it("loads a ~2 MB list and answers 10,000 URLs within a generous bound", () => {
    const { text, lines } = syntheticList(2 * 1024 * 1024);
    expect(text.length).toBeGreaterThan(2 * 1024 * 1024);
    const blocker = new RequestBlocker();
    const loadStart = performance.now();
    blocker.load(text);
    const loadMs = performance.now() - loadStart;
    expect(blocker.ruleCount).toBeGreaterThan(lines * 0.9);
    expect(blocker.droppedRules).toBe(0);

    const urls: RequestInfo[] = [];
    for (let i = 0; i < 10_000; i++) {
      const kind = i % 5;
      urls.push(
        req(
          kind === 0
            ? `https://host${i}.ad-network${i % 977}.example/x.js`
            : kind === 1
              ? `https://static.site${i}.test/assets/app.${i}.js?v=${i}&session=${"z".repeat(40)}`
              : kind === 2
                ? `https://cdn${i}.example/track/${i}?a=1`
                : kind === 3
                  ? `https://www.example${i}.org/ads-${i}/banner-top.js`
                  : `https://img.site${i}.test/${"a".repeat(300)}/photo.jpg`,
          `https://a${i}.test/`,
        ),
      );
    }
    const start = performance.now();
    let blockedCount = 0;
    for (const r of urls) if (blocker.match(r).blocked) blockedCount++;
    const matchMs = performance.now() - start;
    expect(blockedCount).toBeGreaterThan(1000);
    expect(blockedCount).toBeLessThan(10_000);
    expect(blocker.budgetExhausted).toBe(0);
    // Measured on the development machine at a small fraction of these bounds; the bounds are loose
    // so a slow CI machine passes while a return to per-rule regex scanning (minutes) fails.
    expect(loadMs).toBeLessThan(20_000);
    expect(matchMs).toBeLessThan(10_000);
  }, 60_000);
});

describe("hostile lists", () => {
  const timed = (fn: () => void) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };

  it("repeated stars and separators in a rule cannot make matching exponential", () => {
    const b = new RequestBlocker();
    b.load(
      [
        "*a*a*a*a*a*a*a*a*b",
        "a*a*a*a*a*a*a*a^b",
        "^a^a^a^a^a^a^a^a^b",
        "*****a*****a*****a*****b",
        "a*a*a*a*a*a*a*a*a*a*a*a*b",
      ].join("\n"),
    );
    // The first rule has 9 stars and the last 12: both are refused outright (the cap is 8).
    expect(b.ruleCount).toBe(3);
    const url = "https://x.test/" + "a".repeat(2000) + "/";
    const ms = timed(() => {
      for (let i = 0; i < 50; i++) expect(b.match(req(url)).blocked).toBe(false);
    });
    expect(ms).toBeLessThan(3000);
    // And a URL that does match is still found.
    expect(b.match(req("https://x.test/aaaaaaaab")).blocked).toBe(true);
  });

  it("a thousand rules that each need a long scan are held to the per-request budget", () => {
    const b = new RequestBlocker();
    const rule = "*a*a*a*a*a*a*a*a*b";
    // Distinct rules (a different tail) so none is a duplicate, all unindexed.
    b.load(Array.from({ length: 1000 }, (_, i) => `${rule}${i}x`).join("\n"));
    const url = "https://x.test/" + "a".repeat(2000);
    const ms = timed(() => {
      for (let i = 0; i < 20; i++) b.match(req(url));
    });
    expect(ms).toBeLessThan(5000);
  });

  it("a request that would cost more than the budget is let through, counted, and the next one is judged afresh", () => {
    const b = new RequestBlocker();
    // Each rule scans every "a" of the URL before it fails; a thousand of them exceed the budget.
    b.load(Array.from({ length: 1000 }, (_, i) => `a^*a^*b${i}x`).join("\n") + "\n||late.test^");
    const hostile = "https://x.test/" + "a".repeat(2000);
    expect(b.match(req(hostile)).blocked).toBe(false);
    expect(b.budgetExhausted).toBe(1);
    // A cheap request is not affected by the earlier one.
    expect(b.match(req("https://late.test/x")).blocked).toBe(true);
    expect(b.budgetExhausted).toBe(1);
  });

  it("a huge pattern is dropped, a huge domain= list is dropped whole, a large one works", () => {
    const b = new RequestBlocker();
    const huge = "||" + "a".repeat(600) + "^";
    const regexy = "/(a+)+$/";
    const longDomains =
      "||t.test^$domain=" + Array.from({ length: 5000 }, (_, i) => `d${i}.test`).join("|");
    const manyDomains =
      "||m.test^$domain=" + Array.from({ length: 1500 }, (_, i) => `x${i}.t`).join("|");
    expect(manyDomains.length).toBeLessThan(16 * 1024);
    const someDomains =
      "||u.test^$domain=" + Array.from({ length: 1000 }, (_, i) => `d${i}.test`).join("|");
    b.load([huge, regexy, longDomains, manyDomains, someDomains].join("\n"));
    expect(b.ruleCount).toBe(1);
    expect(b.report.unsupported).toBe(4);
    expect(b.match(req("https://m.test/x", "https://x1.t/")).blocked).toBe(false);
    expect(b.match(req("https://u.test/x", "https://d999.test/")).blocked).toBe(true);
    expect(b.match(req("https://u.test/x", "https://d1000.test/")).blocked).toBe(false);
    // A dropped domain= rule must not turn into "block everywhere".
    expect(b.match(req("https://t.test/x", "https://d1.test/")).blocked).toBe(false);
    expect(b.match(req("https://t.test/x", "https://other.test/")).blocked).toBe(false);
  });

  it("domain= lookups cost the same for a thousand domains as for one", () => {
    const b = new RequestBlocker();
    const lists = Array.from({ length: 200 }, (_, i) => {
      const domains = Array.from({ length: 1000 }, (_, j) => `d${i}-${j}.test`).join("|");
      return `||t${i}.test^$domain=${domains}`;
    });
    b.load(lists.join("\n"));
    expect(b.ruleCount).toBe(200);
    const ms = timed(() => {
      for (let i = 0; i < 2000; i++)
        b.match(req(`https://t${i % 200}.test/x`, "https://d3-999.test/"));
    });
    expect(ms).toBeLessThan(3000);
  });

  it("stops at the rule cap, whatever the list holds", () => {
    expect(DEFAULT_MAX_RULES).toBe(300_000);
    const b = new RequestBlocker();
    const text = Array.from({ length: 1500 }, (_, i) => `||h${i}.test^`).join("\n");
    b.load(text, { maxRules: 1000 });
    expect(b.ruleCount).toBe(1000);
    expect(b.droppedRules).toBe(500);
    expect(b.match(req("https://h999.test/")).blocked).toBe(true);
    expect(b.match(req("https://h1000.test/")).blocked).toBe(false);
  });

  it("holds the rules that have neither a host nor a word to a fixed number", () => {
    const b = new RequestBlocker();
    // "/<digits>x" has no whole word to index by, so every such rule would be tried on every request.
    b.load(Array.from({ length: 26_000 }, (_, i) => `/${i}x`).join("\n"));
    expect(b.ruleCount).toBe(25_000);
    expect(b.droppedRules).toBe(1000);
  });

  it("keeps a bucket small: thousands of rules for one host do not all stay", () => {
    const b = new RequestBlocker();
    b.load(Array.from({ length: 5000 }, (_, i) => `||same.test/p${i}^`).join("\n"));
    expect(b.ruleCount).toBe(2000);
    expect(b.droppedRules).toBe(3000);
  });

  it("a very long URL is cut before matching and cannot cost more than a short one", () => {
    const b = new RequestBlocker();
    b.load("||t.test/end|\n/needle/x");
    const long = "https://t.test/" + "x".repeat(1_000_000);
    const ms = timed(() => {
      for (let i = 0; i < 20; i++) b.match(req(long));
    });
    expect(ms).toBeLessThan(2000);
    // A rule that must match the very end cannot be judged on a cut-off URL, so it does not block.
    expect(b.match(req("https://t.test/" + "x".repeat(5000) + "/end")).blocked).toBe(false);
    // Cut at 2,048 characters this URL ends in "/end"; it really ends in "zzz", so "/end|" must not match.
    const edge = "https://t.test/" + "x".repeat(2048 - 15 - 4) + "/end" + "zzz";
    const ends = new RequestBlocker();
    ends.load("/end|");
    expect(ends.match(req(edge)).blocked).toBe(false);
    expect(ends.match(req("https://t.test/a/end")).blocked).toBe(true);
    // Only the first 2,048 characters are examined: a needle after them is not seen (a stated limit).
    const late = new RequestBlocker();
    late.load("/needle/x");
    expect(late.match(req("https://t.test/" + "x".repeat(3000) + "/needle/x")).blocked).toBe(false);
    expect(late.match(req("https://t.test/" + "x".repeat(1000) + "/needle/x")).blocked).toBe(true);
    expect(b.match(req("https://t.test/end")).blocked).toBe(true);
    expect(b.match(req("https://q.test/needle/x" + "x".repeat(5000))).blocked).toBe(true);
  });
});
