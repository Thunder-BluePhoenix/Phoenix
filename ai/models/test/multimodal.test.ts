// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { routeMultimodal } from "../src";

describe("multimodal locality routing", () => {
  it("refuses a preferred cloud provider even when local is offline", () => {
    const plan = routeMultimodal(
      "speech-transcription",
      [
        { id: "cloud", locality: "cloud", roles: ["speech-transcription"], available: true },
        { id: "local", locality: "local", roles: ["speech-transcription"], available: false },
      ],
      "cloud",
    );
    expect(plan.order).toEqual([]);
    expect(plan.refused).toEqual([
      { providerId: "cloud", reason: "captured inputs cannot be sent to cloud providers" },
      { providerId: "local", reason: "local model/service unavailable" },
    ]);
  });
});
