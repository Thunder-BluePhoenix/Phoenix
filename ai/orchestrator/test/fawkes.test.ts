// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { RESERVED_SOURCES, createEvent, validateEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { describe, expect, it } from "vitest";
import { RUN_EVENT_TYPES, runEvent, type RunEventFacts, type RunEventKind } from "../src";

const facts: RunEventFacts = {
  taskId: "task_1",
  runId: "run_1",
  correlationId: "corr_1",
  agentKind: "ci_failure",
  title: "CI failure in owner/name",
};

const kinds = Object.keys(RUN_EVENT_TYPES) as RunEventKind[];
const build = (kind: RunEventKind) => createEvent(runEvent(kind, facts, { stage: "execute" }));

describe("agent run events", () => {
  it.each(kinds)("%s is a valid event that is not in a reserved namespace", (kind) => {
    const event = build(kind);
    expect(validateEvent(event)).toMatchObject({ ok: true });
    expect(RESERVED_SOURCES.has(event.event_type.split(".")[0]!)).toBe(false);
    expect(event.correlation_id).toBe("corr_1");
  });

  it("maps to Fawkes states: running → THINKING, waiting → WAITING, failed → ERROR, completed → SUCCESS then clears", () => {
    let now = Date.parse("2026-10-09T12:00:00Z");
    const engine = new StateEngine({ now: () => now });
    engine.handle(build("started"));
    expect(engine.snapshot()).toMatchObject({ state: "THINKING" });
    engine.handle(build("thinking"));
    expect(engine.snapshot().state).toBe("THINKING");
    engine.handle(build("waiting"));
    expect(engine.snapshot().state).toBe("WAITING");
    engine.handle(build("thinking"));
    expect(engine.snapshot().state).toBe("THINKING");
    engine.handle(build("completed"));
    expect(engine.snapshot().state).toBe("SUCCESS");
    now += 9_000;
    engine.tick();
    expect(engine.snapshot().state).toBe("IDLE");

    engine.handle(build("started"));
    engine.handle(build("failed"));
    expect(engine.snapshot().state).toBe("ERROR");
    engine.handle(build("cancelled"));
    expect(engine.snapshot().state).toBe("IDLE");
  });

  it("one correlation id is one Fawkes condition; two runs are two", () => {
    const engine = new StateEngine();
    engine.handle(build("started"));
    engine.handle(
      createEvent(runEvent("started", { ...facts, correlationId: "corr_2", runId: "run_2" })),
    );
    expect(engine.snapshot().conditions).toHaveLength(2);
    engine.handle(build("completed"));
    expect(engine.snapshot().conditions).toHaveLength(2);
  });

  it("describes events with the task title and never echoes arbitrary reason text unbounded", () => {
    const engine = new StateEngine();
    const failed = createEvent(
      runEvent("failed", facts, { reason: `${"x".repeat(500)}\n<script>` }),
    );
    expect(engine.describe(failed)).toBe("CI failure in owner/name failed");
    expect(String(failed.payload.reason).length).toBeLessThanOrEqual(200);
    expect(String(failed.payload.reason)).not.toMatch(/[<>\n]/);
    expect(engine.describe(build("cancelled"))).toBe("CI failure in owner/name was cancelled");
  });

  it("waiting asks the user to act", () => {
    expect(build("waiting").requires_action).toBe(true);
    expect(build("started").requires_action).toBeUndefined();
  });
});
