// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PhoenixClient, readInjectedToken } from "./core/client";
import { DemoHost } from "./components/Demo";
import { I18nProvider } from "./i18n";
import "./styles.css";

const client = new PhoenixClient({ token: readInjectedToken() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoHost client={client}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </DemoHost>
  </StrictMode>,
);
