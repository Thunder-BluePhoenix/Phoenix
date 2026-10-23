// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ApiError, PhoenixClient, type ClientOptions } from "./client";
import { translate } from "../i18n/store";
import { DEMO_UI_TEXT, parseDemoSession, type DemoSession } from "./demo";
import { existingRecorder } from "./notetaker-recorder";
import { existingAssistant } from "./voice-assistant";

export type DemoPhase = "off" | "starting" | "on" | "stopping";

export interface DemoSnapshot {
  phase: DemoPhase;
  /** The client the whole app talks to: the real one, or the demo Core's while the demo runs. */
  client: PhoenixClient;
  session: DemoSession | null;
  /** Index of the step last played (-1: none yet). */
  step: number;
  playing: boolean;
  error: string | null;
  /** Something the demo did to the real app's state when it started (not an error). */
  notice: string | null;
}

/** Builds the client for the demo Core (tests inject one over a fake fetch and socket). */
export type DemoClientFactory = (options: ClientOptions) => PhoenixClient;

export interface DemoRouter {
  get(): string;
  set(hash: string): void;
}

const windowRouter: DemoRouter = {
  get: () => window.location.hash,
  set: (hash) => {
    window.location.hash = hash;
  },
};

const failure = (fallback: string, err: unknown) =>
  err instanceof ApiError
    ? translate("services.demo.failureDetail", { message: fallback, detail: err.message })
    : fallback;

/** A call recording of the REAL Core that this page is making (or finishing). */
const recording = (real: PhoenixClient): boolean =>
  (existingRecorder(real)?.getState().phase ?? "idle") !== "idle";

/**
 * Switches the app between the real Core and the demo Core.
 *
 * Starting asks the REAL Core to start the demo; from then on every request goes to the demo Core
 * with the demo token, and the real client is closed (no request, socket or token of the real one
 * is used while the demo runs). Stopping switches back FIRST, so the page never talks to a Core that
 * is about to disappear, then asks the real Core to end the demo. The hash route the user was on is
 * put back. The controller writes nothing itself: no storage, no cookie, no file.
 *
 * The real client's microphone features never outlive the switch: a call recording in progress makes
 * the demo REFUSE to start (the call is never ended silently), and the voice assistant is stopped
 * (microphone released, session ended on the real Core) before the page points at the demo.
 */
export class DemoController {
  private snap: DemoSnapshot;
  private readonly listeners = new Set<() => void>();
  private savedRoute: string | null = null;

  constructor(
    private readonly real: PhoenixClient,
    private readonly makeClient: DemoClientFactory = (o) => new PhoenixClient(o),
    private readonly router: DemoRouter = windowRouter,
  ) {
    this.snap = {
      phase: "off",
      client: real,
      session: null,
      step: -1,
      playing: false,
      error: null,
      notice: null,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): DemoSnapshot => this.snap;

  async start(): Promise<void> {
    if (this.snap.phase !== "off") return;
    if (recording(this.real)) {
      this.set({ error: translate("services.demo.recordingActive"), notice: null });
      return;
    }
    this.set({ phase: "starting", error: null, notice: null });
    let session: DemoSession | null;
    try {
      session = parseDemoSession(await this.real.request("POST", "/api/demo/start", {}));
    } catch (err) {
      this.set({ phase: "off", error: failure(DEMO_UI_TEXT.startFailed, err) });
      return;
    }
    if (!session) {
      // Core started a demo we refuse to open (a bad address): end it so nothing is left running.
      await this.real.request("POST", "/api/demo/stop", {}).catch(() => undefined);
      this.set({ phase: "off", error: DEMO_UI_TEXT.invalidSession });
      return;
    }
    // The user may have started a recording while Core was starting the demo.
    if (recording(this.real)) {
      await this.real.request("POST", "/api/demo/stop", {}).catch(() => undefined);
      this.set({ phase: "off", error: translate("services.demo.recordingActive") });
      return;
    }
    const assistant = existingAssistant(this.real);
    const voiceWasOn = assistant !== undefined && assistant.getState().phase !== "idle";
    // Microphone released and the real session ended BEFORE the page stops talking to the real Core.
    await assistant?.stop();
    this.savedRoute = this.router.get();
    const demoClient = this.makeClient({ token: session.token, baseUrl: session.url });
    this.set({
      phase: "on",
      client: demoClient,
      session,
      step: -1,
      playing: false,
      notice: voiceWasOn ? translate("services.demo.voiceStopped") : null,
    });
    this.router.set("#/");
  }

  async stop(): Promise<void> {
    if (this.snap.phase !== "on") return;
    this.set({ phase: "stopping", error: null, notice: null });
    // The demo Core's own assistant and recorder (their client is about to close) release the mic.
    void existingAssistant(this.snap.client)?.stop();
    existingRecorder(this.snap.client)?.cancel();
    this.snap.client.close();
    this.set({ client: this.real, session: null, step: -1, playing: false });
    this.router.set(this.savedRoute ?? "");
    this.savedRoute = null;
    try {
      await this.real.request("POST", "/api/demo/stop", {});
      this.set({ phase: "off" });
    } catch (err) {
      this.set({ phase: "off", error: failure(DEMO_UI_TEXT.stopFailed, err) });
    }
  }

  /** Shows the step's route and plays its scenario on the demo Core. */
  async play(index: number): Promise<void> {
    const { phase, session, client, playing } = this.snap;
    const step = session?.steps[index];
    if (phase !== "on" || !step || playing) return;
    this.set({ step: index, playing: true, error: null });
    this.router.set(`#${step.route}`);
    try {
      await client.request("POST", "/api/capabilities/mock/commands/simulate", {
        input: { scenario: step.scenario },
      });
      this.set({ playing: false });
    } catch (err) {
      const offline = err instanceof TypeError;
      this.set({
        playing: false,
        error: offline ? DEMO_UI_TEXT.demoOffline : failure(DEMO_UI_TEXT.playFailed, err),
      });
    }
  }

  /** Back to before the first step (the caption and counter reset); the route and the demo Core are left as they are. */
  rewind(): void {
    if (this.snap.phase !== "on" || this.snap.step === -1) return;
    this.set({ step: -1, error: null });
  }

  private set(patch: Partial<DemoSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
