// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Handoff between capabilities (agent → git → CI): a COMPLETED session that left a linked commit
// announces `agent.handoff` naming the commit and, later, the CI run built from it, so the
// CI-failure agent can pick it up. The event only announces: nothing is executed because of it.
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../src/sessions";
import { cleanTempDirs, orchestrated, type Orchestrated } from "./rig";

let o: Orchestrated | undefined;
afterEach(async () => {
  if (o) {
    await o.h.manager.disable("agents");
    await o.h.close();
  }
  o = undefined;
  cleanTempDirs();
});

const SHA = "d".repeat(40);

const handoffs = (c: Orchestrated) => c.h.events.filter((e) => e.event_type === "agent.handoff");

async function begin(c: Orchestrated, prompt: string) {
  const op = await c.run("session.start", { launcher: "fake", workspace: c.workspace, prompt });
  return op.result as SessionView;
}

function commitEvent(c: Orchestrated) {
  c.commitTimes[SHA] = Date.now();
  c.h.bus.publish(
    createEvent({
      event_type: "git.commit.created",
      source: "git",
      severity: "info",
      subject: "project",
      payload: { repository: "project", path: c.workspace, sha: SHA, branch: "feature/x" },
    }),
  );
}

const ciEvent = (type: string, conclusion?: string) =>
  createEvent({
    event_type: type,
    source: "github",
    severity: "error",
    payload: {
      repository: "me/project",
      run_id: 77,
      commit: SHA.slice(0, 7),
      branch: "feature/x",
      ...(conclusion ? { conclusion } : {}),
    },
  });

describe("agent.handoff", () => {
  it("announces the linked commit when a session completes, then the CI run built from it", async () => {
    o = await orchestrated();
    const c = o;
    // A long-lived session that the test finishes by sending it a line.
    const s = await begin(c, "FAKE:ask\nwork");
    await vi.waitFor(async () =>
      expect(
        ((await c.run("session.get", { session_id: s.id })).result as { session: SessionView })
          .session.state,
      ).toBe("waiting"),
    );
    commitEvent(c);
    await vi.waitFor(async () =>
      expect(
        ((await c.run("session.get", { session_id: s.id })).result as { links: unknown[] }).links,
      ).toHaveLength(1),
    );
    // Still running: no handoff yet.
    await c.h.drain();
    expect(handoffs(c)).toEqual([]);

    await c.run("session.send", { session_id: s.id, message: "yes" });
    await vi.waitFor(async () => expect(handoffs(c)).toHaveLength(1));
    const first = handoffs(c)[0]!;
    expect(first).toMatchObject({
      source: "agents",
      correlation_id: `agent-${s.id}`,
      subject: "project",
      data_classification: "internal",
      payload: {
        agent: "fake",
        session_id: s.id,
        repository: "project",
        commit: { sha: SHA, repo: "project", confidence: "time+path", branch: "feature/x" },
      },
    });
    expect(first.payload).not.toHaveProperty("ci_run");
    expect(String(first.payload.note)).toContain("Nothing runs because of this event");

    c.h.bus.publish(ciEvent("github.ci.failed", "failure"));
    await vi.waitFor(async () => expect(handoffs(c)).toHaveLength(2));
    expect(handoffs(c)[1]!.payload).toMatchObject({
      commit: { sha: SHA },
      ci_run: {
        run_id: "77",
        repo: "me/project",
        confidence: "sha-match",
        event_type: "github.ci.failed",
        conclusion: "failure",
      },
    });

    // Redelivery of the same CI event does not announce again.
    c.h.bus.publish(
      createEvent({ ...ciEvent("github.ci.failed", "failure"), event_id: "evt_redelivered" }),
    );
    await c.h.drain();
    expect(handoffs(c)).toHaveLength(2);
  });

  it("announces nothing for a session that failed, was stopped, or has no linked commit", async () => {
    o = await orchestrated();
    const c = o;
    const failing = await begin(c, "FAKE:fail\nx");
    await vi.waitFor(async () =>
      expect(
        (
          (await c.run("session.get", { session_id: failing.id })).result as {
            session: SessionView;
          }
        ).session.state,
      ).toBe("failed"),
    );
    const quiet = await begin(c, "FAKE:echo\nx");
    await vi.waitFor(async () =>
      expect(
        ((await c.run("session.get", { session_id: quiet.id })).result as { session: SessionView })
          .session.state,
      ).toBe("completed"),
    );
    await c.h.drain();
    expect(handoffs(c)).toEqual([]);
  });

  it("a commit linked to a session that already completed (git polling lag) is announced then", async () => {
    o = await orchestrated();
    const c = o;
    const s = await begin(c, "FAKE:echo\nquick");
    await vi.waitFor(async () =>
      expect(
        ((await c.run("session.get", { session_id: s.id })).result as { session: SessionView })
          .session.state,
      ).toBe("completed"),
    );
    commitEvent(c);
    await vi.waitFor(async () => expect(handoffs(c)).toHaveLength(1));
    expect(handoffs(c)[0]!.payload).toMatchObject({ commit: { sha: SHA } });
  });

  it("executes nothing: only agent.* events and audit records result, and no other capability command runs", async () => {
    o = await orchestrated();
    const c = o;
    const s = await begin(c, "FAKE:echo\nquick");
    await vi.waitFor(async () =>
      expect(
        ((await c.run("session.get", { session_id: s.id })).result as { session: SessionView })
          .session.state,
      ).toBe("completed"),
    );
    commitEvent(c);
    await vi.waitFor(async () => expect(handoffs(c)).toHaveLength(1));
    const completed = c.h.events.filter((e) => e.event_type === "capability.command.completed");
    expect(completed.every((e) => e.payload.capability === "agents")).toBe(true);
    expect(
      c.h.events.some((e) => e.source !== "agents" && e.source !== "core" && e.source !== "git"),
    ).toBe(false);
  });
});
