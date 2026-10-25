// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhoenixClient, readInjectedToken } from "../core/client";
import { CoreProvider } from "../core/context";
import { I18nProvider } from "../i18n";
import { BrowserApp } from "./BrowserApp";
import { tauriBrowserShell } from "./shell";
import "./browser.css";

// Like the pill, the shell opens this page on Core's own origin (`<Core>/browser.html`), so the
// page reads the token Core injected and talks to `location.origin`. Web pages never load here:
// they live in separate content webviews.
const client = new PhoenixClient({ token: readInjectedToken() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CoreProvider client={client}>
      <I18nProvider>
        <BrowserApp
          shell={tauriBrowserShell()}
          initialOpen={new URLSearchParams(window.location.search).get("open")}
        />
      </I18nProvider>
    </CoreProvider>
  </StrictMode>,
);
