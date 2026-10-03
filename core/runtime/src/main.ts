// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { gitCapability } from "@phoenix/capability-git";
import { kageCapability } from "@phoenix/capability-kage";
import { mockCapability } from "@phoenix/capability-mock";
import { terminalCapability } from "@phoenix/capability-terminal";
import { loadConfig } from "@phoenix/config";
import { createLogger } from "@phoenix/logging";
import { KeychainSecretStore, type SecretStore } from "@phoenix/persistence";
import { PhoenixRuntime } from "./runtime";

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
let secrets: SecretStore | undefined;
try {
  secrets = new KeychainSecretStore();
} catch (err) {
  logger.warn("OS secret storage unavailable; capability credentials cannot be stored", {
    error: (err as Error).message,
  });
}
const runtime = new PhoenixRuntime({
  config,
  logger,
  ...(secrets ? { secrets } : {}),
  // Installed, not enabled: each needs the user to enable it and grant its permissions.
  // The mock capability plays demo scenarios; it only exists in development.
  capabilities: [
    kageCapability,
    gitCapability,
    terminalCapability,
    ...(config.env === "dev" ? [mockCapability] : []),
  ],
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
