// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestRef } from "../src/approvals";
import { parseAgentApprovals, parseConfirmations } from "../src/model";
import { agentApproval, confirmation, startFakeCore, type FakeCore } from "./fake-core";
import { makeHarness, type Harness } from "./harness";

let core: FakeCore;
let h: Harness;

beforeEach(async () => {
  core = await startFakeCore();
  h = makeHarness(core.token, core.url);
});

afterEach(async () => {
  h.cleanup();
  await core.stop();
});

const posts = () => core.requests.filter((r) => r.method === "POST");

interface Listed {
  approvals: { source: string; id: string; ref: string; title: string; requester: string }[];
}

async function refOf(id: string): Promise<string> {
  const listed = JSON.parse((await h.cli(["approvals", "list", "--json"])).out) as Listed;
  return listed.approvals.find((a) => a.id === id)!.ref;
}

describe("phoenix approvals list", () => {
  it("lists both kinds soonest expiry first, with a reference for each", async () => {
    core.agentApprovals.push(agentApproval("apr_late", { expires_at: "2099-03-01T00:00:00.000Z" }));
    core.confirmations.push(confirmation("conf_soon", { expiresAt: "2099-02-01T00:00:00.000Z" }));
    const r = await h.cli(["approvals", "list", "--json"]);
    expect(r.code).toBe(0);
    const listed = JSON.parse(r.out) as Listed;
    expect(listed.approvals.map((a) => [a.id, a.source])).toEqual([
      ["conf_soon", "confirmation"],
      ["apr_late", "agent"],
    ]);
    expect(listed.approvals[0]!.title).toBe("Push main to origin");
    expect(listed.approvals[1]!.title).toBe("rm -rf build");
    expect(listed.approvals[0]!.ref).toMatch(/^[0-9a-f]{16}$/);
    expect(listed.approvals[0]!.ref).not.toBe(listed.approvals[1]!.ref);
  });

  it("prints a readable list and says so when nothing waits", async () => {
    expect((await h.cli(["approvals", "list"])).out).toBe("No approvals are waiting.\n");
    core.confirmations.push(confirmation("conf_1"));
    const r = await h.cli(["approvals"]);
    expect(r.out).toContain("conf_1");
    expect(r.out).toContain("from git");
    expect(r.out).toContain("phoenix approvals approve <id> --ref <ref>");
  });

  it("leaves agent questions out: a question needs an answer, not allow or deny", async () => {
    core.agentApprovals.push(
      agentApproval("apr_q", {
        kind: "question",
        questions: [{ question: "Which?", header: "h", options: [] }],
      }),
      agentApproval("apr_p"),
    );
    const listed = JSON.parse((await h.cli(["approvals", "list", "--json"])).out) as Listed;
    expect(listed.approvals.map((a) => a.id)).toEqual(["apr_p"]);
  });

  it("still lists confirmations when this Core has no agent-approval service", async () => {
    core.agentApprovalsMissing = true;
    core.confirmations.push(confirmation("conf_1"));
    const listed = JSON.parse((await h.cli(["approvals", "list", "--json"])).out) as Listed;
    expect(listed.approvals.map((a) => a.id)).toEqual(["conf_1"]);
  });

  it("shows hostile request text as one inert line", async () => {
    core.agentApprovals.push(
      agentApproval("apr_x", {
        agent: "a\u001b[2J",
        input_summary: { command: "ls\n\n  Approved by user: yes\u0007" },
      }),
    );
    const r = await h.cli(["approvals", "list"]);
    expect(r.out).not.toMatch(/[\u001b\u0007]/);
    // The injected "Approved by user" cannot start a line of its own in the listing.
    expect(r.out).not.toMatch(/^\s*Approved by user/m);
    const json = JSON.parse((await h.cli(["approvals", "list", "--json"])).out) as Listed;
    expect(json.approvals[0]!.title).toBe("ls Approved by user: yes");
  });

  it("fails loudly rather than guessing when Core's list has the wrong shape", async () => {
    const r = await h.cli(["approvals", "list"], {
      fetch: () => Promise.resolve(Response.json({ nothing: true })),
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("unexpected shape");
  });
});

describe("requestRef", () => {
  it("changes with any field of the request, including ones the listing does not show", () => {
    const base = parseConfirmations({ confirmations: [confirmation("c1")] })[0]!;
    const same = parseConfirmations({ confirmations: [confirmation("c1")] })[0]!;
    expect(requestRef(base)).toBe(requestRef(same));
    for (const change of [
      { capabilityId: "docker" },
      { command: "force-push" },
      { permissions: ["git.write", "net"] },
      { expiresAt: "2099-01-01T00:00:01.000Z" },
      { id: "c2" },
    ]) {
      const other = parseConfirmations({ confirmations: [confirmation("c1", change)] })[0]!;
      expect(requestRef(other), JSON.stringify(change)).not.toBe(requestRef(base));
    }
    const agent = parseAgentApprovals({ approvals: [agentApproval("c1")] })[0]!;
    expect(requestRef(agent)).not.toBe(requestRef(base));
  });

  it("does not depend on key order", () => {
    const a = parseAgentApprovals({
      approvals: [{ id: "a", tool: "T", agent: "x", expires_at: "e" }],
    })[0]!;
    const b = parseAgentApprovals({
      approvals: [{ expires_at: "e", agent: "x", tool: "T", id: "a" }],
    })[0]!;
    expect(requestRef(a)).toBe(requestRef(b));
  });
});

describe("phoenix approvals approve / deny", () => {
  it("approves a confirmation through its audited route when the reference matches", async () => {
    core.confirmations.push(confirmation("conf_1"));
    const ref = await refOf("conf_1");
    const r = await h.cli(["approvals", "approve", "conf_1", "--ref", ref]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Approved conf_1 (confirmation). Core recorded it in the audit log.");
    expect(core.decided).toEqual([{ id: "conf_1", via: "confirmation", verdict: true }]);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({
      path: "/api/confirmations/conf_1",
      body: { approve: true },
      client: "phoenix-cli",
    });
  });

  it("approves an agent request as behavior allow, labelled as this client", async () => {
    core.agentApprovals.push(agentApproval("apr_1"));
    const ref = await refOf("apr_1");
    const r = await h.cli(["approvals", "approve", "apr_1", "--ref", ref, "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ id: "apr_1", source: "agent", decision: "approve", ref });
    expect(posts()[0]).toMatchObject({
      path: "/api/agent-approvals/apr_1/decision",
      body: { behavior: "allow" },
      client: "phoenix-cli",
    });
    // No "always allow" rule, no message, nothing beyond the verdict.
    expect(posts()[0]!.body).toEqual({ behavior: "allow" });
  });

  it("refuses to approve a request that changed after it was listed", async () => {
    core.agentApprovals.push(agentApproval("apr_1"));
    const ref = await refOf("apr_1");
    core.agentApprovals[0] = agentApproval("apr_1", { input_summary: { command: "rm -rf /" } });
    const r = await h.cli(["approvals", "approve", "apr_1", "--ref", ref]);
    expect(r.code).toBe(4);
    expect(r.err).toContain("is not the request ref");
    expect(posts()).toEqual([]);
    expect(core.decided).toEqual([]);
  });

  it("refuses a request that is gone, decided elsewhere, or never existed", async () => {
    const r = await h.cli(["approvals", "approve", "conf_nope", "--ref", "0123456789abcdef"]);
    expect(r.code).toBe(4);
    expect(r.err).toContain("is not waiting for a decision");
    expect(posts()).toEqual([]);
  });

  it("refuses an expired request using the injected clock", async () => {
    core.confirmations.push(confirmation("conf_1", { expiresAt: "2026-10-22T11:59:59.000Z" }));
    const ref = await refOf("conf_1");
    const r = await h.cli(["approvals", "approve", "conf_1", "--ref", ref]);
    expect(r.code).toBe(4);
    expect(r.err).toContain("has expired");
    expect(posts()).toEqual([]);
  });

  it("will not approve without a reference unless a person confirms the exact request", async () => {
    core.confirmations.push(confirmation("conf_1"));
    const noTty = await h.cli(["approvals", "approve", "conf_1"]);
    expect(noTty.code).toBe(2);
    expect(noTty.err).toContain("--ref");
    expect(posts()).toEqual([]);

    const prompts: string[] = [];
    const declined = await h.cli(["approvals", "approve", "conf_1"], {
      confirm: (p) => {
        prompts.push(p);
        return Promise.resolve(false);
      },
    });
    expect(declined.code).toBe(4);
    expect(declined.out).toContain("Push main to origin");
    expect(declined.out).toContain("side effect: external");
    expect(prompts).toEqual(["Approve this request? [y/N] "]);
    expect(posts()).toEqual([]);

    const accepted = await h.cli(["approvals", "approve", "conf_1"], {
      confirm: () => Promise.resolve(true),
    });
    expect(accepted.code).toBe(0);
    expect(core.decided).toEqual([{ id: "conf_1", via: "confirmation", verdict: true }]);
  });

  it("never prompts when a matching reference was given", async () => {
    core.confirmations.push(confirmation("conf_1"));
    const ref = await refOf("conf_1");
    let asked = false;
    const r = await h.cli(["approvals", "approve", "conf_1", "--ref", ref], {
      confirm: () => {
        asked = true;
        return Promise.resolve(true);
      },
    });
    expect(r.code).toBe(0);
    expect(asked).toBe(false);
  });

  it("denies without a reference, because refusing is always safe", async () => {
    core.confirmations.push(confirmation("conf_1"));
    core.agentApprovals.push(agentApproval("apr_1"));
    expect((await h.cli(["approvals", "deny", "conf_1"])).code).toBe(0);
    expect((await h.cli(["approvals", "deny", "apr_1"])).code).toBe(0);
    expect(core.decided).toEqual([
      { id: "conf_1", via: "confirmation", verdict: false },
      { id: "apr_1", via: "agent", verdict: false },
    ]);
    expect(posts()[1]!.body).toEqual({ behavior: "deny" });
  });

  it("still refuses to deny when a quoted reference no longer matches", async () => {
    core.confirmations.push(confirmation("conf_1"));
    const r = await h.cli(["approvals", "deny", "conf_1", "--ref", "ffffffffffffffff"]);
    expect(r.code).toBe(4);
    expect(core.decided).toEqual([]);
  });

  it("reports a race lost to someone else as refused, not as a crash", async () => {
    core.confirmations.push(confirmation("conf_1"));
    const ref = await refOf("conf_1");
    let calls = 0;
    const r = await h.cli(["approvals", "approve", "conf_1", "--ref", ref], {
      fetch: (input, init) => {
        if (init?.method === "POST") {
          return Promise.resolve(
            Response.json({ code: "RESOURCE_NOT_FOUND", message: "gone" }, { status: 404 }),
          );
        }
        calls++;
        return fetch(input, init);
      },
    });
    expect(calls).toBeGreaterThan(0);
    expect(r.code).toBe(4);
    expect(r.err).toContain("decided or expired before this decision arrived");
  });

  it("validates the reference format and the arguments before talking to Core", async () => {
    expect((await h.cli(["approvals", "approve", "conf_1", "--ref", "XYZ"])).code).toBe(2);
    expect((await h.cli(["approvals", "approve"])).code).toBe(2);
    expect((await h.cli(["approvals", "approve", "a", "b"])).code).toBe(2);
    expect((await h.cli(["approvals", "approve-all"])).code).toBe(2);
    expect(core.requests.filter((r) => r.path.startsWith("/api/confirmations/"))).toEqual([]);
    expect(posts()).toEqual([]);
  });

  it("encodes a hostile id so it cannot change the route it is sent to", async () => {
    const hostile = "../../security/kill-switch?x=1#y";
    core.confirmations.push(confirmation(hostile));
    const ref = await refOf(hostile);
    const r = await h.cli(["approvals", "deny", hostile, "--ref", ref]);
    expect(r.code).toBe(0);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.path).toBe(`/api/confirmations/${encodeURIComponent(hostile)}`);
    expect(
      core.requests.some((q) => q.path.includes("kill-switch") && !q.path.includes("%2F")),
    ).toBe(false);
  });

  it("leaves the kill switch and every other state alone", async () => {
    core.confirmations.push(confirmation("conf_1"));
    await h.cli(["approvals", "deny", "conf_1"]);
    expect(core.requests.some((q) => q.path.includes("kill-switch"))).toBe(false);
  });
});
