// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { PhoenixConfig } from "@phoenix/config";
import { EventBus } from "@phoenix/event-bus";
import { createLogger, type Logger } from "@phoenix/logging";
import {
  DeadLetterStore,
  EventStore,
  openDatabase,
  schemaVersion,
  type Database,
} from "@phoenix/persistence";
import { createEvent, PROTOCOL_VERSION } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";

export const PHOENIX_VERSION = "0.1.0-dev";

export interface RuntimeOptions {
  config: PhoenixConfig;
  logger?: Logger;
  /** Override the database path (":memory:" in tests). */
  databasePath?: string;
  /** Interval for expiring transient states. */
  tickMs?: number;
}

/**
 * Phoenix Core process: owns persistence, the event bus and the state engine,
 * and exposes a minimal HTTP surface. The full API arrives in Phase 06.
 */
export class PhoenixRuntime {
  readonly config: PhoenixConfig;
  readonly logger: Logger;
  readonly db: Database;
  readonly events: EventStore;
  readonly bus: EventBus;
  readonly state: StateEngine;
  private server: Server | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: RuntimeOptions) {
    this.config = options.config;
    this.logger = options.logger ?? createLogger({ level: options.config.logLevel });
    this.db = openDatabase(options.databasePath ?? join(this.config.dataDir, "phoenix.sqlite"));
    this.events = new EventStore(this.db, this.config.eventHistoryLimit);
    this.bus = new EventBus({
      store: this.events,
      deadLetters: new DeadLetterStore(this.db),
      logger: this.logger,
      dedupWindow: this.config.dedupWindow,
    });
    this.state = new StateEngine();

    this.bus.subscribe("state-engine", "*", (event) => {
      this.state.handle(event);
    });
    this.state.onChange((snapshot) => {
      this.bus.publish(
        createEvent({
          event_type: "pet.state.changed",
          source: "core",
          severity: "info",
          payload: {
            state: snapshot.state,
            explanation: snapshot.explanation,
            recording: snapshot.recording,
            since: snapshot.since,
          },
        }),
        { ephemeral: true },
      );
    });
  }

  async start(): Promise<{ host: string; port: number }> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && url.pathname === "/api/health") return send(200, this.health());
      return send(404, { code: "RESOURCE_NOT_FOUND", message: "Not found" });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.config.port, this.config.host, () => resolve());
    });
    const address = this.server.address() as AddressInfo;

    this.ticker = setInterval(() => this.state.tick(), this.options.tickMs ?? 1_000);
    this.ticker.unref();

    this.bus.publish(
      createEvent({
        event_type: "system.online",
        source: "core",
        severity: "info",
        payload: { version: PHOENIX_VERSION },
      }),
    );
    this.logger.info("Phoenix Core started", {
      host: address.address,
      port: address.port,
      env: this.config.env,
      dataDir: this.config.dataDir,
    });
    return { host: address.address, port: address.port };
  }

  health() {
    return {
      status: "ok" as const,
      version: PHOENIX_VERSION,
      protocol: PROTOCOL_VERSION,
      env: this.config.env,
      uptime_ms: Date.now() - this.startedAt,
      schema_version: schemaVersion(this.db),
      pet: { state: this.state.snapshot().state, recording: this.state.snapshot().recording },
      bus: this.bus.metrics(),
    };
  }

  /** Graceful shutdown: stop accepting requests, flush the bus, close the database. Idempotent. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      if (this.ticker) clearInterval(this.ticker);
      if (this.server) {
        await new Promise<void>((resolve) => this.server!.close(() => resolve()));
        this.server.closeAllConnections?.();
      }
      await this.bus.drain();
      this.db.close();
      this.logger.info("Phoenix Core stopped");
    })();
    return this.stopping;
  }
}
