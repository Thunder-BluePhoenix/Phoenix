// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { assertLoopbackOllamaUrl, DEFAULT_OLLAMA_URL, type FetchLike } from "@phoenix/ai-models";
import { CaptureUnavailableError } from "./session";

export interface VisionResult {
  description: string;
  provider: "ollama";
  model: string;
  locality: "local";
}

/** Ollama multimodal chat takes base64 PNG/JPEG images in `messages[].images`. */
export class LocalOllamaVision {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  constructor(
    private readonly model: string,
    options: { baseUrl?: string; fetch?: FetchLike } = {},
  ) {
    if (!/^[a-zA-Z0-9_.\/-]+(?::[a-zA-Z0-9_.-]+)?$/.test(model) || /(^|[:-])cloud$/i.test(model)) {
      throw new CaptureUnavailableError("A local vision model must be selected");
    }
    this.baseUrl = assertLoopbackOllamaUrl(options.baseUrl ?? DEFAULT_OLLAMA_URL);
    this.fetchFn = options.fetch ?? fetch;
  }

  async availability(signal?: AbortSignal): Promise<{ available: boolean; detail: string }> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/tags`, { signal, redirect: "error" });
      if (!res.ok) return { available: false, detail: "Local Ollama model list unavailable" };
      const body: unknown = await res.json();
      const models =
        typeof body === "object" && body !== null && "models" in body && Array.isArray(body.models)
          ? body.models
          : [];
      const entry = models.find(
        (item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          "name" in item &&
          (item.name === this.model || item.name === `${this.model}:latest`),
      );
      if (
        !entry ||
        typeof entry !== "object" ||
        "remote_host" in entry ||
        "remote_model" in entry
      ) {
        return {
          available: false,
          detail: "Local vision model is not installed (or is cloud-backed)",
        };
      }
      // Ollama tags don't describe model modalities. /api/show provides their actual capabilities.
      const show = await this.fetchFn(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "error",
        body: JSON.stringify({ model: this.model }),
        signal,
      });
      if (!show.ok) return { available: false, detail: "Local vision model cannot be inspected" };
      const metadata: unknown = await show.json();
      const capabilities =
        typeof metadata === "object" && metadata !== null && "capabilities" in metadata
          ? metadata.capabilities
          : undefined;
      const remote =
        typeof metadata === "object" &&
        metadata !== null &&
        ("remote_host" in metadata || "remote_model" in metadata);
      return !remote && Array.isArray(capabilities) && capabilities.includes("vision")
        ? { available: true, detail: "Local vision model available" }
        : { available: false, detail: "Selected Ollama model does not support local vision" };
    } catch {
      return { available: false, detail: "Local Ollama vision service unavailable" };
    }
  }

  async describe(image: Uint8Array, question: string, signal?: AbortSignal): Promise<VisionResult> {
    try {
      if (
        image.byteLength < 8 ||
        image.byteLength > 8 * 1024 * 1024 ||
        !question.trim() ||
        question.length > 2000
      ) {
        throw new CaptureUnavailableError("Vision needs a bounded PNG/JPEG image and a question");
      }
      const png = image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47;
      const jpeg = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
      if (!png && !jpeg) throw new CaptureUnavailableError("Vision accepts PNG/JPEG captures only");
      const status = await this.availability(signal);
      if (!status.available) throw new CaptureUnavailableError(status.detail);
      if (signal?.aborted) throw new CaptureUnavailableError("Vision processing stopped");
      const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        redirect: "error",
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            {
              role: "user",
              content: question,
              images: [
                Buffer.from(image.buffer, image.byteOffset, image.byteLength).toString("base64"),
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new CaptureUnavailableError("Local vision model request failed");
      const body: unknown = await res.json();
      const message =
        typeof body === "object" && body !== null && "message" in body ? body.message : undefined;
      const content =
        typeof message === "object" && message !== null && "content" in message
          ? message.content
          : undefined;
      if (typeof content !== "string" || !content.trim())
        throw new CaptureUnavailableError("Local vision model returned no description");
      if (signal?.aborted) throw new CaptureUnavailableError("Vision processing stopped");
      return { description: content, provider: "ollama", model: this.model, locality: "local" };
    } finally {
      image.fill(0);
    }
  }
}
