// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { LocalOllamaVision, LocalWhisperSpeech } from "@phoenix/ai-multimodal";
import type { FetchLike } from "@phoenix/ai-models";
import type { PermissionGateway } from "@phoenix/permissions";
import type { MultimodalApi, MultimodalStatusView } from "@phoenix/api";

/** Model availability only. Browser/OS capture and authorization are not exposed by Core. */
export class MultimodalRuntime implements MultimodalApi {
  private readonly speech?: LocalWhisperSpeech;
  private readonly vision?: LocalOllamaVision;

  constructor(
    private readonly permissions: PermissionGateway,
    options: {
      whisperModelPath?: string;
      visionModel?: string;
      ollamaUrl?: string;
      fetch?: FetchLike;
    } = {},
  ) {
    if (options.whisperModelPath) this.speech = new LocalWhisperSpeech(options.whisperModelPath);
    if (options.visionModel)
      this.vision = new LocalOllamaVision(options.visionModel, {
        ...(options.ollamaUrl ? { baseUrl: options.ollamaUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
  }

  async status(): Promise<MultimodalStatusView> {
    const killSwitchEngaged = this.permissions.isKillSwitchEngaged();
    if (killSwitchEngaged) {
      return {
        kill_switch_engaged: true,
        speech: { available: false, detail: "Kill switch engaged" },
        vision: { available: false, detail: "Kill switch engaged" },
        capture: {
          available: false,
          detail: "Browser capture and per-use authorization are not connected to Core",
        },
      };
    }
    const [speech, vision] = await Promise.all([
      this.speech?.availability() ?? {
        available: false,
        detail: "Local Whisper model not configured",
      },
      this.vision?.availability() ?? {
        available: false,
        detail: "Local vision model not configured",
      },
    ]);
    // A kill switch engaged while probes were running must not return a positive status.
    if (this.permissions.isKillSwitchEngaged())
      return {
        kill_switch_engaged: true,
        speech: { available: false, detail: "Kill switch engaged" },
        vision: { available: false, detail: "Kill switch engaged" },
        capture: {
          available: false,
          detail: "Browser capture and per-use authorization are not connected to Core",
        },
      };
    return {
      kill_switch_engaged: false,
      speech,
      vision,
      capture: {
        available: false,
        detail: "Browser capture and per-use authorization are not connected to Core",
      },
    };
  }
}
