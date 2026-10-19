// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  deployPhase,
  deploymentTracker,
  diffDeployments,
  parseCreated,
  parseDeployment,
  parseDeployments,
} from "../src";
import { deployment, REMOTE_MARKER } from "../testing/mock-vercel";

describe("parseDeployment", () => {
  it("reads the documented shape", () => {
    expect(parseDeployment(deployment())).toEqual({
      id: "dpl_ABC123",
      project: "web",
      state: "READY",
      target: "production",
      createdAt: Date.parse("2026-10-05T10:00:00Z"),
      url: "https://vercel.com/acme/web/dpl_ABC123",
      branch: "main",
      sha: "0123456789abcdef0123456789abcdef01234567",
      repository: "acme/web",
      actor: "ada",
    });
  });

  it("drops what is not safe: odd ids, non-https links, bad hashes, bad repository parts", () => {
    const d = parseDeployment(
      deployment({
        inspectorUrl: "javascript:alert(1)",
        url: "evil.example/path?x=1",
        meta: {
          githubOrg: "a/b",
          githubRepo: "web",
          githubCommitSha: "zz",
          githubCommitRef: "x".repeat(500),
        },
        target: "Pre View!",
      }),
    );
    expect(d?.url).toBeUndefined();
    expect(d?.sha).toBeUndefined();
    expect(d?.repository).toBeUndefined();
    expect(d?.target).toBe("preview");
    expect(d?.branch).toHaveLength(100);
  });

  it("falls back to the deployment host as an https link", () => {
    const d = parseDeployment(deployment({ inspectorUrl: undefined, url: "web-abc.vercel.app" }));
    expect(d?.url).toBe("https://web-abc.vercel.app/");
  });

  it.each([
    ["no id", { uid: undefined }],
    ["path-shaped id", { uid: "../../x" }],
    ["id with a pipe", { uid: "a|b" }],
    ["numeric id", { uid: 7 }],
    ["no project", { name: undefined }],
    ["no time", { created: undefined }],
    ["negative time", { created: -5 }],
    ["string time garbage", { created: "soon" }],
  ])("skips an entry with %s", (_name, over) => {
    expect(parseDeployment({ ...deployment(), ...over })).toBeUndefined();
  });

  it("an unknown state is kept as a word but maps to no event", () => {
    const d = parseDeployment(deployment({ state: "teleporting" }));
    expect(d?.state).toBe("TELEPORTING");
    expect(deployPhase(d!.state)).toBeUndefined();
    expect(deployPhase("constructor")).toBeUndefined();
  });
});

describe("parseDeployments", () => {
  it("skips broken entries but keeps the good ones", () => {
    const list = parseDeployments({
      deployments: [null, 5, "x", [], deployment({ uid: "dpl_ok" }), { uid: REMOTE_MARKER }],
    });
    expect(list.map((d) => d.id)).toEqual(["dpl_ok"]);
  });

  it("throws on a body of the wrong shape (the client reports it as an unexpected format)", () => {
    expect(() => parseDeployments(null)).toThrow();
    expect(() => parseDeployments([])).toThrow();
    expect(() => parseDeployments({ deployments: "nope" })).toThrow();
  });

  it("reads at most 100 entries", () => {
    const many = Array.from({ length: 150 }, (_v, i) => deployment({ uid: `dpl_${i}` }));
    expect(parseDeployments({ deployments: many })).toHaveLength(100);
  });
});

describe("parseCreated", () => {
  it("needs a usable id", () => {
    expect(parseCreated({ id: "dpl_N1", url: "web-n1.vercel.app", readyState: "queued" })).toEqual({
      id: "dpl_N1",
      state: "QUEUED",
      url: "https://web-n1.vercel.app/",
    });
    expect(() => parseCreated({ id: "a b" })).toThrow();
    expect(() => parseCreated("x")).toThrow();
  });
});

describe("diffDeployments (history rule)", () => {
  const live = Date.parse("2026-10-05T09:00:00Z");
  const old = (over = {}) => parseDeployment(deployment({ created: live - 86_400_000, ...over }))!;
  const fresh = (over = {}) => parseDeployment(deployment({ created: live + 1_000, ...over }))!;

  it("announces nothing for deployments that finished before the capability was enabled", () => {
    const t = deploymentTracker(live);
    expect(
      diffDeployments(t, [old({ state: "ERROR" }), old({ uid: "dpl_2", state: "READY" })]),
    ).toEqual([]);
  });

  it("a deployment that was building at startup still reports how it ended, once", () => {
    const t = deploymentTracker(live);
    expect(diffDeployments(t, [old({ state: "BUILDING" })])).toEqual([]);
    const done = diffDeployments(t, [old({ state: "READY" })]);
    expect(done.map((e) => e.event_type)).toEqual(["vercel.deploy.succeeded"]);
    expect(diffDeployments(t, [old({ state: "READY" })])).toEqual([]);
  });

  it("a new deployment is announced as it starts, then as it ends; unknown states say nothing", () => {
    const t = deploymentTracker(live);
    expect(diffDeployments(t, [fresh({ state: "QUEUED" })]).map((e) => e.event_type)).toEqual([
      "vercel.deploy.started",
    ]);
    expect(diffDeployments(t, [fresh({ state: "BUILDING" })])).toEqual([]);
    const failed = diffDeployments(t, [fresh({ state: "ERROR" })]);
    expect(failed).toMatchObject([
      {
        event_type: "vercel.deploy.failed",
        severity: "error",
        correlation_id: "vercel-deploy-dpl_ABC123",
      },
    ]);
    expect(failed[0]!.payload).toMatchObject({
      deployment_id: "dpl_ABC123",
      project: "web",
      environment: "production",
      repository: "acme/web",
    });
    expect(diffDeployments(t, [fresh({ state: "WHATEVER" })])).toEqual([]);
  });
});
