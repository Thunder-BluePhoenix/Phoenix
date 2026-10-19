// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnswerView } from "../src/components/AnswerView";
import { AttachmentsTray, DropZone } from "../src/components/Attachments";
import { Chat } from "../src/components/Chat";
import { DictationSettingsSection } from "../src/components/Dictation";
import { Multimodal } from "../src/components/Multimodal";
import { NotetakerSettingsSection, RecordCall } from "../src/components/Notetaker";
import { RetrievalNote } from "../src/components/RetrievalNote";
import { VoiceSettingsSection } from "../src/components/Voice";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { useAttachments } from "../src/core/attachments";
import type { MemoryAnswer } from "../src/core/types";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { PillApp } from "../src/pill/PillApp";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { STATUS as DICTATION_STATUS } from "./pill-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

const DICTATION_SETTINGS = {
  enabled: false,
  typing_wpm: 40,
  default_mode: "natural",
  app_modes: { "com.example.mail": "polished" },
  vocabulary: {
    dictionary: [{ term: "Kubernetes" }],
    replacements: [{ from: "teh", to: "the" }],
    snippets: [],
  },
};
const DICTATION_STATS = {
  words: 640,
  sessions: 8,
  speech_ms: 230_000,
  typing_ms: 960_000,
  saved_ms: 730_000,
  average_wpm: 167,
  streak_days: 1,
  top_apps: [{ app: "com.example.mail", words: 500, sessions: 5 }],
};
const NOTETAKER_STATUS = {
  enabled: true,
  kill_switch_engaged: false,
  recognizer: { available: true, detail: "Fake recogniser", engine: "fake" },
  audio_on_disk: false,
  summary: { available: true, locality: "local", detail: "Summaries come from this device." },
  capture: { microphone: true, system_audio: false, detail: "Microphone only." },
  consent_channel: { available: true, detail: "The desktop app asks you." },
  limits: { max_seconds: 14_400, max_frame_bytes: 1_048_576, window_seconds: 30 },
};
const VOICE_STATUS = {
  enabled: false,
  kill_switch_engaged: false,
  recognizer: { available: false, detail: "No recogniser installed" },
  audio_on_disk: false,
  active: null,
  limits: { max_frame_bytes: 65_536, awake_window_ms: 8000 },
};
const CAPTURE_STATUS = {
  kill_switch_engaged: false,
  speech: {
    available: true,
    detail: "Whisper loaded",
    provider: "whisper.cpp",
    model: "tiny",
    locality: "local",
  },
  vision: { available: false, detail: "No local vision model" },
  capture: { available: true, detail: "Enabled" },
};
const ATTACHMENTS = {
  attachments: [
    {
      id: "att_1",
      name: "notes.txt",
      kind: "folder",
      mime: "inode/directory",
      origin: "drop",
      bytes: 2048,
      preview: "hello preview",
      files: 3,
      created_at: "2026-10-15T11:00:00Z",
      expires_at: "2026-10-15T12:00:00Z",
    },
  ],
  total_bytes: 2048,
  limits: { max_count: 10, max_total_bytes: 1_000_000, ttl_ms: 3_600_000 },
};
const ANSWER: MemoryAnswer = {
  facts: [
    {
      id: "m1",
      text: "Commit abc123 changed the router",
      domain: "git",
      source: "git",
      source_ref: "abc123",
      observed_at: "2026-10-01T10:00:00Z",
      sensitivity: "internal",
      classification: "stored_fact",
      confidence: 0.8,
      freshness: "stale",
    },
  ],
  retrieved_evidence: [],
  stored_interpretations: [],
  interpretation_classification: "hypothesis",
  interpretation: "The router was refactored.",
  processed_by: "llama3.2",
  ai_used: true,
  note: null,
  model: "llama3.2",
  provider: "ollama",
  provider_label: "Ollama",
  locality: "local",
  retrieval: { mode: "hybrid", truncated: true },
};

function Tray() {
  const att = useAttachments();
  return <AttachmentsTray att={att} excluded={{}} onToggle={() => {}} />;
}

function screenIn(locale: ActiveLocale) {
  const api = fakeApi({
    "GET /api/dictation/status": () => DICTATION_STATUS,
    "GET /api/dictation/settings": () => DICTATION_SETTINGS,
    "GET /api/dictation/stats": () => DICTATION_STATS,
    "GET /api/notetaker/status": () => NOTETAKER_STATUS,
    "GET /api/voice/status": () => VOICE_STATUS,
    "GET /api/multimodal/status": () => CAPTURE_STATUS,
    "GET /api/attachments": () => ATTACHMENTS,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale={locale}>
        <DictationSettingsSection />
        <NotetakerSettingsSection />
        <RecordCall />
        <VoiceSettingsSection />
        <Multimodal />
        <Tray />
        <DropZone label="Fawkes">
          <p>data</p>
        </DropZone>
        <AnswerView answer={ANSWER} />
        <RetrievalNote info={{ mode: "lexical", vector_skipped_reason: "ai_disabled" }} />
        <Chat />
        <PillApp shell={null} copyText={null} openInBrowser={() => {}} />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
}

/** Words of the converted strings that must not be on screen in another language. */
const ENGLISH = [
  "Turn on dictation",
  "Turn on the notetaker",
  "Turn on “OK Fawkes”",
  "Before you record",
  "One-time device capture",
  "Capture microphone",
  "Stop dictating",
  "Clean-up",
  "Typing speed",
  "Statistics",
  "Words dictated",
  "Time saved",
  "Stored facts",
  "Generated hypothesis",
  "Retrieved evidence",
  "Found by keywords",
  "Smart search",
  "Local only",
  "Clear all",
  "Ask about attachments",
  "Message to Fawkes",
  "No messages yet",
  "Stale observation",
  "Stored fact",
  "attach files",
  "Dismiss",
  "Recording a call",
  "What leaves this device",
  "Speech recogniser",
  "Waiting for Phoenix Core",
  "Diagnose a CI failure",
  "Ready",
  "Open Phoenix",
];

const DATA = [
  "Commit abc123 changed the router",
  "The router was refactored.",
  "notes.txt",
  "com.example.mail",
  "Kubernetes",
];

describe("the capture screens in Arabic", () => {
  it("are right-to-left, Arabic, and show no message id", async () => {
    screenIn("ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    await screen.findAllByText("notes.txt");
    await screen.findByText("Kubernetes");
    await screen.findAllByText(/com\.example\.mail/);
    await waitFor(() => expect(screen.queryByText("Typing speed")).toBeNull());
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/\p{Script=Arabic}/u);
    expect(text).not.toMatch(/\bcapture\.[a-zA-Z]+\.[a-zA-Z.]+/);
    expect(text).not.toMatch(/\bcommon\.[a-zA-Z]+\.[a-zA-Z.]+/);
    for (const english of ENGLISH) expect(text, english).not.toContain(english);
    // Data from Core and product words stay as they are.
    for (const data of DATA) expect(text, data).toContain(data);
    expect(text).toContain("Fake recogniser");
    const buttons = screen.getAllByRole("button", { name: /\p{Script=Arabic}/u });
    expect(buttons.length).toBeGreaterThan(5);
    expect(screen.queryByRole("button", { name: "Dictate" })).toBeNull();
    expect(document.querySelector(".pill-status")?.textContent ?? "").toMatch(/\p{Script=Arabic}/u);
  });
});

describe("the capture screens in the pseudo-locale en-XA", () => {
  it("leave no English in the strings that were converted", async () => {
    screenIn("en-XA");
    await screen.findAllByText("notes.txt");
    await screen.findByText("Kubernetes");
    await screen.findAllByText(/com\.example\.mail/);
    await waitFor(() => expect(screen.queryByText("Typing speed")).toBeNull());
    const text = document.body.textContent ?? "";
    for (const english of ENGLISH) expect(text, english).not.toContain(english);
    expect(screen.queryByRole("button", { name: "Dictate" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^\[/ }).length).toBeGreaterThan(5);
    for (const data of DATA) expect(text, data).toContain(data);
    expect(document.querySelector(".pill-status")?.textContent ?? "").toMatch(/^\[/);
  });
});
