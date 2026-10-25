// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhoenixClient, readInjectedToken } from "../core/client";
import { CoreProvider } from "../core/context";
import { I18nProvider } from "../i18n";
import { VoiceWindowApp } from "./VoiceWindowApp";
import "../styles.css";

// The desktop shell opens this page on Core's own origin (`<Core>/voice.html`): Core's voice stream
// only accepts a page of its own origin. Like any browser page it reads the token Core injected.
// The shell grants this window no command; see `voice/shell.ts`.
const client = new PhoenixClient({ token: readInjectedToken() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CoreProvider client={client}>
      <I18nProvider>
        <VoiceWindowApp />
      </I18nProvider>
    </CoreProvider>
  </StrictMode>,
);
