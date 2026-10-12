// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  MeetingItem,
  Plan,
  PlanCreationReport,
  PlanDetail,
  PlanLink,
  PlanTaskRun,
  PlanningStatus,
} from "../src/core/types";
import { confirmation } from "./harness";
import { FakeWebSocket } from "./fake-ws";
import { capability, doubleClick, expectInert, openAt, sendEvent, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: "plan_1",
  meeting_id: "kage:7",
  item_id: "mi_1",
  target: "github",
  destination: { system: "github", repository: "octo/phoenix" },
  status: "draft",
  content_hash: HASH,
  approved: null,
  include_meeting_ref: false,
  title: "Vendor approval flow",
  generated_by: "ai:ollama/llama3.2",
  not_ai_generated: false,
  summary: { text: "Build the flow.", basis: "meeting", quote: "we need a vendor approval flow" },
  acceptance_criteria: [{ text: "Purchasing can approve", basis: "suggested" }],
  risks: [],
  open_questions: ["Who owns it?"],
  tasks: [
    { title: "Design the flow", body: "Sketch it.", labels: ["design"], basis: "suggested" },
    { title: "Build it", body: "Write code.", labels: [], basis: "user" },
  ],
  frappe: null,
  source: {
    item_id: "mi_1",
    meeting_id: "kage:7",
    kind: "decision",
    item_text: "We need a vendor approval flow",
    owner: null,
    due: null,
    quote: null,
  },
  created_at: "2026-10-09T12:00:00Z",
  updated_at: "2026-10-09T12:00:00Z",
  ...over,
});

const link = (i: number, url = "https://github.com/octo/phoenix/issues/1"): PlanLink => ({
  id: `link_${i}`,
  meeting_id: "kage:7",
  item_id: "mi_1",
  plan_id: "plan_1",
  task_index: i,
  system: "github",
  external_id: String(i + 1),
  url,
  approved_by: "owner",
  approved_at: "2026-10-09T12:05:00Z",
  created_at: "2026-10-09T12:06:00Z",
});

const frappePlan = (over: Partial<Plan> = {}): Plan =>
  plan({
    target: "frappe",
    destination: { system: "frappe", site: "erp.localhost" },
    frappe: {
      doctype: "Vendor Approval",
      fields: [
        { label: "Vendor", fieldtype: "Link", required: true },
        { label: "Reason", fieldtype: "Small Text", required: false },
      ],
      workflow_states: ["Draft", "Pending Approval", "Approved"],
      permissions: [
        { role: "Purchase User", read: true, write: true, create: false },
        { role: "Auditor", read: true, write: false, create: false },
        { role: "No access", read: false, write: false, create: false },
      ],
    },
    ...over,
  });

const STATUS_ON: PlanningStatus = {
  enabled: true,
  ai_enabled: true,
  reasons: [],
  destinations: {
    github: { capability_enabled: true, write_token_set: true },
    frappe: { capability_enabled: false, write_token_set: false, sites: [] },
  },
};

const previewOf = (
  input: Record<string, unknown> = { title: "Design the flow", body: "Sketch it." },
) => ({
  plan_id: "plan_1",
  tasks: [
    {
      task_index: 0,
      tool: "github.issue.create",
      input,
      decision: { effect: "confirm", risk: "medium", reasons: ["writes to GitHub"], matched: [] },
    },
  ],
});

/**
 * A fake Core that follows what is posted. `create` stays open until `finish()` is called, like
 * the real one that waits for the user's answer to every confirmation.
 */
function rig(initial: Plan = plan(), opts: { status?: PlanningStatus } = {}) {
  let current = initial;
  let runs: PlanTaskRun[] = [];
  let links: PlanLink[] = [];
  let pending: unknown[] = [];
  const open = Promise.withResolvers<PlanCreationReport>();
  const detail = (): PlanDetail => ({ plan: current, runs, links });
  const set = (patch: Partial<Plan>) => (current = { ...current, ...patch });
  const routes: Record<string, (body: unknown) => unknown> = {
    "GET /api/plans/status": () => opts.status ?? STATUS_ON,
    "GET /api/plans/plan_1": () => detail(),
    "GET /api/plans/plan_1/preview": () => previewOf(),
    "GET /api/confirmations": () => ({ confirmations: pending }),
    "POST /api/plans/plan_1/propose": () => {
      set({ status: "proposed" });
      return detail();
    },
    "POST /api/plans/plan_1/cancel": () => {
      set({ status: "cancelled" });
      return detail();
    },
    "POST /api/plans/plan_1/edit": (body) => {
      const b = body as {
        title?: string;
        tasks?: { title: string; body: string; labels: string[] }[];
      };
      set({
        status: "draft",
        approved: null,
        content_hash: HASH2,
        ...(b.title ? { title: b.title } : {}),
        ...(b.tasks ? { tasks: b.tasks.map((t) => ({ ...t, basis: "user" as const })) } : {}),
      });
      return detail();
    },
    "POST /api/plans/plan_1/approve": (body) => {
      const b = body as { hash: string };
      if (b.hash !== current.content_hash) {
        return new Response(
          JSON.stringify({
            code: "INVALID_REQUEST",
            message: "The plan changed since you looked at it; review it again before approving",
          }),
          { status: 400 },
        );
      }
      set({
        status: "approved",
        approved: { hash: b.hash, by: "owner", at: "2026-10-09T12:04:00Z" },
      });
      return detail();
    },
    "POST /api/plans/plan_1/create": async () => {
      set({ status: "creating" });
      pending = [
        confirmation({
          id: "conf_c1",
          capabilityId: "github",
          command: "issue.create",
          summary: "GitHub: create an issue",
          sideEffect: "external",
        }),
      ];
      return open.promise;
    },
  };
  const m = openAt("#/plans/plan_1", routes);
  return {
    ...m,
    plan: () => current,
    finish(report?: Partial<PlanCreationReport>) {
      runs = [0, 1].map((i) => ({
        task_index: i,
        idempotency_key: `k${i}`,
        status: "created",
        attempts: 1,
        external_id: String(i + 1),
        url: `https://github.com/octo/phoenix/issues/${i + 1}`,
        error: null,
        updated_at: "now",
      }));
      links = [link(0), link(1)];
      set({ status: "created" });
      pending = [];
      open.resolve({ ...detail(), failure: null, ...report });
    },
    set,
    setPending: (p: unknown[]) => (pending = p),
  };
}

describe("Plan page", () => {
  it("shows the plan with basis next to every statement, the destination and the rules-based or model label", async () => {
    rig();
    expect(await screen.findByRole("heading", { name: "Vendor approval flow" })).toBeTruthy();
    expect(screen.getByText("Model output")).toBeTruthy();
    expect(screen.getByText(/Model output \(ollama\/llama3.2\)/)).toBeTruthy();
    expect(screen.getByText("GitHub repository octo/phoenix")).toBeTruthy();
    expect(screen.getByText("Draft: not yet proposed")).toBeTruthy();
    expect(
      screen.getByText("we need a vendor approval flow", { selector: "blockquote" }),
    ).toBeTruthy();
    expect(screen.getAllByText("(from the meeting)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("(suggested by the model)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("(written by you)").length).toBeGreaterThan(0);
    const tasks = screen.getByRole("list", { name: "Tasks" });
    expect(within(tasks).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the proposed Frappe DocType, fields, workflow and permissions without promising creation", async () => {
    rig(frappePlan());
    expect(
      await screen.findByRole("heading", { name: "Proposed Frappe DocType: Vendor Approval" }),
    ).toBeTruthy();
    expect(screen.getByText(/Creating tasks does not create this DocType/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Proposed Frappe fields" }).textContent).toContain(
      "Vendor · Link · required",
    );
    expect(screen.getByRole("list", { name: "Proposed Frappe fields" }).textContent).toContain(
      "Reason · Small Text",
    );
    expect(
      screen.getByRole("list", { name: "Proposed Frappe workflow states" }).textContent,
    ).toContain("2. Pending Approval");
    expect(screen.getByRole("list", { name: "Proposed Frappe permissions" }).textContent).toContain(
      "Purchase User: read, write",
    );
    expect(screen.getByRole("list", { name: "Proposed Frappe permissions" }).textContent).toContain(
      "No access: no access",
    );
    expect(screen.getByText("Frappe site erp.localhost")).toBeTruthy();
  });

  it("shows no design when Frappe has none", async () => {
    rig(frappePlan({ frappe: null }));
    await screen.findByRole("heading", { name: "Vendor approval flow" });
    expect(screen.queryByRole("heading", { name: /Proposed Frappe DocType/ })).toBeNull();
  });

  it("never shows a Frappe design on a GitHub plan", async () => {
    rig(plan({ frappe: frappePlan().frappe }));
    await screen.findByRole("heading", { name: "Vendor approval flow" });
    expect(screen.queryByRole("heading", { name: /Proposed Frappe DocType/ })).toBeNull();
  });

  it("gives long Frappe design text wrapping classes for narrow screens and keeps hostile text inert", async () => {
    const longName = "Vendor".repeat(60);
    const { container } = rig(
      frappePlan({
        frappe: {
          doctype: longName,
          fields: [{ label: XSS, fieldtype: longName, required: true }],
          workflow_states: [longName],
          permissions: [{ role: longName, read: true, write: false, create: false }],
        },
      }),
    );
    const design = await screen.findByRole("heading", {
      name: `Proposed Frappe DocType: ${longName}`,
    });
    expect(design.querySelector(".memory-text")?.textContent).toBe(longName);
    for (const list of [
      "Proposed Frappe fields",
      "Proposed Frappe workflow states",
      "Proposed Frappe permissions",
    ]) {
      expect(
        within(screen.getByRole("list", { name: list }))
          .getAllByRole("listitem")[0]
          ?.classList.contains("memory-text"),
      ).toBe(true);
    }
    expectInert(container);
  });

  it("labels a plan nobody wrote with AI as a rules-based draft", async () => {
    rig(plan({ not_ai_generated: true, generated_by: "rules" }));
    expect(await screen.findByText("Rules-based draft")).toBeTruthy();
    expect(screen.queryByText("Model output")).toBeNull();
  });

  it("shows exactly what each task would send, as plain text", async () => {
    const m = rig();
    m.api.set("GET /api/plans/plan_1/preview", () => previewOf({ title: XSS, body: "x" }));
    const { container } = m;
    const input = await screen.findByLabelText("Input of task 1 (plain text, scrolls)");
    expect(input.tagName).toBe("PRE");
    await waitFor(() => expect(input.textContent).toContain(XSS.replaceAll('"', '\\"')));
    expect(screen.getByText(/Create a GitHub issue/)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("walks draft → propose → approve with the hash on screen, and nothing is created", async () => {
    const m = rig();
    fireEvent.click(await screen.findByRole("button", { name: "Propose this plan" }));
    await screen.findByText("Proposed: waiting for your approval");
    fireEvent.click(screen.getByRole("button", { name: "Approve this exact plan" }));
    await waitFor(() => expect(m.api.posts("/api/plans/plan_1/approve")).toHaveLength(1));
    expect(m.api.posts("/api/plans/plan_1/approve")[0]?.body).toEqual({
      hash: HASH,
      include_meeting_ref: false,
    });
    expect(await screen.findByText("Approved: ready to create")).toBeTruthy();
    expect(m.api.posts("/api/plans/plan_1/create")).toHaveLength(0);
  });

  it("approval carries the choice to name the meeting", async () => {
    const m = rig(plan({ status: "proposed" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Name the meeting in the created tasks" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve this exact plan" }));
    await waitFor(() => expect(m.api.posts("/api/plans/plan_1/approve")).toHaveLength(1));
    expect(m.api.posts("/api/plans/plan_1/approve")[0]?.body).toEqual({
      hash: HASH,
      include_meeting_ref: true,
    });
  });

  it("a double click on Approve sends ONE request", async () => {
    const m = rig(plan({ status: "proposed" }));
    const button = await screen.findByRole("button", { name: "Approve this exact plan" });
    doubleClick(() => fireEvent.click(button));
    await screen.findByText("Approved: ready to create");
    expect(m.api.posts("/api/plans/plan_1/approve")).toHaveLength(1);
  });

  it("a stale hash is refused, shown, and the plan is reloaded to what Core now has", async () => {
    const m = rig(plan({ status: "proposed" }));
    const button = await screen.findByRole("button", { name: "Approve this exact plan" });
    // The plan changed behind the page (edited elsewhere): Core now holds another hash.
    m.set({ content_hash: HASH2, title: "Changed elsewhere" });
    fireEvent.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "The plan changed since you looked at it; review it again before approving",
    );
    expect(m.api.posts("/api/plans/plan_1/approve")[0]?.body).toMatchObject({ hash: HASH });
    // It reloaded: the new title and fingerprint are on screen, and the plan is still not approved.
    expect(await screen.findByRole("heading", { name: "Changed elsewhere" })).toBeTruthy();
    expect(screen.getByText(HASH2.slice(0, 16))).toBeTruthy();
    expect(screen.getByText("Proposed: waiting for your approval")).toBeTruthy();
  });

  describe("creating the tasks", () => {
    it("needs the explicit tick, then sends {confirm:true} and holds the request open without a timeout", async () => {
      const m = rig(
        plan({
          status: "approved",
          content_hash: HASH,
          approved: { hash: HASH, by: "owner", at: "t" },
        }),
      );
      const create = await screen.findByRole("button", { name: "Create tasks" });
      expect((create as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: /I understand this creates 2 tasks in GitHub repository octo\/phoenix, as me/,
        }),
      );
      expect((create as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(create);
      await waitFor(() => expect(m.api.posts("/api/plans/plan_1/create")).toHaveLength(1));
      expect(m.api.posts("/api/plans/plan_1/create")[0]?.body).toEqual({ confirm: true });
    });

    it("while the request is open: says which task waits, shows the approval, keeps Create disabled, and a double click sent ONE request", async () => {
      const m = rig(plan({ status: "approved", approved: { hash: HASH, by: "owner", at: "t" } }));
      fireEvent.click(await screen.findByRole("checkbox", { name: /I understand/ }));
      const create = screen.getByRole("button", { name: "Create tasks" });
      doubleClick(() => fireEvent.click(create));
      expect(await screen.findByText("Waiting for your approval of task 1 of 2.")).toBeTruthy();
      // Before Core has announced anything, with the tick still set: the request alone disables it.
      expect(
        (screen.getByRole("checkbox", { name: /I understand/ }) as HTMLInputElement).checked,
      ).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Create tasks" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      // The request stays open: a long time passes and nothing else is sent or failed.
      sendEvent(m.ws, 5, "security.confirmation.requested");
      expect(
        await screen.findByRole("button", { name: /^Approve: GitHub: create an issue/ }),
      ).toBeTruthy();
      expect(
        (screen.getByRole("button", { name: "Create tasks" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
      expect(m.api.posts("/api/plans/plan_1/create")).toHaveLength(1);
      expect(screen.queryByRole("alert")).toBeNull();
      // Still waiting and still disabled; now the user answers and the request returns.
      act(() => m.finish());
      expect(await screen.findByText("Created", { selector: "strong" })).toBeTruthy();
      expect(m.api.posts("/api/plans/plan_1/create")).toHaveLength(1);
    });

    it("shows the per-task report with external ids and https links, and lists the links created", async () => {
      const m = rig(plan({ status: "approved", approved: { hash: HASH, by: "owner", at: "t" } }));
      fireEvent.click(await screen.findByRole("checkbox", { name: /I understand/ }));
      fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
      await screen.findByText(/Waiting for your approval of task 1 of 2/);
      act(() => m.finish());
      const results = await screen.findByRole("list", { name: "Task results" });
      expect(results.textContent).toContain("Task 1: Created");
      expect(results.textContent).toContain("Task 2: Created");
      const a = within(results).getAllByRole("link")[0]!;
      expect(a.getAttribute("href")).toBe("https://github.com/octo/phoenix/issues/1");
      const made = screen.getByRole("list", { name: "Tasks created" });
      expect(within(made).getAllByRole("listitem")).toHaveLength(2);
    });

    it("a failure is reported: where it stopped, and that Create can be run again", async () => {
      const m = rig(plan({ status: "approved", approved: { hash: HASH, by: "owner", at: "t" } }));
      fireEvent.click(await screen.findByRole("checkbox", { name: /I understand/ }));
      fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
      await screen.findByText(/Waiting for your approval of task 1 of 2/);
      act(() => {
        m.set({ status: "failed" });
        m.finish({ failure: { task_index: 1, message: "GitHub said no" } });
        m.set({ status: "failed" });
      });
      expect((await screen.findByText(/Stopped at task 2: GitHub said no/)).textContent).toMatch(
        /not duplicated/,
      );
      expect(
        await screen.findByRole("button", { name: "Create the remaining tasks" }),
      ).toBeTruthy();
    });

    it("an error from Core (409 planning off) is shown and Create works again afterwards", async () => {
      const m = rig(plan({ status: "approved", approved: { hash: HASH, by: "owner", at: "t" } }));
      m.api.set(
        "POST /api/plans/plan_1/create",
        () =>
          new Response(
            JSON.stringify({
              code: "CAPABILITY_DISABLED",
              message: "Planning is off",
              details: ["PLANNING_OFF"],
            }),
            { status: 409 },
          ),
      );
      fireEvent.click(await screen.findByRole("checkbox", { name: /I understand/ }));
      fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Planning is off");
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Create tasks" }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
    });

    it("shows a hostile external url as text only", async () => {
      openAt("#/plans/plan_1", {
        "GET /api/plans/status": () => STATUS_ON,
        "GET /api/plans/plan_1": () => ({
          plan: plan({ status: "created" }),
          runs: [],
          links: [link(0, "javascript:alert(1)"), link(1, "http://example.test/1"), link(2, XSS)],
        }),
        "GET /api/plans/plan_1/preview": () => previewOf(),
      });
      const list = await screen.findByRole("list", { name: "Tasks created" });
      const hrefs = within(list)
        .queryAllByRole("link")
        .map((a) => a.getAttribute("href"));
      expect(hrefs.filter((h) => h !== null && !h.startsWith("#/"))).toEqual([]);
      expect(list.textContent).toContain("javascript:alert(1)");
      expect(list.textContent).toContain("http://example.test/1");
      expect(list.querySelector("img")).toBeNull();
    });

    it("displays Frappe Task links in runs and plan links, allowing only HTTPS or loopback HTTP", async () => {
      const urls = [
        "http://127.0.0.1:8000/app/task/TASK-1",
        "https://erp.example.test/app/task/TASK-2",
        "http://erp.example.test/app/task/TASK-3",
        "javascript:alert(1)",
        "https://user:password@erp.example.test/app/task/TASK-5",
      ];
      const links = urls.map((url, i): PlanLink => ({
        ...link(i, url),
        system: "frappe",
        external_id: `TASK-${i + 1}`,
      }));
      const runs: PlanTaskRun[] = urls.map((url, i) => ({
        task_index: i,
        idempotency_key: `key_${i}`,
        status: "created",
        attempts: 1,
        external_id: `TASK-${i + 1}`,
        url,
        error: null,
        updated_at: "now",
      }));
      openAt("#/plans/plan_1", {
        "GET /api/plans/status": () => STATUS_ON,
        "GET /api/plans/plan_1": () => ({ plan: frappePlan({ status: "created" }), runs, links }),
        "GET /api/plans/plan_1/preview": () => previewOf(),
      });
      const created = await screen.findByRole("list", { name: "Tasks created" });
      const results = screen.getByRole("list", { name: "Task results" });
      for (const list of [created, results]) {
        expect(list.textContent).toContain("TASK-1");
        expect(list.textContent).toContain("http://erp.example.test/app/task/TASK-3");
        const hrefs = within(list)
          .getAllByRole("link")
          .map((a) => a.getAttribute("href"));
        expect(hrefs).toContain(urls[0]);
        expect(hrefs).toContain(urls[1]);
        expect(hrefs).not.toContain(urls[2]);
        expect(hrefs).not.toContain(urls[3]);
        expect(hrefs).not.toContain(urls[4]);
      }
      expect(created.textContent).toContain("Task TASK-1");
      expect(results.textContent).toContain("Frappe Task TASK-1");
    });
  });

  describe("editing", () => {
    it("validates like the API and sends only what changed; the plan goes back to draft", async () => {
      const m = rig(plan({ status: "proposed" }));
      fireEvent.click(await screen.findByRole("button", { name: "Edit the plan" }));
      fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "  " } });
      fireEvent.change(screen.getByLabelText("Task 1 title"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText(/^Repository/), { target: { value: "no-slash" } });
      fireEvent.change(screen.getByLabelText(/Task 2 labels/), {
        target: { value: "a,b,c,d,e,f" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(4));
      expect(screen.getByText("The title cannot be empty.")).toBeTruthy();
      expect(screen.getByText("Task 1 needs a title.")).toBeTruthy();
      expect(screen.getByText('The repository must look like "owner/name".')).toBeTruthy();
      expect(screen.getByText("At most 5 labels.")).toBeTruthy();
      expect(m.api.posts("/api/plans/plan_1/edit")).toHaveLength(0);

      fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "New title" } });
      fireEvent.change(screen.getByLabelText("Task 1 title"), { target: { value: "Design it" } });
      fireEvent.change(screen.getByLabelText(/^Repository/), { target: { value: "octo/phoenix" } });
      fireEvent.change(screen.getByLabelText(/Task 2 labels/), {
        target: { value: "Backend, API" },
      });
      doubleClick(() => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
      await waitFor(() => expect(m.api.posts("/api/plans/plan_1/edit")).toHaveLength(1));
      const body = m.api.posts("/api/plans/plan_1/edit")[0]?.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["tasks", "title"]);
      expect(body.title).toBe("New title");
      expect(body.tasks).toEqual([
        { title: "Design it", body: "Sketch it.", labels: ["design"] },
        { title: "Build it", body: "Write code.", labels: ["backend", "api"] },
      ]);
      expect(await screen.findByText("Draft: not yet proposed")).toBeTruthy();
      expect(m.api.posts("/api/plans/plan_1/edit")).toHaveLength(1);
    });

    it("cannot remove the last task or add a ninth", async () => {
      rig();
      fireEvent.click(await screen.findByRole("button", { name: "Edit the plan" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove task 2" }));
      expect(
        (screen.getByRole("button", { name: "Remove task 1" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      for (let i = 0; i < 7; i++)
        fireEvent.click(screen.getByRole("button", { name: "Add a task" }));
      expect(
        (screen.getByRole("button", { name: "Add a task" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("renders a hostile title, summary, body and quote as text", async () => {
      const { container } = rig(
        plan({
          title: XSS,
          summary: { text: XSS, basis: "meeting", quote: XSS },
          tasks: [{ title: XSS, body: XSS, labels: [XSS], basis: "user" }],
        }),
      );
      await screen.findByRole("heading", { level: 1 });
      expectInert(container);
    });
  });

  it("cancelling needs one click and says nothing was created", async () => {
    const m = rig();
    const button = await screen.findByRole("button", { name: "Cancel this plan" });
    doubleClick(() => fireEvent.click(button));
    expect(await screen.findByText("Cancelled", { selector: "strong" })).toBeTruthy();
    expect(m.api.posts("/api/plans/plan_1/cancel")).toHaveLength(1);
  });

  it("says planning is off, with every reason, and keeps Create disabled", async () => {
    rig(plan({ status: "approved", approved: { hash: HASH, by: "owner", at: "t" } }), {
      status: {
        ...STATUS_ON,
        enabled: false,
        ai_enabled: false,
        reasons: [
          "AI is off.",
          "No destination is set up: the github capability needs a write token.",
        ],
      },
    });
    expect(await screen.findByText("Planning is off.")).toBeTruthy();
    expect(screen.getByText("AI is off.")).toBeTruthy();
    expect(screen.getByText(/No destination is set up/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
    expect(
      (screen.getByRole("button", { name: "Create tasks" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("explains a plan that cannot be loaded", async () => {
    openAt("#/plans/plan_9", {});
    expect((await screen.findByRole("alert")).textContent).toContain("Not found");
  });
});

describe("Make a plan, from an accepted meeting item", () => {
  const item = (over: Partial<MeetingItem> = {}): MeetingItem => ({
    id: "mi_1",
    meeting_id: "kage:7",
    kind: "decision",
    text: "We need a vendor approval flow",
    owner: null,
    due: null,
    status: "accepted",
    extracted_by: "kage",
    evidence: null,
    original: null,
    created_at: "2026-10-04T09:41:00Z",
    reviewed_at: null,
    reviewed_by: null,
    ...over,
  });

  function open(
    items: MeetingItem[],
    status: PlanningStatus = STATUS_ON,
    extra: Record<string, () => unknown> = {},
  ) {
    return openAt("#/meetings/kage%3A7", {
      "GET /api/capabilities": () => ({ capabilities: [capability("kage", "enabled")] }),
      "GET /api/meetings/kage:7": () => ({
        id: "kage:7",
        capability_id: "kage",
        external_id: "7",
        title: "Vendor planning",
        status: "ready",
        started_at: null,
        ended_at: null,
        duration_seconds: null,
        participants: [],
        recording: null,
        has_transcript: false,
        has_summary: false,
        archived_at: null,
        updated_at: "2026-10-04T09:40:00Z",
      }),
      "GET /api/meetings/kage:7/items": () => ({
        meeting_id: "kage:7",
        items,
        counts: { proposed: 0, accepted: items.length, edited: 0, rejected: 0 },
      }),
      "GET /api/plans/status": () => status,
      ...extra,
    });
  }

  it("is offered only on accepted decisions, action items and requirements", async () => {
    open([
      item({ id: "mi_1", text: "accepted decision" }),
      item({ id: "mi_2", text: "proposed one", status: "proposed" }),
      item({ id: "mi_3", text: "a topic", kind: "topic" }),
    ]);
    await screen.findByText("accepted decision");
    expect(screen.getAllByRole("button", { name: /^Make a plan from/ })).toHaveLength(1);
  });

  it("asks where the tasks would go, validates the repository, then drafts the plan and links to it", async () => {
    const { api } = open([item()], STATUS_ON, {
      "POST /api/meeting-items/mi_1/plan": () => ({
        plan: plan(),
        generation: { unavailable: null },
      }),
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Make a plan from/ }));
    fireEvent.change(screen.getByLabelText("Repository (owner/name)"), {
      target: { value: "bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft a plan" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      'The repository must look like "owner/name".',
    );
    expect(api.posts("/api/meeting-items/mi_1/plan")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Repository (owner/name)"), {
      target: { value: "octo/phoenix" },
    });
    doubleClick(() => fireEvent.click(screen.getByRole("button", { name: "Draft a plan" })));
    await waitFor(() => expect(api.posts("/api/meeting-items/mi_1/plan")).toHaveLength(1));
    expect(api.posts("/api/meeting-items/mi_1/plan")[0]?.body).toEqual({
      destination: { system: "github", repository: "octo/phoenix" },
    });
    expect((await screen.findByRole("link", { name: "Open the plan" })).getAttribute("href")).toBe(
      "#/plans/plan_1",
    );
    expect(api.posts("/api/meeting-items/mi_1/plan")).toHaveLength(1);
  });

  it("when planning is off it lists every reason, disables Draft, and sends nothing", async () => {
    const { api } = open([item()], {
      ...STATUS_ON,
      enabled: false,
      ai_enabled: false,
      reasons: ["AI is off.", "No destination is set up."],
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Make a plan from/ }));
    expect(screen.getByText("Planning is off.")).toBeTruthy();
    expect(screen.getByText("AI is off.")).toBeTruthy();
    expect(screen.getByText("No destination is set up.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Draft a plan" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.posts("/api/meeting-items/mi_1/plan")).toHaveLength(0);
  });

  it("shows the reasons from a PLANNING_OFF refusal that arrives anyway", async () => {
    open([item()], STATUS_ON, {
      "POST /api/meeting-items/mi_1/plan": () =>
        new Response(
          JSON.stringify({
            code: "CAPABILITY_DISABLED",
            message: "Planning is off",
            details: ["PLANNING_OFF", "AI is off."],
          }),
          { status: 409 },
        ),
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Make a plan from/ }));
    fireEvent.change(screen.getByLabelText("Repository (owner/name)"), {
      target: { value: "octo/phoenix" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft a plan" }));
    expect(await screen.findByText("AI is off.")).toBeTruthy();
  });

  it("lists the plans and the tasks created from the meeting; an http link stays text", async () => {
    open([item()], STATUS_ON, {
      "GET /api/meetings/kage:7/plans": () => ({
        meeting_id: "kage:7",
        plans: [
          {
            id: "plan_1",
            item_id: "mi_1",
            target: "github",
            status: "created",
            title: XSS,
            task_count: 2,
            created_at: "t",
            updated_at: "t",
          },
        ],
      }),
      "GET /api/meetings/kage:7/links": () => ({
        meeting_id: "kage:7",
        links: [link(0), link(1, "http://insecure.test/2")],
      }),
    });
    const list = await screen.findByRole("list", { name: "Tasks created from this meeting" });
    const anchors = within(list).getAllByRole("link");
    expect(
      anchors.some((a) => a.getAttribute("href") === "https://github.com/octo/phoenix/issues/1"),
    ).toBe(true);
    expect(anchors.some((a) => (a.getAttribute("href") ?? "").startsWith("http://"))).toBe(false);
    expect(list.textContent).toContain("http://insecure.test/2");
    expect(screen.getByRole("list", { name: "Plans" }).textContent).toContain(XSS);
    expect(document.querySelector("img")).toBeNull();
  });

  it("links Frappe Tasks back to their plan from the meeting", async () => {
    open([item()], STATUS_ON, {
      "GET /api/meetings/kage:7/plans": () => ({ meeting_id: "kage:7", plans: [] }),
      "GET /api/meetings/kage:7/links": () => ({
        meeting_id: "kage:7",
        links: [
          {
            ...link(0, "https://erp.example.test/app/task/TASK-1"),
            system: "frappe",
            external_id: "TASK-1",
          },
        ],
      }),
    });
    const list = await screen.findByRole("list", { name: "Tasks created from this meeting" });
    expect(list.textContent).toContain("Frappe Task TASK-1");
    expect(within(list).getByRole("link", { name: "its plan" }).getAttribute("href")).toBe(
      "#/plans/plan_1",
    );
    expect(
      within(list)
        .getByRole("link", { name: "https://erp.example.test/app/task/TASK-1" })
        .getAttribute("rel"),
    ).toBe("noopener noreferrer");
  });
});
