// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Physical status lights & Stream Deck (Phase 88): Fawkes' state in the physical world. Hue,
// Elgato Key Light, Luxafor and LIFX follow IDLE / WORKING / WAITING / ERROR / RECORDING; a Stream
// Deck shows the state and offers approve / deny / record / keep-awake keys.
// Every light needs its own consent (config `devices`); transports are injected by the host, so
// nothing here discovers or contacts a device on its own. Event text is never sent to a device.
import { defineCapability, type CapabilityContext, type CapabilityModule } from "@phoenix/sdk";
import {
  StatusLightsController,
  type QuietHours,
  type StatusFeed,
  type StatusSnapshot,
} from "./controller";
import { StreamDeck, type DeckActions, type DeckSurface } from "./deck";
import type { Device, DeviceKind } from "./devices";

export * from "./controller";
export * from "./deck";
export * from "./devices";
export * from "./lifx";
export * from "./serial";

export const DEFAULT_AWAKE_MINUTES = 30;
const DEVICE_ID_PATTERN = "^[a-zA-Z0-9_.:-]{1,160}$";
const TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d$";
const SAFE_ID = new RegExp(DEVICE_ID_PATTERN);

export interface StatusLightsOptions {
  /** Provisioned devices with their injected transports. The default is none: nothing is lit. */
  devices?: () => readonly Device[];
  /** Core's event bus, read each time the capability is enabled. Without it nothing can follow Fawkes. */
  feed?: () => StatusFeed | undefined;
  /** Focus mode state, read at every update (the host calls `refresh()` when it changes). */
  focusMode?: () => boolean;
  /** Subscribes to focus mode changes; the capability re-evaluates its lights on each one, while enabled. */
  focusChanges?: (listener: () => void) => () => void;
  /** Stream Deck surface and Core-side actions, read each time the capability is enabled. */
  deck?: () => { surface: DeckSurface; actions: DeckActions } | undefined;
  now?: () => number;
}

interface DeviceStatus {
  id: string;
  kind: DeviceKind;
  consented: boolean;
  live: boolean;
  failing: boolean;
}
export interface StatusLightsStatus extends StatusSnapshot {
  devices: DeviceStatus[];
  deck: boolean;
}

function idList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id))
    : [];
}

function quietFrom(raw: unknown): QuietHours | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (!("timezone" in raw) || !("start" in raw) || !("end" in raw)) return null;
  const { timezone, start, end } = raw;
  return typeof timezone === "string" && typeof start === "string" && typeof end === "string"
    ? { timezone, start, end }
    : null;
}

interface DeckConfig {
  enabled: boolean;
  approveCapabilities: string[];
  awakeMinutes: number;
}

function deckFrom(raw: unknown): DeckConfig {
  const config = {
    enabled: false,
    approveCapabilities: [] as string[],
    awakeMinutes: DEFAULT_AWAKE_MINUTES,
  };
  if (typeof raw !== "object" || raw === null) return config;
  if ("enabled" in raw) config.enabled = raw.enabled === true;
  if ("approve_capabilities" in raw) config.approveCapabilities = idList(raw.approve_capabilities);
  if ("awake_minutes" in raw && typeof raw.awake_minutes === "number")
    config.awakeMinutes = raw.awake_minutes;
  return config;
}

function deviceIdFrom(input: unknown): string {
  if (typeof input === "object" && input !== null && "device_id" in input) {
    if (typeof input.device_id === "string" && SAFE_ID.test(input.device_id))
      return input.device_id;
  }
  throw new Error("device_id is required");
}

export interface StatusLightsCapability extends CapabilityModule {
  /** The host calls this when focus mode, an approval or anything else the lights/deck depend on changed. */
  refresh(): void;
}

/** A fresh capability instance (its own controller and device state). */
export function createStatusLightsCapability(
  options: StatusLightsOptions = {},
): StatusLightsCapability {
  let controller: StatusLightsController | undefined;
  let deck: StreamDeck | undefined;
  let emitted: CapabilityContext["emit"] | undefined;
  let consented: ReadonlySet<string> = new Set();
  let provisioned: readonly Device[] = [];
  let unsubscribeFocus: (() => void) | undefined;
  /** Devices whose last write failed; one warning per failure streak, one recovery. */
  const failing = new Set<string>();

  function announce(type: string, deviceId: string, severity: "info" | "warning"): void {
    // Device id and kind only: no error text, which a device or network could influence.
    emitted?.(
      {
        event_type: type,
        severity,
        subject: "Status lights",
        payload: { device_id: deviceId },
      },
      { ephemeral: true },
    );
  }

  function stopAll(): void {
    unsubscribeFocus?.();
    unsubscribeFocus = undefined;
    deck?.stop();
    deck = undefined;
    controller?.stop();
    controller = undefined;
    failing.clear();
  }

  const module = defineCapability({
    manifest: {
      id: "status-lights",
      name: "Status lights & Stream Deck",
      version: "0.1.0",
      description:
        "Shows what Fawkes is doing on lights you choose (Philips Hue, Elgato Key Light, Luxafor, LIFX): blue while an agent works, amber when it needs you, red on a failure or while recording, off when idle. A Stream Deck can approve or deny pending actions you allow, ask for a recording consent dialog, and request keep-awake. Each light is off until you consent to it, stays dark during focus mode and quiet hours, and can be revoked at any time. Only fixed colours are sent, never text from events.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["status_lights.*"],
      permissions: ["network"],
      data_categories: ["Fawkes state colour", "light device ids"],
      healthcheck: { interval_ms: 60_000 },
      commands: [
        {
          name: "status",
          description:
            "Which lights are consented and live, the colour they show and whether focus mode or quiet hours keep them dark. Read-only.",
          side_effect: "read",
          timeout_ms: 5000,
          input_schema: { type: "object", additionalProperties: false, properties: {} },
        },
        {
          name: "revoke",
          description:
            "Stops writing to one light now. It only removes access, so it never asks. It lasts until the capability is disabled; to remove consent for good, take the light out of the devices setting.",
          side_effect: "none",
          timeout_ms: 5000,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["device_id"],
            properties: {
              device_id: { type: "string", pattern: DEVICE_ID_PATTERN, "x-phoenix-confirm": true },
            },
          },
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          devices: {
            type: "array",
            maxItems: 16,
            uniqueItems: true,
            items: { type: "string", pattern: DEVICE_ID_PATTERN },
            description:
              "Ids of the lights you consent to. A provisioned light that is not listed is never contacted.",
          },
          quiet_hours: {
            type: "object",
            additionalProperties: false,
            required: ["timezone", "start", "end"],
            properties: {
              timezone: { type: "string", minLength: 1, maxLength: 64 },
              start: { type: "string", pattern: TIME_PATTERN },
              end: { type: "string", pattern: TIME_PATTERN },
            },
            description: "Lights stay off between start and end (24 h, in this time zone).",
          },
          stream_deck: {
            type: "object",
            additionalProperties: false,
            properties: {
              enabled: { type: "boolean" },
              approve_capabilities: {
                type: "array",
                maxItems: 16,
                uniqueItems: true,
                items: { type: "string", pattern: "^[a-z][a-z0-9_-]{1,63}$" },
                description:
                  "Capabilities whose pending write/execute actions the approve key may approve. Empty: none.",
              },
              awake_minutes: { type: "integer", minimum: 1, maximum: 480 },
            },
          },
        },
      },
    },
    init(ctx) {
      stopAll();
      emitted = ctx.emit;
      consented = new Set(idList(ctx.config.devices));
      provisioned = options.devices?.() ?? [];
      const quiet = quietFrom(ctx.config.quiet_hours);
      const feed = options.feed?.();
      if (!feed) {
        ctx.logger.warn("status lights have no event feed; nothing will follow Fawkes");
        return;
      }
      const lights = new StatusLightsController({
        devices: provisioned,
        feed,
        policy: {
          permitted: (id) => consented.has(id),
          focusMode: () => options.focusMode?.() ?? false,
          quietHours: () => quiet,
        },
        ...(options.now ? { now: options.now } : {}),
        onError(id) {
          if (failing.has(id)) return;
          failing.add(id);
          announce("status_lights.device.failed", id, "warning");
        },
        onWritten(id) {
          if (failing.delete(id)) announce("status_lights.device.recovered", id, "info");
        },
        onUpdate: () => deck?.update(lights.snapshot().shown),
      });
      controller = lights;
      const surface = options.deck?.();
      const deckConfig = deckFrom(ctx.config.stream_deck);
      if (surface && deckConfig.enabled) {
        deck = new StreamDeck({
          surface: surface.surface,
          actions: surface.actions,
          approveCapabilities: deckConfig.approveCapabilities,
          selfId: "status-lights",
          awakeMinutes: deckConfig.awakeMinutes,
          onError: (key) => ctx.logger.warn("stream deck key failed", { key }),
        });
        deck.start();
      }
      lights.start();
      unsubscribeFocus = options.focusChanges?.(() => {
        lights.refreshPolicy();
        deck?.render();
      });
    },
    commands: {
      status(): StatusLightsStatus {
        const lights = controller;
        const snap = lights?.snapshot() ?? { state: "IDLE", shown: "IDLE", suppressed: null };
        return {
          ...snap,
          deck: deck !== undefined,
          devices: provisioned.map((d) => ({
            id: d.id,
            kind: d.kind,
            consented: consented.has(d.id),
            live: lights?.isLive(d.id) ?? false,
            failing: failing.has(d.id),
          })),
        };
      },
      revoke(input) {
        const id = deviceIdFrom(input);
        if (!controller || !provisioned.some((d) => d.id === id)) {
          throw new Error("Unknown light");
        }
        controller.revoke(id);
        return { device_id: id, live: false };
      },
    },
    health() {
      if (!controller) return { status: "degraded" as const, message: "No event feed" };
      return failing.size > 0
        ? { status: "degraded" as const, message: `${failing.size} light(s) not answering` }
        : { status: "healthy" as const, message: `${provisioned.length} light(s) provisioned` };
    },
    async shutdown() {
      const lights = controller;
      unsubscribeFocus?.();
      unsubscribeFocus = undefined;
      deck?.stop();
      deck = undefined;
      controller = undefined;
      emitted = undefined;
      // Leave no red light behind: consented lights go dark, then everything stops.
      await lights?.shutdown();
    },
  });

  return Object.assign(module, {
    /** The host calls this when focus mode, an approval or anything else the lights/deck depend on changed. */
    refresh(): void {
      controller?.refreshPolicy();
      deck?.render();
    },
  });
}
