// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mockCapability } from "@phoenix/capability-mock";
import { loadConfig } from "@phoenix/config";
import { createLogger } from "@phoenix/logging";
import { PhoenixRuntime } from "./runtime";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const runtime = new PhoenixRuntime({
  config,
  logger,
  // The mock capability plays demo scenarios; it only exists in development.
  capabilities: config.env === "dev" ? [mockCapability] : [],
});

const shutdown = (signal: string) => {
  logger.info("shutting down", { signal });
  runtime.stop().then(
    () => process.exit(0),
    (err: unknown) => {
      logger.error("shutdown failed", { error: err });
      process.exit(1);
    },
  );
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

runtime.start().catch((err: unknown) => {
  logger.error("failed to start Phoenix Core", { error: err });
  process.exit(1);
});
