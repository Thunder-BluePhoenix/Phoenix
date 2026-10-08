// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhoenixClient, readInjectedToken } from "../core/client";
import { CoreProvider } from "../core/context";
import { FloatingApp } from "./FloatingApp";
import { tauriShell } from "./shell";
import "./floating.css";

async function boot() {
  const shell = tauriShell();
  // In the desktop app the page is served by the shell, so it asks the shell where
  // Core is. In a plain browser (served by Core itself) the token is injected.
  const found = shell ? await shell.connection() : null;
  const client = new PhoenixClient({
    token: found ? found.token : readInjectedToken(),
    ...(found && shell
      ? { baseUrl: found.base_url, refreshToken: async () => (await shell.connection()).token }
      : {}),
  });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <CoreProvider client={client}>
        <FloatingApp shell={shell} />
      </CoreProvider>
    </StrictMode>,
  );
}

void boot();
