// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 62 in the browser: dropping text, an image and a folder (fake File / DataTransfer / directory
// entries: a real drag from Finder is NOT exercised here), the tray, removal before anything is asked,
// the ask flow, the Pet Panel drop target, and the draft-email link. Every assertion on data that
// Core returns waits for it (findBy / waitFor).
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DROP_LIMITS,
  MAIL_LIMITS,
  buildMailto,
  collectDropped,
  dragHasFiles,
  isTextFile,
  openMailto,
  readDropped,
  type AttachmentAnswer,
  type AttachmentDetail,
  type AttachmentSummary,
  type DataTransferLike,
  type EntryLike,
  type FileLike,
} from "../src/core/attachments";
import { FakeWebSocket } from "./fake-ws";
import { fakeApi } from "./fake-api";
import { mount, openPanel, openTab } from "./harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  delete (window as { __TAURI__?: unknown }).__TAURI__;
});

// ── Fakes ───────────────────────────────────────────────────────────────────────────────────────

const fakeFile = (name: string, content: string, type = "text/plain"): FileLike => ({
  name,
  type,
  size: new TextEncoder().encode(content).length,
  text: () => Promise.resolve(content),
});

/** A dropped file entry, a folder entry, a "symlink" (neither) and an unreadable one. */
const fileEntry = (name: string, content: string, type = "text/plain"): EntryLike => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (ok) => ok(fakeFile(name, content, type)),
});
const unreadableEntry = (name: string): EntryLike => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (_ok, fail) => fail(new Error("denied")),
});
const symlinkLooking = (name: string): EntryLike => ({ isFile: false, isDirectory: false, name });
function dirEntry(name: string, children: EntryLike[]): EntryLike {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader() {
      let served = false;
      return {
        // Like the browser: a batch, then an empty batch.
        readEntries(ok) {
          if (served) return ok([]);
          served = true;
          ok(children);
        },
      };
    },
  };
}

const transfer = (parts: { files?: FileLike[]; entries?: EntryLike[] }): DataTransferLike => {
  const entries = parts.entries ?? [];
  const files = parts.files ?? [];
  return {
    types: ["Files"],
    files,
    items: [
      ...entries.map((entry) => ({
        kind: "file",
        webkitGetAsEntry: () => entry,
        getAsFile: () => null,
      })),
      ...files.map((file) => ({
        kind: "file",
        webkitGetAsEntry: () => null,
        getAsFile: () => file,
      })),
    ],
  };
};

// ── A Core that keeps attachments ───────────────────────────────────────────────────────────────

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const B64_PNG = btoa(String.fromCharCode(...PNG));

interface Stored extends AttachmentDetail {}

interface Core62 {
  store: Stored[];
  routes: Record<string, (body: unknown, url: URL) => unknown>;
}

function core(
  seed: Partial<AttachmentSummary & { content: string }>[] = [],
  answer: Partial<AttachmentAnswer> = {},
): Core62 & { make: (over: Partial<Stored>) => Stored } {
  const store: Stored[] = [];
  let n = 0;
  const make = (over: Partial<Stored>): Stored => {
    n++;
    const content = over.content ?? "x";
    return {
      id: `att_${String(n).padStart(32, "0")}`,
      name: "x.txt",
      kind: "text",
      mime: "text/plain",
      origin: "drop",
      bytes: content.length,
      preview: over.kind && over.kind !== "text" ? null : content.slice(0, 300),
      files: null,
      created_at: "2026-10-16T09:00:00.000Z",
      expires_at: "2026-10-16T10:00:00.000Z",
      content,
      ...over,
    };
  };
  for (const s of seed) store.push(make(s as Partial<Stored>));
  const summary = ({ content: _content, ...rest }: Stored): AttachmentSummary => rest;
  const routes: Core62["routes"] = {
    "GET /api/attachments": () => ({
      attachments: store.map(summary),
      total_bytes: 0,
      limits: { max_count: 10, max_total_bytes: 8 * 1024 * 1024, ttl_ms: 3_600_000 },
    }),
    "POST /api/attachments": (body: unknown) => {
      const b = body as Pick<Stored, "name" | "kind" | "mime" | "origin" | "content">;
      const item = make({
        ...b,
        mime: b.kind === "image" ? "image/png" : b.mime,
        files:
          b.kind === "folder" ? (JSON.parse(b.content) as { files: unknown[] }).files.length : null,
      });
      store.push(item);
      return new Response(JSON.stringify(summary(item)), { status: 201 });
    },
    "POST /api/attachments/ask": (body: unknown) => {
      const ids = (body as { attachment_ids: string[] }).attachment_ids;
      const full: AttachmentAnswer = {
        answer: "The note says the release is on Friday.",
        processed_by: "Ollama (this device) · llama3.2 · on this device",
        model: "llama3.2",
        provider: "ollama",
        locality: "local",
        usage: null,
        cost: null,
        vision_model: null,
        sources: store.filter((s) => ids.includes(s.id)).map((s) => ({ id: s.id, name: s.name })),
        ...answer,
      };
      return full;
    },
  };
  const idOf = (url: URL) => decodeURIComponent(url.pathname.split("/").pop() ?? "");
  const wildcard = {
    "GET /api/attachments/*": (_body: unknown, url: URL) => {
      const item = store.find((x) => x.id === idOf(url));
      return item
        ? item
        : new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Not found" }), {
            status: 404,
          });
    },
    "DELETE /api/attachments/*": (_body: unknown, url: URL) => {
      const at = store.findIndex((x) => x.id === idOf(url));
      if (at >= 0) store.splice(at, 1);
      return { deleted: true };
    },
    "DELETE /api/attachments": () => {
      const deleted = store.length;
      store.length = 0;
      return { deleted };
    },
  };
  Object.assign(routes, wildcard);
  return { store, routes, make };
}

const liveCore = core;

function openChat(c: Core62, extra: Parameters<typeof mount>[0] = {}) {
  const m = mount({ ...c.routes, ...extra });
  openPanel();
  openTab("Chat");
  return m;
}

const zone = () => screen.getByRole("group", { name: "Drop files on the chat box" });
const drop = (dt: DataTransferLike) => fireEvent.drop(zone(), { dataTransfer: dt });
const tray = () => screen.findByRole("region", { name: "Attachments" });
const box = () => screen.getByLabelText("Message to Fawkes") as HTMLTextAreaElement;

describe("the tray", () => {
  it("is not there when nothing is attached, and shows a Local only badge when something is", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    await waitFor(() => expect(api.calls.some((x) => x.path === "/api/attachments")).toBe(true));
    expect(screen.queryByRole("region", { name: "Attachments" })).toBeNull();
    drop(transfer({ files: [fakeFile("note.txt", "hello")] }));
    const region = await tray();
    expect(within(region).getByText("Local only")).toBeTruthy();
    expect(within(region).getByText("note.txt")).toBeTruthy();
    expect(region.textContent).toMatch(/never saved to disk/);
    expect(region.textContent).toMatch(/Nothing leaves this device/);
  });

  it("lists a window attachment with its origin and shows its full captured text on Preview", async () => {
    const full = "Window title: Budget\n" + "line of captured text\n".repeat(60);
    const c = liveCore([{ name: "Budget.xlsx — Excel", origin: "window", content: full }]);
    openChat(c);
    const region = await tray();
    expect(region.textContent).toContain("window");
    expect(within(region).getByText(/^Window title: Budget/)).toBeTruthy(); // the 300-char preview
    fireEvent.click(within(region).getByRole("button", { name: "Preview Budget.xlsx — Excel" }));
    const pre = await within(region).findByLabelText("Contents of Budget.xlsx — Excel");
    expect(pre.textContent).toBe(full);
  });

  it("renders names and content as text, never as markup", async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    const c = liveCore([{ name: evil, content: evil }]);
    openChat(c);
    const region = await tray();
    expect(region.querySelector("script, img")).toBeNull();
    expect(within(region).getAllByText(evil).length).toBeGreaterThan(0);
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe("dropping on the chat box", () => {
  it("a text file: read with file.text() and posted with its name, type, origin drop and content", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    drop(transfer({ files: [fakeFile("notes.md", "# Plan\nship it", "text/markdown")] }));
    await screen.findByText("notes.md");
    expect(api.posts("/api/attachments")).toEqual([
      {
        method: "POST",
        path: "/api/attachments",
        body: {
          name: "notes.md",
          kind: "text",
          mime: "text/markdown",
          origin: "drop",
          content: "# Plan\nship it",
        },
      },
    ]);
    expect((await screen.findByRole("status")).textContent).toMatch(/Attached 1 item/);
  });

  it("an image: read with FileReader as base64 and posted as kind image", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    const png = new File([PNG], "shot.png", { type: "image/png" });
    drop({
      types: ["Files"],
      files: [png as unknown as FileLike],
      items: [{ kind: "file", getAsFile: () => png as unknown as FileLike }],
    });
    await screen.findByText("shot.png");
    const body = api.posts("/api/attachments")[0]!.body as Record<string, string>;
    expect(body).toMatchObject({
      name: "shot.png",
      kind: "image",
      mime: "image/png",
      origin: "drop",
    });
    expect(body.content).toBe(B64_PNG);
    // Previewing an image shows it (from Core's stored bytes), with a text alternative.
    fireEvent.click(screen.getByRole("button", { name: "Preview shot.png" }));
    const img = (await screen.findByAltText("Preview of shot.png")) as HTMLImageElement;
    expect(img.src).toBe(`data:image/png;base64,${B64_PNG}`);
  });

  it("a folder: walked with the entry API, dot-directories, node_modules and .git skipped, odd entries refused", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    const project = dirEntry("project", [
      fileEntry("README.md", "# Project"),
      fileEntry("main.ts", "export const x = 1;", "video/mp2t"),
      fileEntry("logo.bin", "\u0001\u0002", "application/octet-stream"),
      fileEntry(".env", "SECRET=never"),
      dirEntry(".git", [fileEntry("config", "[core]")]),
      dirEntry("node_modules", [fileEntry("dep.js", "x")]),
      dirEntry(".hidden", [fileEntry("a.txt", "a")]),
      dirEntry("src", [fileEntry("util.ts", "export {}")]),
      symlinkLooking("linked-to-secret"),
      unreadableEntry("locked.txt"),
      fileEntry("evil\u202Egnp.txt", "x"),
      fileEntry("a\nb.txt", "x"),
    ]);
    drop(transfer({ entries: [project] }));
    await screen.findByText("project");
    const body = api.posts("/api/attachments")[0]!.body as {
      name: string;
      kind: string;
      mime: string;
      content: string;
    };
    expect(body).toMatchObject({ name: "project", kind: "folder", mime: "inode/directory" });
    const files = (
      JSON.parse(body.content) as { files: { path: string; bytes: number; text?: string }[] }
    ).files;
    expect(files.map((f) => f.path).sort()).toEqual([
      "README.md",
      "logo.bin",
      "main.ts",
      "src/util.ts",
    ]);
    expect(files.find((f) => f.path === "README.md")!.text).toBe("# Project");
    expect(files.find((f) => f.path === "logo.bin")).toEqual({ path: "logo.bin", bytes: 2 }); // listed, no content
    expect(JSON.stringify(files)).not.toMatch(/SECRET|\[core\]|dep\.js/);
    // Every skip is said out loud, not hidden.
    const note = (await screen.findByRole("alert")).textContent!;
    expect(note).toMatch(/skipped 4 hidden files and folders/);
    expect(note).toMatch(/skipped 1 entries that are neither a file nor a folder/);
    expect(note).toMatch(/skipped 1 files that could not be read/);
    expect(note).toMatch(/skipped 2 entries with an unusual name/);
  });

  it("an empty folder, and one with nothing readable, attach nothing and say why", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    drop(
      transfer({ entries: [dirEntry("empty", []), dirEntry("locked", [unreadableEntry("a")])] }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Nothing was attached/);
    expect(alert.textContent).toMatch(/empty: no readable files were found/);
    expect(api.posts("/api/attachments")).toEqual([]);
  });

  it("a folder stops at 200 files and says so", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    const many = dirEntry(
      "big",
      Array.from({ length: 230 }, (_, i) => fileEntry(`f${i}.txt`, "x")),
    );
    drop(transfer({ entries: [many] }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /only the first 200 files were listed/,
    );
    const body = api.posts("/api/attachments")[0]!.body as { content: string };
    expect((JSON.parse(body.content) as { files: unknown[] }).files).toHaveLength(200);
  });

  it("a file over the cap, an unsupported type and a hostile name are not posted, each with its reason", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    drop(
      transfer({
        files: [
          fakeFile("big.txt", "y".repeat(DROP_LIMITS.textChars + 1)),
          fakeFile("movie.mov", "binary", "video/quicktime"),
          fakeFile("a\u202Eb.txt", "hello"),
          fakeFile("empty.txt", ""),
        ],
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/big\.txt: too large/);
    expect(alert.textContent).toMatch(/movie\.mov: not a supported type/);
    expect(alert.textContent).toMatch(/hidden characters/);
    expect(alert.textContent).toMatch(/empty\.txt: the file is empty/);
    expect(alert.textContent).toMatch(/Nothing was attached/);
    expect(api.posts("/api/attachments")).toEqual([]);
  });

  it("a refusal from Core is shown with its message and the rest of the drop still goes through", async () => {
    const c = liveCore();
    const refuse = new Response(
      JSON.stringify({
        code: "INVALID_REQUEST",
        message: "At most 10 attachments at once. Remove one first.",
      }),
      { status: 400 },
    );
    let calls = 0;
    const accept = c.routes["POST /api/attachments"]!;
    openChat(c, {
      "POST /api/attachments": (body, url) => (++calls === 1 ? refuse : accept(body, url)),
    });
    drop(transfer({ files: [fakeFile("one.txt", "1"), fakeFile("two.txt", "2")] }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/one\.txt: At most 10 attachments/);
    expect(calls).toBe(2);
  });

  it("ignores a drag that carries no files (selected text, a link)", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    fireEvent.drop(zone(), { dataTransfer: { types: ["text/plain"], files: [], items: [] } });
    await Promise.resolve();
    expect(api.posts("/api/attachments")).toEqual([]);
    expect(screen.queryByRole("status", { name: "" })).toBeNull();
  });

  it("highlights while files are dragged over and clears on leave", async () => {
    openChat(liveCore());
    fireEvent.dragEnter(zone(), { dataTransfer: { types: ["Files"] } });
    expect(zone().className).toContain("drop-zone-over");
    expect(zone().textContent).toContain("Drop to attach.");
    fireEvent.dragLeave(zone(), { dataTransfer: { types: ["Files"] } });
    expect(zone().className).not.toContain("drop-zone-over");
  });

  it("offers a keyboard route: Attach files… opens the picker, and picked files are attached the same way", async () => {
    const c = liveCore();
    const { api } = openChat(c);
    fireEvent.click(screen.getByRole("button", { name: "attach files…" }));
    const input = screen.getByLabelText("Choose files to attach") as HTMLInputElement;
    const file = new File(["picked text"], "picked.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("picked.txt");
    expect((api.posts("/api/attachments")[0]!.body as { content: string }).content).toBe(
      "picked text",
    );
  });
});

describe("removal before anything is asked", () => {
  it("Remove deletes one in Core and from the tray; Clear all deletes the rest; nothing was asked", async () => {
    const c = liveCore([
      { name: "a.txt", content: "A" },
      { name: "b.txt", content: "B" },
      { name: "c.txt", content: "C" },
    ]);
    const { api } = openChat(c);
    const region = await tray();
    fireEvent.click(within(region).getByRole("button", { name: "Remove b.txt" }));
    await waitFor(() => expect(screen.queryByText("b.txt")).toBeNull());
    const deletes = api.calls.filter((x) => x.method === "DELETE").map((x) => x.path);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/^\/api\/attachments\/att_/);
    expect(c.store.map((s) => s.name)).toEqual(["a.txt", "c.txt"]);
    fireEvent.click(within(region).getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Attachments" })).toBeNull());
    expect(api.calls.some((x) => x.path === "/api/attachments" && x.method === "DELETE")).toBe(
      true,
    );
    expect(api.posts("/api/attachments/ask")).toEqual([]);
  });
});

describe("Ask about attachments", () => {
  const ask = (text: string) => {
    fireEvent.change(box(), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Ask about attachments" }));
  };

  it("sends the question with the ticked attachments only; the reply joins the conversation as text", async () => {
    const c = liveCore([
      { name: "a.txt", content: "A" },
      { name: "b.txt", content: "B" },
    ]);
    const { api } = openChat(c);
    await tray();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include b.txt in the question" }));
    ask("  when is the release?  ");
    await screen.findByText("The note says the release is on Friday.");
    const posted = api.posts("/api/attachments/ask");
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toEqual({
      question: "when is the release?",
      attachment_ids: [c.store[0]!.id],
    });
    const log = screen.getByRole("list", { name: "Conversation" });
    expect(log.textContent).toContain("when is the release?");
    expect(log.textContent).toContain("(about: a.txt)");
    expect(log.textContent).toContain("free, on this device");
    expect(log.textContent).toContain("Generated text, not a stored fact.");
    expect(box().value).toBe("");
  });

  it("is disabled with nothing ticked, and without a question", async () => {
    const c = liveCore([{ name: "a.txt", content: "A" }]);
    const { api } = openChat(c);
    await tray();
    const button = () =>
      screen.getByRole("button", { name: "Ask about attachments" }) as HTMLButtonElement;
    expect(button().disabled).toBe(true); // no question yet
    fireEvent.change(box(), { target: { value: "q" } });
    expect(button().disabled).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include a.txt in the question" }));
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(api.posts("/api/attachments/ask")).toEqual([]);
  });

  it("an answer containing markup is shown as text", async () => {
    const c = liveCore([{ name: "a.txt", content: "A" }], {
      answer: "<script>window.__pwned=1</script><b>bold</b>",
    });
    openChat(c);
    await tray();
    ask("q?");
    const text = await screen.findByText("<script>window.__pwned=1</script><b>bold</b>");
    expect(text.querySelector("script, b")).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("a refusal (no local vision model) is shown as the conversation's error, naming the cause", async () => {
    const c = liveCore([{ name: "pic.png", kind: "image", mime: "image/png", content: B64_PNG }]);
    openChat(c, {
      "POST /api/attachments/ask": () =>
        new Response(
          JSON.stringify({
            code: "CAPABILITY_DISABLED",
            message:
              "No local vision model is available. Images are only ever read by a model on this device.",
          }),
          { status: 409 },
        ),
    });
    await tray();
    ask("what is on it?");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /Asking about attachments failed: No local vision model is available/,
    );
  });

  it("shows how much will be sent and where, and warns when more than 5 are ticked", async () => {
    const c = liveCore(
      Array.from({ length: 6 }, (_, i) => ({
        name: `f${i}.txt`,
        content: "x",
        origin: "drop" as const,
      })),
    );
    openChat(c);
    const region = await tray();
    expect(region.textContent).toMatch(
      /sends the 6 ticked items, in full, to a model on this device/,
    );
    expect(within(region).getByRole("alert").textContent).toMatch(/at most 5 items/);
    expect(
      (screen.getByRole("button", { name: "Ask about attachments" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("the Pet Panel drop target", () => {
  it("accepts a drop on Fawkes in the Overview, attaches it, and points to the Chat tab", async () => {
    const c = liveCore();
    const { api } = mount(c.routes);
    openPanel();
    const overview = await screen.findByRole("group", { name: "Drop files on Fawkes" });
    fireEvent.drop(overview, {
      dataTransfer: transfer({ files: [fakeFile("idea.txt", "an idea")] }),
    });
    await waitFor(() => expect(api.posts("/api/attachments")).toHaveLength(1));
    await screen.findByText(/1 attached\./);
    expect(overview.textContent).toMatch(/ask about it in the Chat tab/);
    openTab("Chat");
    expect(await screen.findByText("idea.txt")).toBeTruthy();
  });
});

describe("draft email", () => {
  const ANSWER: AttachmentAnswer = {
    answer: "The release is on Friday.",
    processed_by: "Ollama · llama3.2 · on this device",
    model: "llama3.2",
    provider: "ollama",
    locality: "local",
    usage: null,
    cost: null,
    vision_model: null,
    sources: [{ id: "att_1", name: "plan & notes.txt" }],
  };

  it("builds a link with no recipient by default, the subject About: <name>, and everything percent-encoded", () => {
    const built = buildMailto({
      attachmentName: "plan & notes.txt",
      body: "Line 1\nLine 2 & more? 100%",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.url.startsWith("mailto:?subject=")).toBe(true);
    expect(built.url).toBe(
      "mailto:?subject=About%3A%20plan%20%26%20notes.txt&body=Line%201%0D%0ALine%202%20%26%20more%3F%20100%25",
    );
    // No raw separator survives in the values: the only & and ? are ours.
    expect(built.url.match(/&/g)).toHaveLength(1);
    expect(built.url.match(/\?/g)).toHaveLength(1);
    expect(built.url).not.toMatch(/\s/);
  });

  it("puts a typed recipient in the address, and refuses anything that is not one address", () => {
    const ok = buildMailto({ attachmentName: "a", body: "hi", to: "  sam@example.com " });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok && ok.url.startsWith("mailto:sam@example.com?subject=")).toBe(true);
    for (const to of [
      "a@b.c,d@e.f",
      "a@b.co;d@e.fr",
      "sam@example.com?bcc=x@y.zz",
      "sam@example.com&cc=x",
      "no-at-sign",
      "a b@example.com",
      "<sam@example.com>",
      "sam@example.com\r\nbcc: x@y.zz",
    ])
      expect(buildMailto({ attachmentName: "a", body: "hi", to }), to).toMatchObject({ ok: false });
  });

  it("sanitises and caps the subject at 120 characters; hidden characters become spaces", () => {
    const built = buildMailto({
      attachmentName: `a\u202Eb\nc\u0000d ${"n".repeat(300)}`,
      body: "hi",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const subject = decodeURIComponent(/subject=([^&]*)/.exec(built.url)![1]!);
    expect(subject.length).toBeLessThanOrEqual(MAIL_LIMITS.subjectChars);
    expect(subject.startsWith("About: a b c d n")).toBe(true);
    expect(subject).not.toMatch(/[\u0000-\u001F\u202A-\u202E]/);
  });

  it("caps the body at 1500 characters and the whole URL at 1900, refusing instead of cutting", () => {
    expect(buildMailto({ attachmentName: "a", body: "x".repeat(1500) })).toMatchObject({
      ok: true,
    });
    const over = buildMailto({ attachmentName: "a", body: "x".repeat(1501) });
    expect(over).toMatchObject({ ok: false });
    expect(!over.ok && over.reason).toMatch(/1 characters over the 1,500 limit/);
    // 1,500 characters that each encode to 9 bytes blow the URL cap even though the body cap is met.
    const wide = buildMailto({ attachmentName: "a", body: "é".repeat(700) });
    expect(wide).toMatchObject({ ok: false });
    expect(!wide.ok && wide.reason).toMatch(/Mail links this long/);
    expect(buildMailto({ attachmentName: "a", body: "   \n " })).toMatchObject({ ok: false });
    const longest = buildMailto({ attachmentName: "n".repeat(300), body: "y".repeat(1500) });
    expect(longest.ok && longest.url.length).toBeLessThanOrEqual(MAIL_LIMITS.urlChars);
  });

  it("opens through the desktop shell's open_mailto when it exists, otherwise by navigating", async () => {
    const built = buildMailto({ attachmentName: "a", body: "hi" });
    if (!built.ok) throw new Error("expected a link");
    const assign = vi.fn();
    await openMailto(built.url, { location: { assign } });
    expect(assign).toHaveBeenCalledWith(built.url);
    const invoke = vi.fn(() => Promise.resolve());
    const assign2 = vi.fn();
    await openMailto(built.url, { __TAURI__: { core: { invoke } }, location: { assign: assign2 } });
    expect(invoke).toHaveBeenCalledWith("open_mailto", { url: built.url });
    expect(assign2).not.toHaveBeenCalled();
    // Nothing but a mail draft is ever opened.
    for (const bad of [
      "https://example.com",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "mailto:a b",
      "mailto:x\n",
      `mailto:${"a".repeat(2000)}`,
    ])
      await expect(openMailto(bad, { location: { assign } })).rejects.toThrow();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("the form states plainly that Phoenix does not send, lets the user edit, and hands the exact text to the mail app", async () => {
    const invoke = vi.fn(() => Promise.resolve());
    (window as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
    const c = liveCore([{ name: "plan & notes.txt", content: "A" }], { answer: ANSWER.answer });
    openChat(c);
    await tray();
    fireEvent.change(box(), { target: { value: "when?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask about attachments" }));
    await screen.findByText(ANSWER.answer);
    fireEvent.click(screen.getByRole("button", { name: "Draft email" }));
    expect(
      screen.getByText(/Opens your mail app with a draft\. Phoenix does not send it\./),
    ).toBeTruthy();
    expect((screen.getByLabelText(/To \(optional\)/) as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText(/Message \(this exact text/), {
      target: { value: "Edited: the release is Friday." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open mail draft" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("open_mailto", {
      url: "mailto:?subject=About%3A%20plan%20%26%20notes.txt&body=Edited%3A%20the%20release%20is%20Friday.",
    });
  });

  it("an over-long message is refused in the form with the reason, and nothing is opened", async () => {
    const invoke = vi.fn(() => Promise.resolve());
    (window as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
    const c = liveCore([{ name: "a.txt", content: "A" }], { answer: "y".repeat(1600) });
    openChat(c);
    await tray();
    fireEvent.change(box(), { target: { value: "q" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask about attachments" }));
    await screen.findByRole("button", { name: "Draft email" });
    fireEvent.click(screen.getByRole("button", { name: "Draft email" }));
    fireEvent.click(screen.getByRole("button", { name: "Open mail draft" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/100 characters over the 1,500 limit/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("drop helpers", () => {
  it("collectDropped reads entries and files synchronously and prefers directory entries", () => {
    const folder = dirEntry("d", []);
    const file = fakeFile("f.txt", "x");
    const got = collectDropped(transfer({ entries: [folder], files: [file] }));
    expect(got.folders).toEqual([folder]);
    expect(got.files).toEqual([file]);
    // Without items (older browsers) the file list is used.
    expect(collectDropped({ files: [file] })).toEqual({ files: [file], folders: [] });
  });

  it("dragHasFiles is true only for a drag that carries files", () => {
    expect(dragHasFiles({ types: ["Files", "text/plain"] })).toBe(true);
    expect(dragHasFiles({ types: ["text/plain"] })).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });

  it("isTextFile knows common text types by MIME or extension and not binaries", () => {
    for (const f of [
      { name: "a.md", type: "" },
      { name: "a.ts", type: "video/mp2t" },
      { name: "x", type: "application/json" },
      { name: "A.PY", type: "" },
    ])
      expect(isTextFile(f), f.name).toBe(true);
    for (const f of [
      { name: "a.exe", type: "application/x-msdownload" },
      { name: "a.pdf", type: "application/pdf" },
      { name: "constructor", type: "" },
      { name: "__proto__", type: "" },
    ])
      expect(isTextFile(f), f.name).toBe(false);
  });

  it("readDropped never throws: a file whose text() rejects becomes a note", async () => {
    const broken: FileLike = {
      name: "a.txt",
      type: "text/plain",
      size: 3,
      text: () => Promise.reject(new Error("io")),
    };
    const read = await readDropped({ files: [broken], folders: [] });
    expect(read.payloads).toEqual([]);
    expect(read.notes).toEqual(["a.txt: the file could not be read"]);
  });

  it("a Core that goes away mid-drop gives a notice, not a crash", async () => {
    const c = liveCore();
    openChat(c, {
      "POST /api/attachments": () => {
        throw new TypeError("fetch failed");
      },
    });
    drop(transfer({ files: [fakeFile("a.txt", "x")] }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/a\.txt:/);
    await act(async () => {});
  });
});
