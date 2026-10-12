// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export type CaptureKind = "microphone" | "screen";
export type CaptureStatus = "idle" | "capturing" | "stopped";

/** Authorization must consult the current capability grant AND obtain per-use confirmation. */
export interface CaptureAuthorization {
  authorize(
    capabilityId: string,
    agentId: string,
    kind: CaptureKind,
    signal: AbortSignal,
  ): Promise<boolean>;
}

/** Browser/native host owns OS access; no capture API means capture is unavailable. */
export interface CaptureDriver {
  start(kind: CaptureKind, signal: AbortSignal): Promise<CapturedInput>;
}

export interface CapturedInput {
  /** Only a scoped capture; never place bytes in global agent context or event payloads. */
  read(signal: AbortSignal): Promise<Uint8Array>;
  stop(): void;
}

export class CaptureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureUnavailableError";
  }
}

/** One active input per session; caller must create a separate session for each agent/capability. */
export class ScopedCaptureSession {
  private readonly controller = new AbortController();
  private input?: CapturedInput;
  private pending = false;
  private state: CaptureStatus = "idle";
  private expiry?: NodeJS.Timeout;
  private borrowed?: Uint8Array;
  private reading = false;
  readonly capabilityId: string;
  readonly agentId: string;
  readonly kind: CaptureKind;

  constructor(options: {
    capabilityId: string;
    agentId: string;
    kind: CaptureKind;
    authorization: CaptureAuthorization;
    driver?: CaptureDriver;
    /** Positive hard upper bound; no indefinite background capture. */
    maxDurationMs: number;
  }) {
    if (
      !options.capabilityId ||
      !options.agentId ||
      !Number.isSafeInteger(options.maxDurationMs) ||
      options.maxDurationMs < 1 ||
      options.maxDurationMs > 300_000
    ) {
      throw new TypeError(
        "Capture requires capability, agent and a bounded lifetime (1..300000 ms)",
      );
    }
    this.capabilityId = options.capabilityId;
    this.agentId = options.agentId;
    this.kind = options.kind;
    this.authorization = options.authorization;
    this.driver = options.driver;
    this.maxDurationMs = options.maxDurationMs;
  }
  private readonly authorization: CaptureAuthorization;
  private readonly driver?: CaptureDriver;
  private readonly maxDurationMs: number;

  get status(): CaptureStatus {
    return this.state;
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  async start(): Promise<void> {
    if (this.state !== "idle" || this.pending)
      throw new CaptureUnavailableError("Capture session cannot be started again");
    this.pending = true;
    try {
      if (
        !(await this.authorization.authorize(
          this.capabilityId,
          this.agentId,
          this.kind,
          this.controller.signal,
        ))
      ) {
        throw new CaptureUnavailableError(`${this.kind} capture denied`);
      }
      if (this.controller.signal.aborted) throw new CaptureUnavailableError("Capture stopped");
      if (!this.driver)
        throw new CaptureUnavailableError(`${this.kind} device capture unavailable`);
      const input = await this.driver.start(this.kind, this.controller.signal);
      if (this.controller.signal.aborted) {
        input.stop();
        throw new CaptureUnavailableError("Capture stopped");
      }
      this.input = input;
      this.state = "capturing";
      this.expiry = setTimeout(() => this.stop(), this.maxDurationMs);
    } finally {
      this.pending = false;
    }
  }

  async readFor(agentId: string): Promise<Uint8Array> {
    if (agentId !== this.agentId)
      throw new CaptureUnavailableError("Input belongs to another agent");
    if (this.state !== "capturing" || !this.input)
      throw new CaptureUnavailableError("Capture is not active");
    if (this.reading) throw new CaptureUnavailableError("Capture read already in progress");
    this.reading = true;
    const input = this.input;
    let bytes: Uint8Array;
    try {
      bytes = await input.read(this.controller.signal);
    } catch (error) {
      this.stop();
      throw error;
    } finally {
      this.reading = false;
    }
    if (this.state !== "capturing" || this.controller.signal.aborted) {
      bytes.fill(0);
      throw new CaptureUnavailableError("Capture stopped; input discarded");
    }
    this.borrowed?.fill(0);
    this.borrowed = bytes;
    this.input.stop();
    this.input = undefined;
    return bytes;
  }

  /** Aborts pending authorization/capture/processing, stops hardware and discards owned input. */
  stop(): void {
    if (this.state === "stopped") return;
    this.state = "stopped";
    this.controller.abort();
    clearTimeout(this.expiry);
    this.borrowed?.fill(0);
    this.borrowed = undefined;
    this.input?.stop();
    this.input = undefined;
  }
}
