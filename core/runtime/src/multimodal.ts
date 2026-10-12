// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { LocalOllamaVision, LocalWhisperSpeech } from "@phoenix/ai-multimodal";
import type { FetchLike } from "@phoenix/ai-models";
import type { PermissionGateway } from "@phoenix/permissions";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { CapabilityManager } from "@phoenix/capability-manager";
import type { CaptureKind, MultimodalApi, MultimodalStatusView } from "@phoenix/api";

const capability = (kind: CaptureKind) =>
  kind === "microphone" ? "capture-microphone" : "capture-screen";
const permission = (kind: CaptureKind) => (kind === "microphone" ? "microphone" : "screen_capture");

/** Core-owned per-use authorization and local-only processing. */
export class MultimodalRuntime implements MultimodalApi {
  private readonly speech?: LocalWhisperSpeech;
  private readonly vision?: LocalOllamaVision;
  private readonly whisperModelPath?: string;
  private readonly visionModel?: string;

  constructor(
    private readonly permissions: PermissionGateway,
    private readonly capabilities: CapabilityManager,
    options: {
      whisperModelPath?: string;
      visionModel?: string;
      ollamaUrl?: string;
      fetch?: FetchLike;
    } = {},
  ) {
    this.whisperModelPath = options.whisperModelPath;
    this.visionModel = options.visionModel;
    if (options.whisperModelPath) this.speech = new LocalWhisperSpeech(options.whisperModelPath);
    if (options.visionModel)
      this.vision = new LocalOllamaVision(options.visionModel, {
        ...(options.ollamaUrl ? { baseUrl: options.ollamaUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
  }

  captureAllowed(kind: CaptureKind): boolean {
    if (
      this.permissions.isKillSwitchEngaged() ||
      !this.permissions.grants.has(capability(kind), permission(kind))
    )
      return false;
    try {
      const device = this.capabilities.get(capability(kind));
      return (
        device.kind === "builtin" &&
        device.status === "enabled" &&
        device.permissions.some(
          (declared) => declared.permission === permission(kind) && declared.granted,
        )
      );
    } catch {
      return false;
    }
  }

  async authorizeCapture(kind: CaptureKind, command: string, signal: AbortSignal): Promise<void> {
    if (!this.captureAllowed(kind) || signal.aborted)
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Device capture unavailable");
    const model = kind === "microphone" ? this.speech : this.vision;
    if (!model || !(await model.availability()).available)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Local capture model unavailable");
    if (!this.captureAllowed(kind) || signal.aborted)
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Device capture unavailable");
    const id = capability(kind);
    await this.permissions.authorize({
      capabilityId: id,
      command,
      permissions: [permission(kind)],
      sideEffect: "read",
      summary: `Allow user to capture one ${kind === "microphone" ? "microphone WAV recording" : "selected screen image"} for local ${kind === "microphone" ? "transcription" : "description"}?`,
      details: { agent_id: "user", kind },
    });
    if (!this.captureAllowed(kind) || signal.aborted)
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Device capture permission revoked");
  }

  async processCapture(kind: CaptureKind, bytes: Uint8Array, signal: AbortSignal) {
    try {
      if (!this.captureAllowed(kind) || signal.aborted)
        throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Device capture permission revoked");
      if (kind === "microphone" && this.speech) return await this.speech.transcribe(bytes, signal);
      if (kind === "screen" && this.vision)
        return await this.vision.describe(
          bytes,
          "Describe this user-selected screen capture.",
          signal,
        );
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Local capture model unavailable");
    } finally {
      bytes.fill(0);
    }
  }

  async status(): Promise<MultimodalStatusView> {
    const killSwitchEngaged = this.permissions.isKillSwitchEngaged();
    if (killSwitchEngaged) {
      return {
        kill_switch_engaged: true,
        speech: { available: false, detail: "Kill switch engaged" },
        vision: { available: false, detail: "Kill switch engaged" },
        capture: { available: false, detail: "Kill switch engaged" },
      };
    }
    const [speech, vision] = await Promise.all([
      this.speech?.availability().then((status) => ({
        ...status,
        provider: "whisper.cpp" as const,
        locality: "local" as const,
        model: this.whisperModelPath,
      })) ?? { available: false, detail: "Local Whisper model not configured" },
      this.vision?.availability().then((status) => ({
        ...status,
        provider: "ollama" as const,
        locality: "local" as const,
        model: this.visionModel,
      })) ?? { available: false, detail: "Local vision model not configured" },
    ]);
    if (this.permissions.isKillSwitchEngaged())
      return {
        kill_switch_engaged: true,
        speech: { available: false, detail: "Kill switch engaged" },
        vision: { available: false, detail: "Kill switch engaged" },
        capture: { available: false, detail: "Kill switch engaged" },
      };
    const available =
      (speech.available && this.captureAllowed("microphone")) ||
      (vision.available && this.captureAllowed("screen"));
    return {
      kill_switch_engaged: false,
      speech,
      vision,
      capture: {
        available,
        detail: available
          ? "First-party device capture available with per-use approval"
          : "Enable a device capability and install its local model before capture",
      },
    };
  }
}
