// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ApiError, type PhoenixClient } from "./client";
import type { AgentTaskSummary, MemoryAnswer } from "./types";

/** The same cap as POST /api/memory/ask (core/api MAX_QUESTION_CHARS). */
export const CHAT_MAX_CHARS = 500;

export type ChatItem =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "answer"; answer: MemoryAnswer }
  | { id: number; kind: "error"; text: string }
  | { id: number; kind: "task"; taskId: string; title: string };

export interface ChatSnapshot {
  items: readonly ChatItem[];
  /** True only while a request to /api/memory/ask is really in flight. */
  asking: boolean;
  draft: string;
  /** The message box has keyboard focus. */
  focused: boolean;
  /**
   * The user is composing a message: the box has focus and text, and no request is in flight.
   * This is the only condition under which Fawkes shows LISTENING (see `useDisplayedState`).
   */
  listening: boolean;
}

export interface CiTaskInput {
  repository: string;
  runId?: number;
}

const unreachable = "Phoenix Core is unreachable";

function failureText(err: unknown): string {
  return err instanceof ApiError ? err.message : unreachable;
}

/**
 * The conversation of this browser session. It lives in memory only: nothing is written to disk,
 * local storage or Core, and it is gone when the page is reloaded. The only things that leave it
 * are the two API calls it makes (`/api/memory/ask` and `/api/agent/tasks`).
 */
export class ChatStore {
  private snapshot: ChatSnapshot = {
    items: [],
    asking: false,
    draft: "",
    focused: false,
    listening: false,
  };
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: PhoenixClient) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): ChatSnapshot => this.snapshot;

  setDraft(draft: string): void {
    this.set({ draft: draft.slice(0, CHAT_MAX_CHARS) });
  }

  setFocused(focused: boolean): void {
    this.set({ focused });
  }

  /** Sends one question. Ignored while another is in flight, so replies keep the order asked. */
  async ask(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text || text.length > CHAT_MAX_CHARS || this.snapshot.asking) return;
    this.set({ items: [...this.snapshot.items, { id: this.id(), kind: "user", text }], draft: "" });
    this.set({ asking: true });
    try {
      const answer = await this.client.request<MemoryAnswer>("POST", "/api/memory/ask", {
        question: text,
      });
      this.push({ id: this.id(), kind: "answer", answer });
    } catch (err) {
      this.push({
        id: this.id(),
        kind: "error",
        text: `Asking memory failed: ${failureText(err)}.`,
      });
    } finally {
      this.set({ asking: false });
    }
  }

  /** Starts a CI-failure task. Returns null on success, otherwise what went wrong in plain words. */
  async startCiTask(input: CiTaskInput): Promise<string | null> {
    const body = {
      kind: "ci_failure",
      input: {
        repository: input.repository,
        ...(input.runId !== undefined ? { run_id: input.runId } : {}),
      },
    };
    let task: AgentTaskSummary;
    try {
      task = (
        await this.client.request<{ task: AgentTaskSummary }>("POST", "/api/agent/tasks", body)
      ).task;
    } catch (err) {
      if (err instanceof ApiError && err.details.includes("AGENTS_DISABLED")) {
        return "Automation is off, so no task was started. Turn it on in Settings, under Automation.";
      }
      return `Could not start the task: ${failureText(err)}.`;
    }
    const what = input.runId === undefined ? "the latest failed run" : `run ${input.runId}`;
    this.push({
      id: this.id(),
      kind: "user",
      text: `Diagnose a CI failure in ${input.repository} (${what})`,
    });
    this.push({ id: this.id(), kind: "task", taskId: task.id, title: task.title });
    return null;
  }

  private id(): number {
    return this.nextId++;
  }

  private push(item: ChatItem): void {
    this.set({ items: [...this.snapshot.items, item] });
  }

  private set(patch: Partial<ChatSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    this.snapshot = {
      ...next,
      listening: next.focused && next.draft.trim().length > 0 && !next.asking,
    };
    for (const l of this.listeners) l();
  }
}

const stores = new WeakMap<PhoenixClient, ChatStore>();

/** The one conversation of a client (one per browser session). */
export function chatStoreFor(client: PhoenixClient): ChatStore {
  let store = stores.get(client);
  if (!store) {
    store = new ChatStore(client);
    stores.set(client, store);
  }
  return store;
}
