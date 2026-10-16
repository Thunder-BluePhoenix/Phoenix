// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhoenixClient, readInjectedToken } from "../core/client";
import { CoreProvider } from "../core/context";
import { PillApp } from "./PillApp";
import { tauriPillShell } from "./shell";
import "./pill.css";

// The shell opens this page on Core's own origin (`<Core>/pill.html`), because Core's dictation
// stream only accepts a page of its own origin. So, like any browser page, it reads the token Core
// injected and talks to `location.origin`; it never asks the shell where Core is.
const client = new PhoenixClient({ token: readInjectedToken() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CoreProvider client={client}>
      <PillApp shell={tauriPillShell()} />
    </CoreProvider>
  </StrictMode>,
);
