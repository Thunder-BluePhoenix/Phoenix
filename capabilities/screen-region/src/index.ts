// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Screen-region capture (Phase 85): the person drags one region of the screen and gets a PNG back.
// macOS only, through the stock `screencapture` program. The command is `execute` with the
// `screen_capture` permission, which Core confirms every single time (a granted permission is never
// enough), and the program shows the system's own region selector, so nothing is captured unless the
// person drags a region. Esc cancels cleanly. See docs/focus-and-screenshot.md.
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { defineCapability } from "@phoenix/sdk";
import {
  captureRegion,
  CAPTURE_TIMEOUT_MS,
  RegionCaptureError,
  type RegionCaptureEnv,
} from "./capture";
import { realEnv } from "./real";

export * from "./capture";
export * from "./real";

/** How long the image stays in Core's operation record before it is blanked in place. */
export const IMAGE_RETENTION_MS = 60_000;

export interface ScreenRegionOptions {
  /** The host machine; tests inject a recording fake. Default: the real machine. */
  env?: RegionCaptureEnv;
  imageRetentionMs?: number;
}

/** What `capture_region` returns. The image is only present until it expires (see IMAGE_RETENTION_MS). */
export type RegionResult =
  | {
      status: "captured";
      mime: "image/png";
      width: number;
      height: number;
      bytes: number;
      /** The PNG, base64; null once expired. */
      image: string | null;
      expired: boolean;
    }
  | { status: "cancelled" }
  | { status: "unsupported"; platform: string };

const EMPTY = { type: "object", additionalProperties: false, properties: {} } as const;

const CODE: Record<RegionCaptureError["kind"], ErrorCode> = {
  busy: ErrorCode.CAPABILITY_UNAVAILABLE,
  timeout: ErrorCode.OPERATION_TIMEOUT,
  stopped: ErrorCode.OPERATION_TIMEOUT,
  failed: ErrorCode.CAPABILITY_UNAVAILABLE,
  invalid_image: ErrorCode.CAPABILITY_UNAVAILABLE,
  too_large: ErrorCode.INVALID_REQUEST,
  unsafe_directory: ErrorCode.SECURITY_POLICY_BLOCKED,
};

export function createScreenRegionCapability(options: ScreenRegionOptions = {}) {
  const env = options.env ?? realEnv();
  const retention = options.imageRetentionMs ?? IMAGE_RETENTION_MS;
  let capturing = false;
  const live = new Set<() => void>();

  return defineCapability({
    manifest: {
      id: "screen-region",
      name: "Screen region capture",
      version: "0.1.0",
      description:
        "Lets you drag one region of the screen and returns it as a PNG to the page that asked. macOS only (the system screencapture selector); other systems report unsupported. Core asks you to confirm every capture; pressing Esc cancels. The image is not saved: it is held in memory for one minute and the temporary file is deleted at once. Needs the macOS Screen Recording permission.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      permissions: ["screen_capture", "filesystem_write"],
      data_categories: ["a screen region you select (image, held in memory for one minute)"],
      events: [],
      commands: [
        {
          name: "capture_region",
          description:
            "Open the system region selector so you can drag one screen region, and return it as a PNG",
          side_effect: "execute",
          permissions: ["screen_capture", "filesystem_write"],
          timeout_ms: CAPTURE_TIMEOUT_MS + 10_000,
          input_schema: EMPTY,
        },
      ],
    },
    init() {
      capturing = false;
    },
    shutdown() {
      for (const blank of [...live]) blank();
    },
    commands: {
      async capture_region(_input, ctx): Promise<RegionResult> {
        if (env.platform !== "darwin") return { status: "unsupported", platform: env.platform };
        if (capturing) {
          throw new PhoenixError(
            ErrorCode.CAPABILITY_UNAVAILABLE,
            "A capture is already in progress",
          );
        }
        capturing = true;
        try {
          const shot = await captureRegion(env, ctx.signal);
          if (shot.status !== "captured") return shot;
          const result: RegionResult = {
            status: "captured",
            mime: "image/png",
            width: shot.width,
            height: shot.height,
            bytes: shot.png.length,
            image: Buffer.from(shot.png).toString("base64"),
            expired: false,
          };
          // The operation record keeps this object; blank it in place so the image does not linger.
          const blank = () => {
            clearTimeout(timer);
            live.delete(blank);
            result.image = null;
            result.expired = true;
          };
          const timer = setTimeout(blank, retention);
          timer.unref();
          live.add(blank);
          return result;
        } catch (err) {
          if (err instanceof RegionCaptureError)
            throw new PhoenixError(CODE[err.kind], err.message);
          throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "The capture failed");
        } finally {
          capturing = false;
        }
      },
    },
    health() {
      return env.platform === "darwin"
        ? { status: "healthy" as const }
        : { status: "degraded" as const, message: "Region capture is only supported on macOS" };
    },
  });
}
