// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { DemoHost } from "../src/components/Demo";
import { PhoenixClient, type ClientOptions } from "../src/core/client";
import { DEMO_UI_TEXT, parseDemoSession, type DemoSession } from "../src/core/demo";
import type { DictationMicrophone } from "../src/core/dictation-mic";
import { recorderFor } from "../src/core/notetaker-recorder";
import { assistantFor } from "../src/core/voice-assistant";
import { en } from "../src/i18n/en";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const REAL_URL = "http://127.0.0.1:4870";
const DEMO_URL = "http://127.0.0.1:51234";
/** Built at run time: no credential-shaped literal in the source. */
const DEMO_TOKEN = ["demo", "token", "x".repeat(24)].join("-");

const STEPS = [
  {
    scenario: "build-pass",
    caption_id: "demo.build-pass",
    caption: "Build passes.",
    route: "/panel/overview",
  },
  {
    scenario: "build-fail",
    caption_id: "demo.build-fail",
    caption: "Build fails.",
    route: "/panel/activity",
  },
];

const session = (over: Partial<DemoSession> = {}): DemoSession => ({
  url: DEMO_URL,
  token: DEMO_TOKEN,
  steps: STEPS,
  ...over,
});

interface Mounted {
  real: FakeApi;
  demo: FakeApi;
  realClient: PhoenixClient;
  /** What the app built the demo client from. */
  built: ClientOptions[];
  /** The demo clients the app built, in order. */
  clients: PhoenixClient[];
  realSocket: FakeWebSocket;
}

/** `prepare` runs on the real client before the app renders (it makes the per-client assistant/recorder with a fake mic first: the first caller's microphone wins). */
function mount(
  realRoutes: Parameters<typeof fakeApi>[0] = {},
  prepare: (client: PhoenixClient) => void = () => {},
  prepareDemo: (client: PhoenixClient) => void = () => {},
): Mounted {
  window.location.hash = "#/settings";
  const real = fakeApi({ "POST /api/demo/start": () => session(), ...realRoutes });
  const demo = fakeApi();
  const built: ClientOptions[] = [];
  const clients: PhoenixClient[] = [];
  const realClient = new PhoenixClient({
    token: "real-token",
    baseUrl: REAL_URL,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: real.fetchImpl,
  });
  prepare(realClient);
  render(
    <DemoHost
      client={realClient}
      makeClient={(o) => {
        built.push(o);
        const client = new PhoenixClient({
          ...o,
          WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
          fetchImpl: demo.fetchImpl,
        });
        clients.push(client);
        prepareDemo(client);
        return client;
      }}
    >
      <App />
    </DemoHost>,
  );
  const realSocket = FakeWebSocket.last;
  act(() => realSocket.open());
  return { real, demo, realClient, built, clients, realSocket };
}

const start = async () =>
  fireEvent.click(await screen.findByRole("button", { name: DEMO_UI_TEXT.start }));

describe("demo mode in the web app", () => {
  it("shows an unmistakable banner and talks only to the demo Core while it runs", async () => {
    const m = mount();
    expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull();
    await start();

    const banner = await screen.findByText(DEMO_UI_TEXT.banner);
    expect(banner.closest("[role=status]")).not.toBeNull();
    // The client was built from the demo's address and token, not the real ones.
    expect(m.built).toEqual([{ token: DEMO_TOKEN, baseUrl: DEMO_URL }]);
    // The real client was closed; the demo client opened its own socket at the demo address.
    expect(m.realSocket.closed).toBe(true);
    const demoSocket = FakeWebSocket.last;
    expect(demoSocket).not.toBe(m.realSocket);
    expect(demoSocket.url).toBe(`ws://127.0.0.1:51234/api/ws`);
    expect(demoSocket.protocols.join(",")).toContain(DEMO_TOKEN);
    expect(demoSocket.protocols.join(",")).not.toContain("real-token");

    // From the moment the demo is on, the real Core receives nothing more.
    const realCallsAtSwitch = m.real.calls.length;
    act(() => demoSocket.open());
    fireEvent.click(screen.getByRole("button", { name: DEMO_UI_TEXT.next }));
    await waitFor(() =>
      expect(m.demo.posts("/api/capabilities/mock/commands/simulate")).toHaveLength(1),
    );
    expect(m.demo.posts("/api/capabilities/mock/commands/simulate")[0]!.body).toEqual({
      input: { scenario: "build-pass" },
    });
    expect(m.real.calls.length).toBe(realCallsAtSwitch);
    expect(m.real.calls.some((c) => c.path.includes("simulate"))).toBe(false);
  });

  it("shows each step's caption and route, and advances in order", async () => {
    mount();
    await start();
    fireEvent.click(await screen.findByRole("button", { name: DEMO_UI_TEXT.next }));
    expect(await screen.findByText(STEPS[0]!.caption)).toBeTruthy();
    expect(window.location.hash).toBe("#/panel/overview");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: DEMO_UI_TEXT.next }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: DEMO_UI_TEXT.next }));
    expect(await screen.findByText(STEPS[1]!.caption)).toBeTruthy();
    expect(window.location.hash).toBe("#/panel/activity");
    // The last step: nothing further to play, and the way out is said.
    await waitFor(() => expect(screen.getByText(DEMO_UI_TEXT.finished)).toBeTruthy());
    expect(
      (screen.getByRole("button", { name: DEMO_UI_TEXT.next }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("on stop switches back to the real client, removes the banner and restores the route", async () => {
    const m = mount();
    await start();
    await screen.findByText(DEMO_UI_TEXT.banner);
    const demoSocket = FakeWebSocket.last;
    act(() => demoSocket.open());
    fireEvent.click(screen.getByRole("button", { name: DEMO_UI_TEXT.next }));
    await waitFor(() => expect(window.location.hash).toBe("#/panel/overview"));

    fireEvent.click(screen.getByRole("button", { name: DEMO_UI_TEXT.stop }));
    await waitFor(() => expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull());

    // The real Core was told to end the demo, with its own token, and the demo client is closed.
    expect(m.real.posts("/api/demo/stop")).toHaveLength(1);
    expect(demoSocket.closed).toBe(true);
    // The page is back on the real Core: a fresh socket with the real token, same route as before.
    const back = FakeWebSocket.last;
    expect(back).not.toBe(demoSocket);
    expect(back.url).toBe("ws://127.0.0.1:4870/api/ws");
    expect(back.protocols.join(",")).toContain("real-token");
    expect(window.location.hash).toBe("#/settings");
    // The settings page is the real Core's again: its data comes from the real fake, not the demo's.
    const demoCallsAtStop = m.demo.calls.length;
    act(() => back.open());
    expect(await screen.findByRole("button", { name: DEMO_UI_TEXT.start })).toBeTruthy();
    expect(m.demo.calls.length).toBe(demoCallsAtStop);
    expect(m.real.calls.some((c) => c.path === "/api/privacy")).toBe(true);
  });

  it("stays on the real Core and says so when the demo cannot start", async () => {
    const m = mount({
      "POST /api/demo/start": () =>
        new Response(
          JSON.stringify({ code: "SECURITY_POLICY_BLOCKED", message: "Emergency stop is engaged" }),
          { status: 403 },
        ),
    });
    await start();
    expect(await screen.findByText(/Emergency stop is engaged/)).toBeTruthy();
    expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull();
    expect(m.built).toEqual([]);
    expect(m.realSocket.closed).toBe(false);
  });

  it("refuses an address that is not the loopback demo Core and ends that demo", async () => {
    const m = mount({
      "POST /api/demo/start": () => session({ url: "https://evil.example" }),
    });
    await start();
    expect(await screen.findByText(DEMO_UI_TEXT.invalidSession)).toBeTruthy();
    expect(m.built).toEqual([]);
    expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull();
    expect(m.real.posts("/api/demo/stop")).toHaveLength(1);
    expect(m.realSocket.closed).toBe(false);
  });

  it("does not drop the user back into demo state after a failed stop", async () => {
    const m = mount({
      "POST /api/demo/stop": () => new Response("{}", { status: 500 }),
    });
    await start();
    await screen.findByText(DEMO_UI_TEXT.banner);
    fireEvent.click(screen.getByRole("button", { name: DEMO_UI_TEXT.stop }));
    await waitFor(() => expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull());
    // Back on the real Core even though Core's stop answer was an error; the error is shown.
    expect(m.real.posts("/api/demo/stop")).toHaveLength(1);
    expect(FakeWebSocket.last.url).toBe("ws://127.0.0.1:4870/api/ws");
    expect(await screen.findByText(new RegExp(DEMO_UI_TEXT.stopFailed.slice(0, 30)))).toBeTruthy();
  });
});

/** A microphone that counts how often it was started and released. */
function countingMic() {
  const mic = { started: 0, stopped: 0, instance: null as unknown as DictationMicrophone };
  mic.instance = {
    async start() {
      mic.started++;
    },
    stop() {
      mic.stopped++;
    },
  };
  return mic;
}

const sessionCalls = (m: Mounted, method: string, prefix: string) =>
  m.real.calls.filter((c) => c.method === method && c.path.startsWith(prefix));

describe("the real microphone features do not outlive the switch to the demo", () => {
  it("stops a listening voice assistant (mic released, real session ended) before the demo takes over, and says so", async () => {
    const voiceId = `voi_${"c".repeat(32)}`;
    const mic = countingMic();
    const voiceSocket = new FakeWebSocket("ws://real/voice", []);
    const m = mount(
      {
        "POST /api/voice/sessions": () => ({ id: voiceId }),
        "DELETE /api/voice/sessions/*": () => ({ stopped: true }),
      },
      (client) => {
        assistantFor(client, () => mic.instance);
        vi.spyOn(client, "openVoiceSocket").mockReturnValue(voiceSocket as unknown as WebSocket);
      },
    );
    const assistant = assistantFor(m.realClient);
    await assistant.start();
    voiceSocket.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
    await waitFor(() => expect(mic.started).toBe(1));
    expect(assistant.getState().phase).toBe("waiting");

    await start();
    await screen.findByText(DEMO_UI_TEXT.banner);

    expect(mic.stopped).toBe(1);
    expect(voiceSocket.closed).toBe(true);
    expect(assistant.getState().phase).toBe("idle");
    await waitFor(() =>
      expect(sessionCalls(m, "DELETE", `/api/voice/sessions/${voiceId}`)).toHaveLength(1),
    );
    expect(await screen.findByText(en["services.demo.voiceStopped"])).toBeTruthy();
  });

  it("cancels a voice session that Core was still opening when the demo started", async () => {
    const voiceId = `voi_${"d".repeat(32)}`;
    const answer = Promise.withResolvers<{ id: string }>();
    const mic = countingMic();
    let openSocket = vi.fn();
    const m = mount(
      {
        "POST /api/voice/sessions": () => answer.promise,
        "DELETE /api/voice/sessions/*": () => ({ stopped: true }),
      },
      (client) => {
        assistantFor(client, () => mic.instance);
        openSocket = vi.spyOn(client, "openVoiceSocket") as unknown as typeof openSocket;
      },
    );
    const assistant = assistantFor(m.realClient);
    const starting = assistant.start();
    expect(assistant.getState().phase).toBe("starting");

    await start();
    await screen.findByText(DEMO_UI_TEXT.banner);
    answer.resolve({ id: voiceId });
    await starting;

    // The late session is never given a socket or a microphone, and is ended on the real Core.
    expect(openSocket).not.toHaveBeenCalled();
    expect(mic.started).toBe(0);
    expect(assistant.getState().phase).toBe("idle");
    await waitFor(() =>
      expect(sessionCalls(m, "DELETE", `/api/voice/sessions/${voiceId}`)).toHaveLength(1),
    );
  });

  it("stops the demo's own voice assistant when the demo ends, so its microphone is not left on", async () => {
    const voiceId = `voi_${"9".repeat(32)}`;
    const mic = countingMic();
    const voiceSocket = new FakeWebSocket("ws://demo/voice", []);
    const m = mount({}, undefined, (client) => {
      assistantFor(client, () => mic.instance);
      vi.spyOn(client, "openVoiceSocket").mockReturnValue(voiceSocket as unknown as WebSocket);
    });
    m.demo.set("POST /api/voice/sessions", () => ({ id: voiceId }));
    m.demo.set("DELETE /api/voice/sessions/*", () => ({ stopped: true }));
    await start();
    await screen.findByText(DEMO_UI_TEXT.banner);
    const assistant = assistantFor(m.clients[0]!);
    await assistant.start();
    voiceSocket.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
    await waitFor(() => expect(mic.started).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: DEMO_UI_TEXT.stop }));
    await waitFor(() => expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull());

    expect(mic.stopped).toBe(1);
    expect(assistant.getState().phase).toBe("idle");
    expect(voiceSocket.closed).toBe(true);
  });

  it("refuses to start the demo while a call is being recorded, and leaves the recording running", async () => {
    const callId = `ntk_${"e".repeat(32)}`;
    const mic = countingMic();
    const callSocket = new FakeWebSocket("ws://real/call", []);
    const m = mount({ "POST /api/notetaker/sessions": () => ({ id: callId }) }, (client) => {
      recorderFor(client, () => mic.instance);
      vi.spyOn(client, "openNotetakerSocket").mockReturnValue(callSocket as unknown as WebSocket);
    });
    const recorder = recorderFor(m.realClient);
    await recorder.start("standup");
    callSocket.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
    await waitFor(() => expect(recorder.getState().phase).toBe("recording"));

    await start();

    expect(await screen.findByText(en["services.demo.recordingActive"])).toBeTruthy();
    expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull();
    // The real Core was not even asked for a demo; nothing of the call was ended or switched.
    expect(m.real.posts("/api/demo/start")).toHaveLength(0);
    expect(m.built).toEqual([]);
    expect(mic.stopped).toBe(0);
    expect(callSocket.closed).toBe(false);
    expect(recorder.getState().phase).toBe("recording");
    expect(sessionCalls(m, "DELETE", "/api/notetaker/sessions")).toHaveLength(0);
    expect(m.realSocket.closed).toBe(false);
  });

  it("ends the just-started demo when a recording began while Core was starting it", async () => {
    const callId = `ntk_${"f".repeat(32)}`;
    const demoAnswer = Promise.withResolvers<DemoSession>();
    const mic = countingMic();
    const m = mount(
      {
        "POST /api/demo/start": () => demoAnswer.promise,
        "POST /api/notetaker/sessions": () => ({ id: callId }),
      },
      (client) => {
        recorderFor(client, () => mic.instance);
        vi.spyOn(client, "openNotetakerSocket").mockReturnValue(
          new FakeWebSocket("ws://real/call", []) as unknown as WebSocket,
        );
      },
    );
    const recorder = recorderFor(m.realClient);
    await start();
    await waitFor(() => expect(m.real.posts("/api/demo/start")).toHaveLength(1));
    await recorder.start();
    demoAnswer.resolve(session());

    expect(await screen.findByText(en["services.demo.recordingActive"])).toBeTruthy();
    expect(screen.queryByText(DEMO_UI_TEXT.banner)).toBeNull();
    await waitFor(() => expect(m.real.posts("/api/demo/stop")).toHaveLength(1));
    expect(m.built).toEqual([]);
    expect(recorder.getState().phase).not.toBe("idle");
  });
});

describe("parseDemoSession", () => {
  const good = { url: DEMO_URL, token: DEMO_TOKEN, steps: STEPS };

  it("accepts Core's answer", () => {
    expect(parseDemoSession(good)).toEqual({ url: DEMO_URL, token: DEMO_TOKEN, steps: STEPS });
  });

  it.each([
    ["a remote host", { ...good, url: "http://example.com:4870" }],
    ["https", { ...good, url: "https://127.0.0.1:4870" }],
    ["no port", { ...good, url: "http://127.0.0.1" }],
    ["credentials in the url", { ...good, url: "http://u:p@127.0.0.1:4870" }],
    ["a path", { ...good, url: "http://127.0.0.1:4870/x" }],
    ["localhost (not the address Core binds)", { ...good, url: "http://localhost:4870" }],
    ["a short token", { ...good, token: "abc" }],
    ["a token with header-breaking characters", { ...good, token: `${DEMO_TOKEN}\r\nx: y` }],
    ["no steps", { ...good, steps: [] }],
    [
      "a step route that is not a path",
      { ...good, steps: [{ ...STEPS[0], route: "javascript:1" }] },
    ],
    ["a step without a caption id", { ...good, steps: [{ ...STEPS[0], caption_id: 1 }] }],
    ["null", null],
    ["a list", []],
  ])("rejects %s", (_name, raw) => {
    expect(parseDemoSession(raw)).toBeNull();
  });
});
