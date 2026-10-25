// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import vectorsJson from "./fixtures/browser-policy-vectors.json";
import {
  RequestBlocker,
  STARTER_RULES,
  parseFilterRule,
  type ResourceType,
} from "../src/core/browser/blocklist";
import { BrowserGuard, type BrowserAuditEvent } from "../src/core/browser/guard";
import { classifyHost } from "../src/core/browser/network";
import {
  DEFAULT_NAVIGATION_POLICY,
  decideNavigation,
  resolveOmnibox,
  type NavigationIntent,
  type NavigationPolicy,
} from "../src/core/browser/navigation";
import { SitePermissions } from "../src/core/browser/permissions";
import {
  DEFAULT_BLOCKING_EXEMPT_SITES,
  PRIVATE_PROFILE,
  webviewSettings,
} from "../src/core/browser/profile";
import { isThirdParty, registrableDomain } from "../src/core/browser/site";

function reasonOf(
  input: string,
  policy?: Partial<NavigationPolicy>,
  intent: NavigationIntent = "link",
) {
  const decision = decideNavigation(input, { ...DEFAULT_NAVIGATION_POLICY, ...policy }, intent);
  return decision.allow ? "allow" : decision.reason;
}

describe("host classification", () => {
  it.each([
    "127.0.0.1",
    "127.1",
    "2130706433",
    "0x7f.0.0.1",
    "0177.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "[::1]",
    "[::]",
    "[::ffff:127.0.0.1]",
    "[::ffff:7f00:1]",
    "[fe80::1]",
    "[fd00::1]",
    "[64:ff9b::a00:1]",
    "[2002:c0a8:101::]",
    "localhost",
    "foo.localhost",
    "printer.local",
    "router",
    "nas.lan",
    "localhost.",
  ])("treats %s as private", (host) => {
    expect(classifyHost(host).kind).toBe("private");
  });

  it.each([
    "example.com",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.0.1",
    "100.128.0.1",
    "[2606:4700::1111]",
  ])("treats %s as public", (host) => {
    expect(classifyHost(host).kind).toBe("public");
  });

  it("refuses malformed numeric hosts instead of passing them through", () => {
    expect(classifyHost("1.2.3.4.5").kind).toBe("private");
    expect(classifyHost("[1:2:3]").kind).toBe("private");
  });

  it("sees through the URL parser's own normalisation of obfuscated IPv4", () => {
    for (const url of ["http://2130706433/", "http://0x7f000001/", "http://017700000001/"]) {
      const host = new URL(url).hostname;
      expect(classifyHost(host)).toMatchObject({ kind: "private", reason: "loopback" });
    }
  });
});

describe("navigation policy", () => {
  it("allows plain https to a public host", () => {
    expect(decideNavigation("https://example.com/a?b=1")).toEqual({
      allow: true,
      url: "https://example.com/a?b=1",
      upgraded: false,
    });
  });

  it("upgrades http to https and drops an explicit port 80", () => {
    expect(decideNavigation("http://example.com:80/x")).toEqual({
      allow: true,
      url: "https://example.com/x",
      upgraded: true,
    });
    const kept = decideNavigation("http://example.com:8080/x");
    expect(kept).toMatchObject({ allow: true, url: "https://example.com:8080/x", upgraded: true });
  });

  it("refuses plain http when upgrading is off and http is not allowed", () => {
    expect(reasonOf("http://example.com/", { upgradeHttp: false })).toBe("insecure_blocked");
    expect(
      reasonOf("http://example.com/", { upgradeHttp: false, allowedSchemes: ["https", "http"] }),
    ).toBe("allow");
  });

  it("lets a listed site stay on http", () => {
    expect(
      decideNavigation("http://dev.example.org/", {
        ...DEFAULT_NAVIGATION_POLICY,
        insecureAllowedSites: ["example.org"],
      }),
    ).toMatchObject({ allow: true, upgraded: false, url: "http://dev.example.org/" });
  });

  it("blocks file: in every spelling", () => {
    for (const url of [
      "file:///etc/passwd",
      "FILE:///C:/Windows/win.ini",
      "file://server/share/x",
    ]) {
      expect(reasonOf(url)).toBe("file_blocked");
    }
    // Even a policy that lists "file" cannot enable it.
    expect(reasonOf("file:///etc/passwd", { allowedSchemes: ["https", "file"] })).toBe(
      "file_blocked",
    );
  });

  it("blocks code and internal schemes even when listed", () => {
    for (const scheme of [
      "javascript",
      "data",
      "blob",
      "tauri",
      "ipc",
      "asset",
      "about",
      "view-source",
    ]) {
      expect(reasonOf(`${scheme}:alert(1)`, { allowedSchemes: ["https", scheme] })).toBe(
        "dangerous_scheme",
      );
    }
    expect(reasonOf("  JavaScript:alert(1)")).toBe("dangerous_scheme");
  });

  it("refuses schemes outside the allow list", () => {
    for (const url of [
      "ftp://example.com/",
      "mailto:a@b.co",
      "ws://example.com/",
      "chrome://settings",
    ]) {
      expect(reasonOf(url)).toBe("scheme_not_allowed");
    }
  });

  it("refuses credentials in the URL, including empty-user and encoded forms", () => {
    for (const url of [
      "https://user:pass@example.com/",
      "https://user@example.com/",
      "https://:pass@example.com/",
      "https://example.com@evil.test/",
      "https://%75ser:%70ass@example.com/",
    ]) {
      expect(reasonOf(url)).toBe("credentials_in_url");
    }
    // The look-alike where the "host" is only a path segment is not credentials.
    expect(reasonOf("https://example.com/user@evil.test")).toBe("allow");
  });

  it("refuses credentials on an allowed custom scheme", () => {
    expect(reasonOf("phoenix-app://u:p@x/", { allowedSchemes: ["https", "phoenix-app"] })).toBe(
      "credentials_in_url",
    );
    expect(reasonOf("phoenix-app://x/", { allowedSchemes: ["https", "phoenix-app"] })).toBe(
      "allow",
    );
  });

  it("refuses unparseable and hostless input", () => {
    expect(reasonOf("")).toBe("unparseable");
    expect(reasonOf("not a url")).toBe("unparseable");
    expect(reasonOf("https://")).toBe("unparseable");
    expect(reasonOf("//example.com")).toBe("unparseable");
  });

  it("blocks the private network from links, redirects, subresources and popups", () => {
    for (const intent of ["link", "redirect", "subresource", "new_window"] as const) {
      for (const url of [
        "http://localhost:4870/",
        "https://127.0.0.1/",
        "http://192.168.0.1/",
        "http://[::1]/",
        "http://2130706433/",
        "http://169.254.169.254/latest/meta-data/",
        "https://printer.local/",
      ]) {
        expect(reasonOf(url, {}, intent)).toBe("private_network");
      }
    }
  });

  it("blocks the private network when typed too, unless that site is explicitly listed", () => {
    expect(reasonOf("http://localhost:3000/", {}, "typed")).toBe("private_network");
    const policy = { privateNetworkAllowedSites: ["localhost"] };
    expect(reasonOf("http://localhost:3000/", policy, "typed")).toBe("allow");
    // Listing a site still never lets a page link there.
    expect(reasonOf("http://localhost:3000/", policy, "link")).toBe("private_network");
    // Another private host stays blocked.
    expect(reasonOf("http://192.168.1.1/", policy, "typed")).toBe("private_network");
  });

  it("does not upgrade a listed private host to https", () => {
    expect(
      decideNavigation(
        "http://localhost:3000/",
        { ...DEFAULT_NAVIGATION_POLICY, privateNetworkAllowedSites: ["localhost"] },
        "typed",
      ),
    ).toMatchObject({ allow: true, upgraded: false, url: "http://localhost:3000/" });
  });

  it("reports why a private host was refused", () => {
    expect(decideNavigation("http://10.1.2.3/")).toMatchObject({
      allow: false,
      reason: "private_network",
      privateReason: "private_range",
    });
  });

  it("blocks ports that reach non-HTTP daemons", () => {
    expect(reasonOf("https://example.com:22/")).toBe("bad_port");
    expect(reasonOf("https://example.com:6667/")).toBe("bad_port");
    expect(reasonOf("https://example.com:8443/")).toBe("allow");
  });

  it("denies listed sites and their subdomains, not look-alikes", () => {
    const policy = { deniedSites: ["evil.test"] };
    expect(reasonOf("https://evil.test/", policy)).toBe("site_denied");
    expect(reasonOf("https://a.b.evil.test/", policy)).toBe("site_denied");
    expect(reasonOf("https://notevil.test/", policy)).toBe("allow");
    expect(reasonOf("https://evil.test.example.com/", policy)).toBe("allow");
  });
});

describe("address bar", () => {
  it("turns host-like text into https and everything else into a search", () => {
    expect(resolveOmnibox("example.com/path")).toEqual({
      kind: "navigate",
      url: "https://example.com/path",
    });
    expect(resolveOmnibox("localhost:3000")).toEqual({
      kind: "navigate",
      url: "https://localhost:3000",
    });
    expect(resolveOmnibox("https://example.com")).toEqual({
      kind: "navigate",
      url: "https://example.com",
    });
    expect(resolveOmnibox("how do I fix a.b error")).toMatchObject({ kind: "search" });
    const search = resolveOmnibox("a&b=c d");
    expect(search).toEqual({
      kind: "search",
      query: "a&b=c d",
      url: "https://duckduckgo.com/?q=a%26b%3Dc%20d",
    });
    expect(resolveOmnibox("   ")).toBeNull();
  });

  it("passes dangerous schemes through so the policy, not the omnibox, refuses them", () => {
    const typed = resolveOmnibox("javascript:alert(1)");
    expect(typed).toEqual({ kind: "navigate", url: "javascript:alert(1)" });
    expect(reasonOf(typed?.url ?? "", {}, "typed")).toBe("dangerous_scheme");
    const file = resolveOmnibox("file:///etc/passwd");
    expect(reasonOf(file?.url ?? "", {}, "typed")).toBe("file_blocked");
  });
});

describe("registrable domain", () => {
  it("handles common public suffixes and IP literals", () => {
    expect(registrableDomain("www.example.com")).toBe("example.com");
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("alice.github.io")).toBe("alice.github.io");
    expect(registrableDomain("1.2.3.4")).toBe("1.2.3.4");
    expect(registrableDomain("localhost")).toBe("localhost");
    expect(isThirdParty("cdn.example.com", "www.example.com")).toBe(false);
    expect(isThirdParty("bob.github.io", "alice.github.io")).toBe(true);
    // A property name on Object.prototype must not read as a known suffix.
    expect(registrableDomain("a.b.constructor")).toBe("b.constructor");
  });
});

describe("filter rules", () => {
  const blocker = (...lines: string[]) => {
    const b = new RequestBlocker();
    b.load(lines.join("\n"));
    return b;
  };
  const req = (url: string, documentUrl = "https://site.test/", type: ResourceType = "script") => ({
    url,
    documentUrl,
    type,
  });

  it("matches a host anchor on the host and its subdomains, not look-alikes", () => {
    const b = blocker("||ads.example^");
    expect(b.match(req("https://ads.example/x.js")).blocked).toBe(true);
    expect(b.match(req("https://eu.ads.example/x.js")).blocked).toBe(true);
    expect(b.match(req("https://badads.example/x.js")).blocked).toBe(false);
    expect(b.match(req("https://ads.example.evil.test/x.js")).blocked).toBe(false);
    expect(b.match(req("https://evil.test/?u=ads.example")).blocked).toBe(false);
  });

  it("applies the separator caret and wildcards", () => {
    const b = blocker("||t.test/pixel^", "/banner/*/img^");
    expect(b.match(req("https://t.test/pixel?x=1", "https://s.test/", "image")).blocked).toBe(true);
    expect(b.match(req("https://t.test/pixel.gif", "https://s.test/", "image")).blocked).toBe(
      false,
    );
    expect(
      b.match(req("https://x.test/banner/300/img/a.png", "https://s.test/", "image")).blocked,
    ).toBe(true);
  });

  it("honours $third-party and its negation", () => {
    const b = blocker("||cdn.test^$third-party");
    expect(b.match(req("https://cdn.test/a.js", "https://other.test/")).blocked).toBe(true);
    expect(b.match(req("https://cdn.test/a.js", "https://www.cdn.test/")).blocked).toBe(false);
    const first = blocker("||cdn.test^$~third-party");
    expect(first.match(req("https://cdn.test/a.js", "https://cdn.test/")).blocked).toBe(true);
    expect(first.match(req("https://cdn.test/a.js", "https://other.test/")).blocked).toBe(false);
  });

  it("restricts by resource type and never blocks documents by default", () => {
    const b = blocker("||t.test^", "||img.test^$image");
    expect(b.match(req("https://t.test/", "https://t.test/", "document")).blocked).toBe(false);
    expect(b.match(req("https://img.test/a", "https://s.test/", "script")).blocked).toBe(false);
    expect(b.match(req("https://img.test/a", "https://s.test/", "image")).blocked).toBe(true);
    const doc = blocker("||bad.test^$document");
    expect(doc.match(req("https://bad.test/", "https://bad.test/", "document")).blocked).toBe(true);
    const not = blocker("||t.test^$~script");
    expect(not.match(req("https://t.test/a", "https://s.test/", "script")).blocked).toBe(false);
    expect(not.match(req("https://t.test/a", "https://s.test/", "image")).blocked).toBe(true);
  });

  it("restricts by domain= option", () => {
    const b = blocker("||t.test^$domain=news.test|~live.news.test");
    expect(b.match(req("https://t.test/a", "https://news.test/")).blocked).toBe(true);
    expect(b.match(req("https://t.test/a", "https://live.news.test/")).blocked).toBe(false);
    expect(b.match(req("https://t.test/a", "https://other.test/")).blocked).toBe(false);
  });

  it("lets an exception rule win and reports it", () => {
    const b = blocker("||ads.test^", "@@||ads.test/ok.js^$domain=good.test");
    const allowed = b.match(req("https://ads.test/ok.js", "https://good.test/"));
    expect(allowed).toEqual({
      blocked: false,
      rule: "@@||ads.test/ok.js^$domain=good.test",
      excepted: true,
    });
    expect(b.match(req("https://ads.test/ok.js", "https://bad.test/")).blocked).toBe(true);
  });

  it("is case-insensitive on URLs", () => {
    expect(blocker("||ads.test/Banner").match(req("https://ADS.test/BANNER.js")).blocked).toBe(
      true,
    );
  });

  it("counts what it cannot enforce instead of silently widening it", () => {
    const b = new RequestBlocker();
    b.load(
      [
        "[Adblock Plus 2.0]",
        "! Title: test",
        "",
        "example.com##.ad-banner",
        "example.com#@#.ad",
        "##+js(set, x, 1)",
        "/ads\\d+/",
        "||t.test^$important",
        "||t.test^$redirect=noop.js",
        "||ok.test^",
        "@@||fine.test^",
      ].join("\n"),
    );
    expect(b.report).toEqual({ rules: 2, exceptions: 1, cosmetic: 3, unsupported: 3, ignored: 3 });
    expect(b.match(req("https://t.test/a")).blocked).toBe(false);
    expect(b.ruleCount).toBe(2);
  });

  it("rejects oversized and wildcard-heavy rules", () => {
    expect(parseFilterRule("||" + "a".repeat(600) + "^")).toBeNull();
    expect(parseFilterRule("/" + "*/".repeat(20))).toBeNull();
  });

  it("stays linear on a hostile URL against a wildcard rule", () => {
    const b = blocker("*a*a*a*a*a*a*a*a*b");
    const started = performance.now();
    b.match(req("https://x.test/" + "a".repeat(5000)));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("ignores requests whose URLs cannot be parsed", () => {
    expect(
      blocker("||ads.test^").match({ url: "nope", documentUrl: "https://s.test/", type: "script" }),
    ).toEqual({ blocked: false, rule: null, excepted: false });
  });

  it("starter rules block known ad hosts and leave an ordinary site alone", () => {
    const b = new RequestBlocker();
    b.load(STARTER_RULES);
    expect(b.match(req("https://securepubads.g.doubleclick.net/tag.js")).blocked).toBe(true);
    expect(
      b.match(req("https://www.google-analytics.com/collect", "https://site.test/", "xhr")).blocked,
    ).toBe(true);
    expect(
      b.match(req("https://www.googletagmanager.com/gtm.js", "https://www.googletagmanager.com/"))
        .blocked,
    ).toBe(false);
    expect(b.match(req("https://cdn.site.test/app.js")).blocked).toBe(false);
  });
});

describe("site permissions", () => {
  const site = "https://example.com";
  const ask = (permissions: SitePermissions, kind: string, frame = site, top = site) =>
    permissions.decide({ kind, topOrigin: top, frameOrigin: frame });

  it("denies every kind by default", () => {
    const p = new SitePermissions();
    for (const kind of [
      "microphone",
      "camera",
      "geolocation",
      "notifications",
      "midi",
      "autoplay",
      "other",
    ]) {
      expect(ask(p, kind)).toEqual({ verdict: "deny", reason: expect.any(String) });
    }
    expect(ask(p, "microphone").reason).toBe("default_deny");
  });

  it("denies unknown kinds even when asked to grant them", () => {
    const p = new SitePermissions();
    expect(p.grant(site, "teleport", true).reason).toBe("unknown_kind");
    expect(ask(p, "teleport").reason).toBe("unknown_kind");
  });

  it("ignores grants that do not come from a user gesture", () => {
    const p = new SitePermissions();
    expect(p.grant(site, "camera", false)).toEqual({ verdict: "deny", reason: "no_user_gesture" });
    expect(ask(p, "camera").verdict).toBe("deny");
    expect(p.list()).toEqual([]);
  });

  it("grants one origin one kind for the session and nothing wider", () => {
    const p = new SitePermissions();
    expect(p.grant(site, "microphone", true).verdict).toBe("allow");
    expect(ask(p, "microphone").verdict).toBe("allow");
    expect(ask(p, "camera").verdict).toBe("deny");
    expect(ask(p, "microphone", "https://www.example.com", "https://www.example.com").verdict).toBe(
      "deny",
    );
    expect(ask(p, "microphone", "https://ads.test", site)).toEqual({
      verdict: "deny",
      reason: "cross_origin_frame",
    });
    p.revoke(site, "microphone");
    expect(ask(p, "microphone").verdict).toBe("deny");
  });

  it("never grants screen capture, file access, clipboard reads or auto-downloads", () => {
    const p = new SitePermissions();
    for (const kind of [
      "display-capture",
      "file-system-access",
      "clipboard-read",
      "automatic-downloads",
    ]) {
      expect(p.grant(site, kind, true).reason).toBe("never_grantable");
      expect(ask(p, kind).verdict).toBe("deny");
    }
  });

  it("refuses insecure and private origins", () => {
    const p = new SitePermissions();
    expect(p.grant("http://example.com", "camera", true).reason).toBe("insecure_origin");
    expect(p.grant("https://localhost", "camera", true).reason).toBe("private_origin");
    expect(p.grant("https://192.168.0.2", "camera", true).reason).toBe("private_origin");
    expect(p.grant("not a url", "camera", true).reason).toBe("insecure_origin");
    expect(ask(p, "camera", "http://example.com", "http://example.com").reason).toBe(
      "insecure_origin",
    );
    expect(ask(p, "camera", "garbage", "garbage").reason).toBe("insecure_origin");
  });

  it("forgets everything on clear", () => {
    const p = new SitePermissions();
    p.grant(site, "geolocation", true);
    p.grant("https://other.test", "camera", true);
    expect(p.list()).toHaveLength(2);
    p.clear();
    expect(p.list()).toEqual([]);
    expect(ask(p, "geolocation").verdict).toBe("deny");
  });
});

describe("browser profile", () => {
  it("is private, ask-first and telemetry-free by default", () => {
    expect(PRIVATE_PROFILE).toMatchObject({
      persistence: "none",
      thirdPartyCookies: false,
      httpsUpgrade: true,
      telemetry: false,
      downloads: "ask",
    });
    expect(webviewSettings(PRIVATE_PROFILE)).toEqual({
      incognito: true,
      dataDirectory: null,
      permissionRequests: "policy",
      navigation: "policy",
      downloads: "ask",
      devtools: false,
      ipcForRemotePages: false,
    });
  });

  it("exempts YouTube from blocking by default and says which hosts", () => {
    expect(DEFAULT_BLOCKING_EXEMPT_SITES).toContain("youtube.com");
  });
});

describe("browser guard", () => {
  function setup(options: ConstructorParameters<typeof BrowserGuard>[0] = {}) {
    const events: BrowserAuditEvent[] = [];
    const blocker = new RequestBlocker();
    blocker.load("||ads.test^\n||youtube-ads.test^");
    const guard = new BrowserGuard({
      blocker,
      audit: { record: (e) => events.push(e) },
      ...options,
    });
    return { guard, events };
  }
  const script = (url: string, documentUrl: string) => ({
    url,
    documentUrl,
    type: "script" as const,
  });

  it("counts blocked requests per tab and resets the count on a new page", () => {
    const { guard } = setup();
    expect(guard.request("t1", script("https://ads.test/a.js", "https://news.test/")).blocked).toBe(
      true,
    );
    guard.request("t1", script("https://ads.test/b.js", "https://news.test/"));
    guard.request("t2", script("https://ads.test/b.js", "https://news.test/"));
    guard.request("t1", script("https://cdn.test/ok.js", "https://news.test/"));
    expect(guard.blockedCount("t1")).toBe(2);
    expect(guard.blockedCount("t2")).toBe(1);
    guard.navigate("t1", "https://other.test/", "typed");
    expect(guard.blockedCount("t1")).toBe(0);
    guard.request("t1", script("https://ads.test/c.js", "https://other.test/"));
    // A redirect inside the same load does not reset the count.
    guard.navigate("t1", "https://other.test/next", "redirect");
    expect(guard.blockedCount("t1")).toBe(1);
    // A refused navigation does not either.
    guard.navigate("t1", "file:///etc/passwd", "typed");
    expect(guard.blockedCount("t1")).toBe(1);
  });

  it("does not block on sites exempt by profile, and a per-site toggle overrides in both directions", () => {
    const { guard } = setup();
    const onYoutube = script("https://youtube-ads.test/a.js", "https://www.youtube.com/watch");
    expect(guard.request("t", onYoutube)).toMatchObject({
      blocked: false,
      exempt: "profile_default",
    });
    guard.setSiteBlocking("youtube.com", true);
    expect(guard.request("t", onYoutube).blocked).toBe(true);
    guard.setSiteBlocking("news.test", false);
    const onNews = script("https://ads.test/a.js", "https://news.test/");
    expect(guard.request("t", onNews)).toMatchObject({ blocked: false, exempt: "site_toggle" });
    // The more specific toggle wins.
    guard.setSiteBlocking("live.news.test", true);
    expect(
      guard.request("t", script("https://ads.test/a.js", "https://live.news.test/")).blocked,
    ).toBe(true);
    expect(guard.request("t", onNews).blocked).toBe(false);
  });

  it("audits navigation by host only, never path or query", () => {
    const { guard, events } = setup();
    guard.navigate("t", "https://example.com/reset?token=abc123", "typed");
    guard.navigate("t", "http://example.org/x?secret=1", "link");
    guard.navigate("t", "http://localhost:4870/api?session=s", "link");
    expect(events).toEqual([
      { type: "navigation", tab: "t", host: "example.com", allowed: true, reason: "allowed" },
      { type: "navigation", tab: "t", host: "example.org", allowed: true, reason: "https_upgrade" },
      {
        type: "navigation",
        tab: "t",
        host: "localhost",
        allowed: false,
        reason: "private_network",
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/token|secret|session=|abc123/);
  });

  it("audits blocked requests and permission answers", () => {
    const { guard, events } = setup();
    guard.request("t", script("https://ads.test/a.js?uid=42", "https://news.test/"));
    guard.permission("t", {
      kind: "camera",
      topOrigin: "https://news.test",
      frameOrigin: "https://news.test",
    });
    expect(events).toEqual([
      { type: "request_blocked", tab: "t", host: "ads.test", rule: "||ads.test^" },
      {
        type: "permission",
        tab: "t",
        origin: "https://news.test",
        kind: "camera",
        verdict: "deny",
        reason: "default_deny",
      },
    ]);
  });

  it("keeps no state after end()", () => {
    const { guard } = setup();
    guard.permissions.grant("https://news.test", "camera", true);
    guard.setSiteBlocking("news.test", false);
    guard.request("t", script("https://ads.test/a.js", "https://other.test/"));
    guard.end();
    expect(guard.permissions.list()).toEqual([]);
    expect(guard.blockedCount("t")).toBe(0);
    expect(guard.request("t", script("https://ads.test/a.js", "https://news.test/")).blocked).toBe(
      true,
    );
  });

  it("applies caller navigation overrides on top of the safe defaults", () => {
    const { guard } = setup({ navigation: { deniedSites: ["bad.test"] } });
    expect(guard.navigate("t", "https://bad.test/", "link")).toMatchObject({
      allow: false,
      reason: "site_denied",
    });
    expect(guard.navigate("t", "http://192.168.1.1/", "link")).toMatchObject({ allow: false });
  });
});

// The Rust enforcement port (apps/desktop/src-tauri/src/browser_policy.rs) reads this same file.
describe("shared policy vectors (also run by the Rust port)", () => {
  type Expectation =
    | { allow: true; url: string; upgraded: boolean }
    | { allow: false; reason: string; privateReason?: string };
  const vectors = vectorsJson as unknown as {
    classify: { private: string[]; public: string[]; reasons: Record<string, string> };
    navigation: {
      input: string;
      intent?: NavigationIntent;
      policy?: Partial<NavigationPolicy>;
      expect: Expectation;
    }[];
    permissions: {
      name: string;
      grants: { origin: string; kind: string; gesture: boolean }[];
      ask: { kind: string; top: string; frame: string };
      expect: { verdict: string; reason: string };
    }[];
    registrable: [string, string][];
  };

  it("classifies hosts", () => {
    for (const host of vectors.classify.private) {
      expect(classifyHost(host).kind, host).toBe("private");
    }
    for (const host of vectors.classify.public) {
      expect(classifyHost(host).kind, host).toBe("public");
    }
    for (const [host, reason] of Object.entries(vectors.classify.reasons)) {
      expect(classifyHost(host), host).toEqual({ kind: "private", reason });
    }
  });

  it("decides navigation", () => {
    for (const v of vectors.navigation) {
      const decision = decideNavigation(
        v.input,
        { ...DEFAULT_NAVIGATION_POLICY, ...v.policy },
        v.intent ?? "link",
      );
      expect(decision, v.input).toEqual(v.expect);
    }
  });

  it("decides permissions", () => {
    for (const v of vectors.permissions) {
      const p = new SitePermissions();
      for (const g of v.grants) p.grant(g.origin, g.kind, g.gesture);
      expect(
        p.decide({ kind: v.ask.kind, topOrigin: v.ask.top, frameOrigin: v.ask.frame }),
        v.name,
      ).toEqual(v.expect);
    }
  });

  it("finds registrable domains", () => {
    for (const [host, site] of vectors.registrable)
      expect(registrableDomain(host), host).toBe(site);
  });
});
