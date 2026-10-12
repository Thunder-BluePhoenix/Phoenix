// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { LocalWhisperSpeech } from "../src";

describe("local speech", () => {
  it("requires an installed model and actual WAV input, never returns invented transcripts", async () => {
    const adapter = new LocalWhisperSpeech("/not-an-installed-whisper-model.bin");
    expect(await adapter.availability()).toMatchObject({ available: false });
    await expect(adapter.transcribe(new Uint8Array(50))).rejects.toThrow(/WAV/);
    const wav = new Uint8Array(44);
    wav.set([82, 73, 70, 70], 0);
    wav.set([87, 65, 86, 69], 8);
    await expect(adapter.transcribe(wav)).rejects.toThrow(/not installed/);
  });
});
