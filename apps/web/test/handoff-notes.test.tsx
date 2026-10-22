// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
  type BoundFunctions,
  type queries,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  HandoffAttachAppliedView,
  HandoffAttachPreviewView,
  HandoffNoteView,
  HandoffSettingsView,
  SecretGuardStatusView,
} from "../src/core/handoff";
import type { LiveSessionView } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { sendEvent } from "./harness";
import { expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
  Reflect.deleteProperty(navigator, "clipboard");
});

const note = (patch: Partial<HandoffNoteView> = {}): HandoffNoteView => ({
  id: "hn_1",
  created_at: "2026-10-09T12:00:00Z",
  agent: "claude",
  session_id: "sess_1",
  project: "proj",
  trigger: "auto",
  goal: null,
  files: [{ path: "src/a.ts", added: 6, removed: 1, edits: 2 }],
  files_total: 2,
  added: 10,
  removed: 3,
  commands: ["curl -H [redacted] https://example.test"],
  commands_total: 1,
  open_questions: [],
  steps_total: 4,
  dropped_steps: 0,
  generated_by: "rules",
  summary: null,
  ...patch,
});

const session = (patch: Partial<LiveSessionView> = {}): LiveSessionView => ({
  id: "sess_1",
  agent: "claude",
  project: "proj",
  repository: "acme/app",
  first_seen: "2026-10-09T11:00:00Z",
  last_seen: "2026-10-09T12:00:00Z",
  active: true,
  step_count: 3,
  dropped_steps: 0,
  has_terminal: false,
  ...patch,
});

const previewOf = (patch: Partial<HandoffAttachPreviewView> = {}): HandoffAttachPreviewView => ({
  mode: "preview",
  target: "commit_message",
  delivery: "copy",
  wired: false,
  text: "Handoff: 2 files changed (+10 -3)",
  hash: "hash_1",
  notes: ["Nothing is written by Phoenix."],
  ...patch,
});

const appliedOf = (patch: Partial<HandoffAttachAppliedView> = {}): HandoffAttachAppliedView => ({
  mode: "applied",
  target: "commit_message",
  delivery: "copy",
  text: "Handoff: 2 files changed (+10 -3)",
  copy_only: true,
  ...patch,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Whether a request body holds `key` set to `value` (a body is parsed JSON of unknown shape). */
const has = (body: unknown, key: string, value?: boolean): boolean =>
  typeof body === "object" &&
  body !== null &&
  key in body &&
  (value === undefined || Reflect.get(body, key) === value);

interface Setup {
  notes?: HandoffNoteView[];
  texts?: Record<string, string>;
  sessions?: LiveSessionView[];
  settings?: HandoffSettingsView;
  guard?: SecretGuardStatusView;
  routes?: Record<string, (body: unknown) => unknown>;
}

/** Mounts Settings against a fake Core whose notes can be changed by the test. */
function mount(setup: Setup = {}) {
  const state = {
    notes: setup.notes ?? [note()],
    texts: setup.texts ?? { hn_1: "# Handoff\n\nFiles: src/a.ts" },
    settings: setup.settings ?? { auto: true, allow_cloud: false },
    guard: setup.guard ?? { allowed: 0, blocked: 0, overridden: 0, since: null, recent: [] },
  };
  const m = openAt("#/settings", {
    "GET /api/handoff/notes": () => ({ notes: state.notes }),
    "GET /api/handoff/notes/*": (_body, url) => {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const found = state.notes.find((n) => n.id === id);
      return found ? { ...found, text: state.texts[id] ?? "" } : json({ message: "No" }, 404);
    },
    "GET /api/handoff/settings": () => state.settings,
    "GET /api/secret-guard": () => state.guard,
    "GET /api/agent/sessions": () => ({ sessions: setup.sessions ?? [] }),
    ...setup.routes,
  });
  return { ...m, state };
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Handoff notes" })).closest("section")!);

type Section = BoundFunctions<typeof queries>;

/** Opens the first listed note and waits for its text. */
async function openFirst(s: Section) {
  const list = await s.findByRole("list", { name: "Handoff notes" });
  fireEvent.click(within(list).getAllByRole("button")[0]!);
  const region = within(await s.findByRole("region", { name: "Selected note" }));
  await region.findByLabelText("Note text");
  return region;
}

const writes = (m: { api: { calls: { method: string; path: string; body?: unknown }[] } }) =>
  m.api.calls.filter((c) => c.method !== "GET");

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("Settings: Handoff notes", () => {
  it("lists notes with their counts and shows the redacted text of the one opened", async () => {
    mount({
      texts: { hn_1: "Ran: curl -H [redacted] https://example.test\nFiles: src/a.ts" },
    });
    const s = await section();
    expect(await s.findByText(/proj · 2 files · \+10 −3/)).toBeTruthy();
    expect(s.queryByLabelText("Note text")).toBeNull();

    const detail = await openFirst(s);
    expect(detail.getByLabelText("Note text").textContent).toBe(
      "Ran: curl -H [redacted] https://example.test\nFiles: src/a.ts",
    );
    expect(detail.getByText("Written automatically")).toBeTruthy();
    expect(detail.getByLabelText("Note text").tagName).toBe("PRE");
  });

  it("reloads the list when a handoff.note.* event arrives", async () => {
    const m = mount();
    const s = await section();
    await s.findByText(/proj · 2 files/);
    m.state.notes = [note(), note({ id: "hn_2", project: "second" })];
    sendEvent(m.ws, 1, "handoff.note.created");
    expect(await s.findByText(/second · 2 files/)).toBeTruthy();
  });

  it("renders hostile text from notes, summaries and the secret guard as inert text", async () => {
    mount({
      notes: [
        note({
          agent: XSS,
          project: XSS,
          summary: {
            text: XSS,
            provider: "ollama",
            model: "llama",
            locality: "local",
            processed_by: XSS,
            at: "2026-10-09T12:05:00Z",
          },
        }),
      ],
      texts: { hn_1: XSS },
      guard: {
        allowed: 0,
        blocked: 1,
        overridden: 0,
        since: "2026-10-09T12:00:00Z",
        recent: [
          {
            at: "2026-10-09T12:00:00Z",
            outcome: "blocked",
            agent: XSS,
            tool: XSS,
            findings: [{ kind: XSS, location: XSS }],
          },
        ],
      },
    });
    const s = await section();
    await openFirst(s);
    expectInert(document.body);
    expect(s.queryAllByRole("link")).toEqual([]);
  });

  it("writes a note for the chosen session with its id and agent, then shows it", async () => {
    const m = mount({
      notes: [],
      sessions: [session()],
      routes: {
        "POST /api/handoff/notes": () => {
          const made = note({ id: "hn_9", trigger: "user", project: "fresh" });
          m.state.notes = [made];
          m.state.texts.hn_9 = "# Fresh note";
          return json({ ...made, text: "# Fresh note" }, 201);
        },
      },
    });
    const s = await section();
    expect(await s.findByText("No handoff note has been written yet.")).toBeTruthy();
    await s.findByRole("option", { name: /^claude · acme\/app/ });
    const generate = s.getByRole("button", { name: "Write a note" }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);

    fireEvent.change(s.getByLabelText("Session"), { target: { value: "sess_1" } });
    fireEvent.click(generate);

    expect((await s.findByLabelText("Note text")).textContent).toBe("# Fresh note");
    expect(m.api.posts("/api/handoff/notes")[0]!.body).toEqual({
      session_id: "sess_1",
      agent: "claude",
    });
    expect(s.getByText("You asked for it")).toBeTruthy();
    expect(await s.findByText(/fresh · 2 files/)).toBeTruthy();
    expect(s.getByRole("status").textContent).toBe("Note written.");
  });

  it("says so when there is no session to write a note for", async () => {
    mount({ notes: [], sessions: [] });
    const s = await section();
    expect(await s.findByText(/nothing to write a note about/)).toBeTruthy();
    expect(s.queryByRole("button", { name: "Write a note" })).toBeNull();
  });

  it("shows Core's refusal of a model summary in an alert and keeps the note", async () => {
    const m = mount({
      routes: {
        "POST /api/handoff/notes/hn_1/summary": () =>
          json({ code: "FORBIDDEN", message: "Only a model on this device may write this." }, 403),
      },
    });
    const s = await section();
    const detail = await openFirst(s);
    fireEvent.click(detail.getByRole("button", { name: "Add a model summary" }));

    expect((await s.findByRole("alert")).textContent).toBe(
      "Only a model on this device may write this.",
    );
    expect(detail.getByLabelText("Note text").textContent).toContain("Files: src/a.ts");
    expect(detail.queryByRole("heading", { name: "Model summary" })).toBeNull();
    expect(m.api.posts("/api/handoff/notes/hn_1/summary")[0]!.body).toEqual({});
    expect(
      (detail.getByRole("button", { name: "Delete note" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows an added summary with who wrote it and that it may be wrong", async () => {
    mount({
      routes: {
        "POST /api/handoff/notes/hn_1/summary": () => ({
          ...note({
            summary: {
              text: "The agent fixed the parser.",
              provider: "ollama",
              model: "llama3.2",
              locality: "local",
              processed_by: "Ollama · llama3.2 · on this device",
              at: "2026-10-09T12:05:00Z",
            },
          }),
          text: "# Handoff",
        }),
      },
    });
    const s = await section();
    const detail = await openFirst(s);
    fireEvent.click(detail.getByRole("button", { name: "Add a model summary" }));

    expect(await detail.findByText("The agent fixed the parser.")).toBeTruthy();
    expect(detail.getByText("Written by: Ollama · llama3.2 · on this device")).toBeTruthy();
    expect(detail.getByText(/may be wrong/)).toBeTruthy();
  });

  it("deletes the opened note and closes it", async () => {
    const m = mount({
      routes: {
        "DELETE /api/handoff/notes/hn_1": () => {
          m.state.notes = [];
          return { id: "hn_1", deleted: true };
        },
      },
    });
    const s = await section();
    const detail = await openFirst(s);
    fireEvent.click(detail.getByRole("button", { name: "Delete note" }));
    expect(await s.findByText("No handoff note has been written yet.")).toBeTruthy();
    expect(s.queryByRole("region", { name: "Selected note" })).toBeNull();
    expect(writes(m).map((c) => c.method)).toEqual(["DELETE"]);
  });

  describe("attach", () => {
    it("previews a commit message, then confirms with the preview's hash and copies exactly that text", async () => {
      const copied: string[] = [];
      stubClipboard(async (text) => {
        copied.push(text);
      });
      const text = "Handoff: 2 files changed (+10 -3)\n\nOpen question: none";
      const m = mount({
        routes: {
          "POST /api/handoff/notes/hn_1/attach": (body) =>
            has(body, "confirm_hash") ? appliedOf({ text }) : previewOf({ text, hash: "hash_abc" }),
        },
      });
      const s = await section();
      const detail = await openFirst(s);
      fireEvent.click(detail.getByRole("button", { name: "Preview" }));

      const preview = within(
        await s.findByRole("region", { name: "Preview of what will be attached" }),
      );
      expect(preview.getByText(/Phoenix writes this nowhere/)).toBeTruthy();
      expect(preview.getByText("Nothing is written by Phoenix.")).toBeTruthy();
      expect(preview.getByText(/Handoff: 2 files changed/).textContent).toBe(text);
      expect(copied).toEqual([]);

      fireEvent.click(preview.getByRole("button", { name: "Confirm" }));
      expect((await s.findByRole("status")).textContent).toContain("Copied to the clipboard");

      expect(copied).toEqual([text]);
      expect(writes(m).map((c) => [c.method, c.path, c.body])).toEqual([
        ["POST", "/api/handoff/notes/hn_1/attach", { target: "commit_message" }],
        [
          "POST",
          "/api/handoff/notes/hn_1/attach",
          { target: "commit_message", confirm_hash: "hash_abc" },
        ],
      ]);
      expect(s.queryByRole("region", { name: "Preview of what will be attached" })).toBeNull();
    });

    it("shows the text to copy by hand when the clipboard refuses", async () => {
      stubClipboard(async () => {
        throw new Error("denied");
      });
      mount({
        routes: {
          "POST /api/handoff/notes/hn_1/attach": (body) =>
            has(body, "confirm_hash") ? appliedOf() : previewOf(),
        },
      });
      const s = await section();
      const detail = await openFirst(s);
      fireEvent.click(detail.getByRole("button", { name: "Preview" }));
      fireEvent.click(await s.findByRole("button", { name: "Confirm" }));

      expect(await s.findByText(/copy it by hand/)).toBeTruthy();
      expect(s.queryByText(/Copied to the clipboard/)).toBeNull();
      expect(s.getAllByText("Handoff: 2 files changed (+10 -3)")).toHaveLength(1);
    });

    it("tells the user plainly that a pull request description is copy only", async () => {
      mount({
        routes: {
          "POST /api/handoff/notes/hn_1/attach": () => previewOf({ target: "pr_description" }),
        },
      });
      const s = await section();
      const detail = await openFirst(s);
      fireEvent.change(detail.getByLabelText("Where it goes"), {
        target: { value: "pr_description" },
      });
      fireEvent.click(detail.getByRole("button", { name: "Preview" }));
      expect(
        await s.findByText(/no command that edits a pull request description yet: copy only/),
      ).toBeTruthy();
    });

    it("asks for a valid owner/name before any preview request is sent", async () => {
      const m = mount({
        routes: {
          "POST /api/handoff/notes/hn_1/attach": () =>
            previewOf({
              target: "task",
              delivery: "github_issue",
              wired: true,
              title: "Handoff from claude",
            }),
        },
      });
      const s = await section();
      const detail = await openFirst(s);
      fireEvent.change(detail.getByLabelText("Where it goes"), { target: { value: "task" } });
      const repo = detail.getByLabelText("GitHub repository (owner/name)");
      const preview = detail.getByRole("button", { name: "Preview" });

      for (const bad of ["", "acme", "acme/..", "-x/app", "a b/c", "acme/app/extra"]) {
        fireEvent.change(repo, { target: { value: bad } });
        fireEvent.click(preview);
        expect((await s.findByRole("alert")).textContent).toContain("owner/name");
      }
      expect(m.api.posts("/api/handoff/notes/hn_1/attach")).toHaveLength(0);

      fireEvent.change(repo, { target: { value: "acme/app" } });
      fireEvent.click(preview);
      expect(await s.findByText(/create a GitHub issue in acme\/app/)).toBeTruthy();
      expect(s.queryByRole("alert")).toBeNull();
      expect(s.getByText("Issue title: Handoff from claude")).toBeTruthy();
      expect(m.api.posts("/api/handoff/notes/hn_1/attach")[0]!.body).toEqual({
        target: "task",
        repository: "acme/app",
      });
    });

    it.each([
      ["https://github.com/acme/app/issues/7", true],
      ["http://example.test/issues/7", false],
    ])("links the created issue only when it is https: %s", async (url, linked) => {
      const m = mount({
        routes: {
          "POST /api/handoff/notes/hn_1/attach": (body) =>
            has(body, "confirm_hash")
              ? appliedOf({
                  target: "task",
                  delivery: "github_issue",
                  copy_only: false,
                  issue: { repository: "acme/app", number: 7, url, status: "created" },
                })
              : previewOf({ target: "task", delivery: "github_issue", wired: true, title: "T" }),
        },
      });
      const s = await section();
      const detail = await openFirst(s);
      fireEvent.change(detail.getByLabelText("Where it goes"), { target: { value: "task" } });
      fireEvent.change(detail.getByLabelText("GitHub repository (owner/name)"), {
        target: { value: "acme/app" },
      });
      fireEvent.click(detail.getByRole("button", { name: "Preview" }));
      fireEvent.click(await s.findByRole("button", { name: "Confirm" }));

      const status = within(await s.findByRole("status"));
      expect(status.getByText("Created issue #7 in acme/app.")).toBeTruthy();
      expect(status.getByText(url, { exact: false })).toBeTruthy();
      if (linked) expect(status.getByRole("link", { name: url }).getAttribute("href")).toBe(url);
      else expect(status.queryByRole("link")).toBeNull();
      expect(m.api.posts("/api/handoff/notes/hn_1/attach")[1]!.body).toEqual({
        target: "task",
        repository: "acme/app",
        confirm_hash: "hash_1",
      });
    });

    it("marks the preview stale on 409 and needs a new preview before confirming", async () => {
      let hash = 0;
      const m = mount({
        routes: {
          "POST /api/handoff/notes/hn_1/attach": (body) =>
            has(body, "confirm_hash")
              ? json({ code: "CONFLICT", message: "The note changed since the preview." }, 409)
              : previewOf({ hash: `hash_${++hash}` }),
        },
      });
      const s = await section();
      const detail = await openFirst(s);
      fireEvent.click(detail.getByRole("button", { name: "Preview" }));
      fireEvent.click(await s.findByRole("button", { name: "Confirm" }));

      expect((await s.findByRole("alert")).textContent).toContain(
        "The note changed since the preview.",
      );
      expect(s.getByText(/Preview it again/)).toBeTruthy();
      expect(s.queryByRole("button", { name: "Confirm" })).toBeNull();

      fireEvent.click(s.getByRole("button", { name: "Preview again" }));
      expect(await s.findByRole("button", { name: "Confirm" })).toBeTruthy();
      expect(s.queryByRole("alert")).toBeNull();
      expect(m.api.posts("/api/handoff/notes/hn_1/attach").map((c) => c.body)).toEqual([
        { target: "commit_message" },
        { target: "commit_message", confirm_hash: "hash_1" },
        { target: "commit_message" },
      ]);
    });

    it("drops the preview on Cancel and when the target changes, sending nothing more", async () => {
      const m = mount({
        routes: { "POST /api/handoff/notes/hn_1/attach": () => previewOf() },
      });
      const s = await section();
      const detail = await openFirst(s);
      const name = { name: "Preview of what will be attached" };

      fireEvent.click(detail.getByRole("button", { name: "Preview" }));
      fireEvent.click(
        within(await s.findByRole("region", name)).getByRole("button", { name: "Cancel" }),
      );
      await waitFor(() => expect(s.queryByRole("region", name)).toBeNull());

      fireEvent.click(detail.getByRole("button", { name: "Preview" }));
      await s.findByRole("region", name);
      fireEvent.change(detail.getByLabelText("Where it goes"), {
        target: { value: "pr_description" },
      });
      expect(s.queryByRole("region", name)).toBeNull();
      expect(m.api.posts("/api/handoff/notes/hn_1/attach")).toHaveLength(2);
    });
  });

  it("shows the secret guard's counts, kinds and places, and nothing the Core did not name", async () => {
    // A hostile or buggy Core may add fields; only the documented names are ever shown.
    const secret = ["gh", "p_", "Zq81", "x".repeat(32)].join("");
    // Not a fresh literal, so the extra field is allowed through the type, as a wire body would.
    const leaky = { kind: "github_token", location: "tool_input.command line 1", value: secret };
    const guard: SecretGuardStatusView = {
      allowed: 2,
      blocked: 1,
      overridden: 1,
      since: "2026-10-01T09:00:00Z",
      recent: [
        {
          at: "2026-10-09T12:00:00Z",
          outcome: "blocked",
          agent: "claude",
          tool: "Bash",
          findings: [leaky],
        },
        {
          at: "2026-10-09T12:01:00Z",
          outcome: "overridden",
          agent: "codex",
          tool: "git push",
          findings: [{ kind: "private_key", location: "staged diff src/a.ts" }],
        },
      ],
    };
    const m = mount({ guard });
    const s = await section();

    expect(await s.findByText("github_token at tool_input.command line 1")).toBeTruthy();
    expect(s.getByText("private_key at staged diff src/a.ts")).toBeTruthy();
    expect(s.getByText("blocked")).toBeTruthy();
    expect(s.getByText("allowed after you approved it")).toBeTruthy();
    expect(s.getByText("Allowed after a check: 2")).toBeTruthy();
    expect(s.getByText("Blocked: 1")).toBeTruthy();
    expect(s.getByText("Allowed after you approved it: 1")).toBeTruthy();
    expect(s.getByText(/Counted since/)).toBeTruthy();
    expect(s.getByText(/never the secret itself/)).toBeTruthy();
    expect(s.getByText(/fails open/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.innerHTML).not.toContain(secret);

    m.state.guard = { ...guard, blocked: 2 };
    sendEvent(m.ws, 1, "secret_guard.blocked");
    expect(await s.findByText("Blocked: 2")).toBeTruthy();
  });

  it("says when the guard has no results yet", async () => {
    mount();
    const s = await section();
    expect(await s.findByText("No results yet.")).toBeTruthy();
    expect(s.queryByRole("list", { name: "Recent secret guard results" })).toBeNull();
  });

  it("posts allow_cloud when toggled, saves, and shows what it means for the note text", async () => {
    const m = mount({
      routes: {
        "POST /api/handoff/settings": (body) => ({
          auto: true,
          allow_cloud: has(body, "allow_cloud", true),
        }),
      },
    });
    const s = await section();
    const box = (await s.findByRole("checkbox", {
      name: /Let a cloud model write the optional summary/,
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    const warning = s.getByText(/redacted commands and file names\) can leave this computer/);
    expect(warning.textContent).toContain("cloud permissions in the AI settings still apply");
    expect(box.getAttribute("aria-describedby")).toBe(warning.id);

    fireEvent.click(box);
    expect((await s.findByRole("status")).textContent).toBe("Settings saved.");
    expect(m.api.posts("/api/handoff/settings").map((c) => c.body)).toEqual([
      { allow_cloud: true },
    ]);
    expect(box.checked).toBe(true);
  });

  it("posts auto when toggled off", async () => {
    const m = mount({
      routes: {
        "POST /api/handoff/settings": (body) => ({
          auto: has(body, "auto", true),
          allow_cloud: false,
        }),
      },
    });
    const s = await section();
    const box = (await s.findByRole("checkbox", {
      name: "Write a note when an agent session ends",
    })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(false));
    expect(m.api.posts("/api/handoff/settings").map((c) => c.body)).toEqual([{ auto: false }]);
  });
});
