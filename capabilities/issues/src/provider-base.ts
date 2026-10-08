// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  httpRequest,
  type HttpRequest,
  type HttpResult,
} from "./http";
import type { HttpLimits, SecretReader } from "./types";
import { toIso } from "./validate";

/** Pages fetched per poll; beyond this a poll is cut short and the next one carries on. */
export const DEFAULT_MAX_PAGES = 5;
export const PAGE_SIZE = 100;
/** Overlap subtracted from the tracker's clock when it seeds a cursor; duplicates are filtered. */
export const CLOCK_SKEW_MS = 60_000;

export interface ProviderOptions {
  secret: SecretReader;
  limits?: Partial<HttpLimits>;
  maxPages?: number;
}

/** Shared plumbing: capped requests, the tracker's own clock, and the last-poll note. */
export abstract class ProviderBase {
  protected readonly secret: SecretReader;
  protected readonly limits: HttpLimits;
  protected readonly maxPages: number;
  private date: string | undefined;
  private noteText: string | undefined;

  constructor(options: ProviderOptions) {
    this.secret = options.secret;
    this.limits = {
      timeoutMs: options.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBytes: options.limits?.maxBytes ?? MAX_RESPONSE_BYTES,
    };
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  }

  /** The tracker's clock from the last reply, minus a safety overlap. */
  serverTime(): string | undefined {
    if (this.date === undefined) return undefined;
    return new Date(Date.parse(this.date) - CLOCK_SKEW_MS).toISOString();
  }

  note(): string | undefined {
    return this.noteText;
  }

  protected setNote(text: string | undefined): void {
    this.noteText = text;
  }

  protected async send(
    url: string,
    request: HttpRequest,
    signal: AbortSignal,
  ): Promise<HttpResult> {
    const res = await httpRequest(url, request, this.limits, signal);
    const date = toIso(res.headers.get("date") ?? undefined);
    if (date !== undefined) this.date = date;
    return res;
  }
}
