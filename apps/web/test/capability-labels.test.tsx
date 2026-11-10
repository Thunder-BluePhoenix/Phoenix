// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 70: built-in capabilities show translated names, descriptions and field labels; text from
// any other capability is shown exactly as its manifest sent it.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapabilityList } from "../src/components/CapabilityList";
import { SettingsPage } from "../src/components/Settings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { CapabilityView } from "../src/core/types";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

const STATE = {
  state: "idle",
  explanation: "",
  since: "2026-01-01T00:00:00Z",
  recording: false,
  sleeping: false,
};

const base = {
  version: "0.1.0",
  status: "installed",
  health: { status: "unknown" },
  permissions: [],
  commands: [],
  data_categories: [],
  context_sources: [],
  ai_tools: [],
  config: {},
} as const;

const git = {
  ...base,
  id: "git",
  name: "Git (manifest)",
  description: "Manifest text for git.",
  kind: "builtin",
  config_schema: {
    type: "object",
    properties: { repositories: { type: "array", items: { type: "string" } } },
  },
} as unknown as CapabilityView;

/** Same id and field names as a built-in, but external: nothing of it may be translated. */
const imposter = {
  ...base,
  id: "git",
  name: "Imposter Git",
  description: "Third-party description.",
  kind: "external",
  config_schema: {
    type: "object",
    properties: { repositories: { type: "array", items: { type: "string" } } },
  },
} as unknown as CapabilityView;

const foreign = {
  ...base,
  id: "acme-widgets",
  name: "Acme Widgets",
  description: "Shows Acme widgets.",
  kind: "external",
  config_schema: { type: "object", properties: { widget_count: { type: "integer" } } },
} as unknown as CapabilityView;

function mount(ui: React.ReactElement, caps: CapabilityView[], locale: ActiveLocale) {
  const api = fakeApi({
    "GET /api/capabilities": () => ({ capabilities: caps }),
    "GET /api/privacy": () => ({
      location: "/x",
      data: [],
      audit_log: { description: "", count: 0 },
      credentials: [],
      telemetry: "none",
      external_ai: "",
    }),
    "GET /api/pet/settings": () => ({ reduced_motion: "auto" }),
    "GET /api/notifications/preferences": () => ({
      enabled: true,
      min_severity: "warning",
      muted_sources: [],
    }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale={locale}>{ui}</I18nProvider>
    </CoreProvider>,
  );
}

describe("capability labels (Phase 70)", () => {
  it("shows the English table text for a built-in capability, not the manifest's", async () => {
    mount(<CapabilityList />, [git], "en");
    expect(
      await screen.findByText(
        "Watches your selected local repositories for commits, branches and conflicts.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Manifest text for git.")).toBeNull();
    expect(screen.queryByText("Git (manifest)")).toBeNull();
  });

  it("translates a built-in capability's description and field label in another language", async () => {
    const { capabilityLabels } = await import("../src/i18n/locales/fr/capability-labels");
    mount(<SettingsPage state={STATE} />, [git], "fr");
    expect(
      await screen.findByText(capabilityLabels["capabilityLabels.git.description"]),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(capabilityLabels["capabilityLabels.field.git.repositories"]),
    ).toBeTruthy();
  });

  it("shows an external capability's manifest text untouched, even under a built-in id", async () => {
    mount(<CapabilityList />, [foreign, imposter], "fr");
    expect(await screen.findByText("Acme Widgets")).toBeTruthy();
    expect(screen.getByText("Shows Acme widgets.")).toBeTruthy();
    expect(screen.getByText("Imposter Git")).toBeTruthy();
    expect(screen.getByText("Third-party description.")).toBeTruthy();
  });

  it("shows an external capability's raw field key in Settings, untranslated", async () => {
    mount(<SettingsPage state={STATE} />, [foreign, imposter], "fr");
    const acme = (await screen.findByText("Acme Widgets", { selector: "strong" })).closest(
      "details",
    )!;
    expect(within(acme as HTMLElement).getByLabelText("widget_count")).toBeTruthy();
    const fake = screen.getByText("Imposter Git", { selector: "strong" }).closest("details")!;
    expect(within(fake as HTMLElement).getByLabelText("repositories")).toBeTruthy();
  });
});
