// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatApprovalsSection } from "../src/components/ChatApprovalsSettings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { buildConfig, digestMinutes, readForm, splitIds } from "../src/core/chat-approvals";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import type { CapabilityView } from "../src/core/types";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
});

// Built from parts so no credential-shaped literal sits in the source tree.
const TYPED = ["typed", "chat", "value", "must", "vanish", "424242"].join("_");
const SECRET_NAMES = [
  "slack_bot_token",
  "slack_signing_secret",
  "discord_bot_token",
  "discord_public_key",
  "teams_webhook_url",
  "teams_link_key",
];

function view(
  status: CapabilityView["status"],
  config: Record<string, unknown>,
  stored: string[] = [],
): CapabilityView {
  return {
    ...capability("chat-approvals", status, config),
    secrets: SECRET_NAMES.map((name) => ({ name, set: stored.includes(name) })),
  };
}

function mount(routes: Parameters<typeof fakeApi>[0], current: () => CapabilityView): FakeApi {
  const api = fakeApi({
    "GET /api/capabilities": () => ({ capabilities: [current()] }),
    ...routes,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale="en">
        <ChatApprovalsSection />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Chat approvals" })).closest("section")!);
const writes = (api: FakeApi) => api.calls.filter((c) => c.method !== "GET");
const configPosts = (api: FakeApi) =>
  api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/config"));

describe("chat approvals form logic", () => {
  it("reads missing config as everything off", () => {
    const f = readForm(undefined);
    expect(f.slack.enabled || f.discord.enabled || f.teams.enabled).toBe(false);
    expect(f.digestEnabled).toBe(false);
    expect(f.projects).toBe("");
  });

  it("accepts a digest interval only from 60 to 10080 whole minutes", () => {
    expect(digestMinutes("59")).toBeNull();
    expect(digestMinutes("60")).toBe(60);
    expect(digestMinutes("10080")).toBe(10080);
    expect(digestMinutes("10081")).toBeNull();
    expect(digestMinutes("1.5")).toBeNull();
    expect(digestMinutes("")).toBeNull();
  });

  it("splits approver ids and refuses badly shaped ones", () => {
    expect(splitIds("U1, U2\nU1")).toEqual(["U1", "U2"]);
    const form = readForm({});
    expect(buildConfig({ ...form, slack: { ...form.slack, approvers: "U1 bad!id" } }, {})).toEqual({
      error: "chatApprovals.error.approvers",
    });
    expect(buildConfig({ ...form, slack: { ...form.slack, channel: "no spaces" } }, {})).toEqual({
      error: "chatApprovals.error.ids",
    });
  });

  it("keeps config keys the form does not edit", () => {
    const form = readForm({});
    const built = buildConfig(form, {
      phoenix_confirmations: true,
      token_ttl_seconds: 120,
      digest_schedule: {
        enabled: true,
        interval_minutes: 90,
        quiet_hours: { timezone: "UTC", start: "22:00", end: "07:00" },
      },
    });
    expect(built).toMatchObject({
      config: {
        phoenix_confirmations: true,
        token_ttl_seconds: 120,
        digest_schedule: {
          enabled: false,
          interval_minutes: 1440,
          quiet_hours: { timezone: "UTC", start: "22:00", end: "07:00" },
        },
      },
    });
  });
});

describe("ChatApprovalsSection", () => {
  it("says so when the capability is absent", async () => {
    const api = fakeApi({ "GET /api/capabilities": () => ({ capabilities: [] }) });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    render(
      <CoreProvider client={client}>
        <I18nProvider forceLocale="en">
          <ChatApprovalsSection />
        </I18nProvider>
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    expect(await screen.findByText(/not available in this Phoenix Core/)).toBeTruthy();
  });

  it("starts with everything off and the digest off", async () => {
    mount({}, () => view("disabled", {}));
    const s = await section();
    for (const name of ["Slack", "Discord", "Microsoft Teams"]) {
      expect((await s.findByLabelText(`Enable ${name}`)) as HTMLInputElement).toHaveProperty(
        "checked",
        false,
      );
    }
    expect((s.getByLabelText("Send a scheduled digest") as HTMLInputElement).checked).toBe(false);
    expect((s.getByLabelText("Minutes between digests") as HTMLInputElement).value).toBe("1440");
    expect(s.getByText(/Never used with a real Slack, Discord or Teams/)).toBeTruthy();
  });

  it("saves the config through the configure route, keeping other keys", async () => {
    let current = view("enabled", { phoenix_confirmations: true });
    const api = mount(
      {
        "POST /api/capabilities/chat-approvals/config": (body) => {
          const config =
            typeof body === "object" && body !== null && "config" in body ? body.config : {};
          current = view("enabled", config as Record<string, unknown>);
          return current;
        },
      },
      () => current,
    );
    const s = await section();
    fireEvent.click(await s.findByLabelText("Enable Slack"));
    fireEvent.change(s.getByLabelText("Slack workspace (team) id"), { target: { value: "T0123" } });
    fireEvent.change(s.getByLabelText("Slack channel id"), { target: { value: "C0456" } });
    fireEvent.change(s.getByLabelText("Slack user ids that may decide (one per line)"), {
      target: { value: "U1\nU2" },
    });
    fireEvent.change(s.getByLabelText("Project names (one per line)"), {
      target: { value: "alpha\nbeta" },
    });
    fireEvent.click(s.getByLabelText("Send a scheduled digest"));
    fireEvent.change(s.getByLabelText("Minutes between digests"), { target: { value: "120" } });
    fireEvent.click(s.getByRole("button", { name: "Save chat approvals" }));
    await s.findByText("Saved.");
    const posts = configPosts(api);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      config: {
        phoenix_confirmations: true,
        projects: ["alpha", "beta"],
        slack: {
          enabled: true,
          workspace: "T0123",
          channel: "C0456",
          approvers: ["U1", "U2"],
          notify: false,
          digest: false,
        },
        discord: {
          enabled: false,
          workspace: "",
          channel: "",
          approvers: [],
          notify: false,
          digest: false,
        },
        teams: { enabled: false, notify: false, digest: false },
        digest_schedule: { enabled: true, interval_minutes: 120 },
      },
    });
  });

  it("refuses a digest interval under one hour and sends nothing", async () => {
    const api = mount({}, () => view("enabled", {}));
    const s = await section();
    fireEvent.change(await s.findByLabelText("Minutes between digests"), {
      target: { value: "30" },
    });
    fireEvent.click(s.getByRole("button", { name: "Save chat approvals" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "The digest interval must be a whole number from 60 to 10080 minutes.",
    );
    expect(configPosts(api)).toHaveLength(0);
  });

  it("refuses a badly shaped approver id and sends nothing", async () => {
    const api = mount({}, () => view("enabled", {}));
    const s = await section();
    fireEvent.change(await s.findByLabelText("Discord user ids that may decide (one per line)"), {
      target: { value: "ok1\n<@everyone>" },
    });
    fireEvent.click(s.getByRole("button", { name: "Save chat approvals" }));
    expect((await s.findByRole("alert")).textContent).toMatch(/Approver ids use letters/);
    expect(writes(api)).toHaveLength(0);
  });

  it("clears a typed secret on send and never puts it in the DOM, even after failure", async () => {
    let fail = false;
    let stored: string[] = [];
    const api = mount(
      {
        "POST /api/capabilities/chat-approvals/secrets/slack_bot_token": () => {
          if (fail)
            return new Response(JSON.stringify({ code: "INTERNAL", message: `echo ${TYPED}` }), {
              status: 500,
            });
          stored = ["slack_bot_token"];
          return view("enabled", {}, stored);
        },
      },
      () => view("enabled", {}, stored),
    );
    const s = await section();
    const input = (await s.findByLabelText("Slack bot token")) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(document.querySelector('[data-secret="slack_bot_token"]')!.textContent).toBe(
      "Not stored",
    );
    fireEvent.change(input, { target: { value: TYPED } });
    expect(input.value).toBe(TYPED);
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(document.querySelector('[data-secret="slack_bot_token"]')!.textContent).toBe("Stored"),
    );
    const sent = api.posts("/api/capabilities/chat-approvals/secrets/slack_bot_token");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ value: TYPED });
    expect(input.value).toBe("");
    expect(document.body.innerHTML).not.toContain(TYPED);

    // A refused send also drops the value, and Core's words (which echo it) never show.
    fail = true;
    const second = (await s.findByLabelText("Slack signing secret")) as HTMLInputElement;
    const bot = (await s.findByLabelText("Slack bot token")) as HTMLInputElement;
    fireEvent.change(bot, { target: { value: TYPED } });
    fireEvent.click(within(bot.closest("form")!).getByRole("button", { name: "Save" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "The credential was not saved or removed.",
    );
    expect(bot.value).toBe("");
    expect(second.value).toBe("");
    expect(document.body.innerHTML).not.toContain(TYPED);
    expect(document.body.textContent).not.toContain(TYPED);
  });

  it("does not send a secret of the wrong shape and drops it", async () => {
    const api = mount({}, () => view("enabled", {}));
    const s = await section();
    const key = (await s.findByLabelText("Discord application public key")) as HTMLInputElement;
    fireEvent.change(key, { target: { value: "not hex" } });
    fireEvent.click(within(key.closest("form")!).getByRole("button", { name: "Save" }));
    expect((await s.findByRole("alert")).textContent).toMatch(/does not look right/);
    expect(key.value).toBe("");
    expect(writes(api)).toHaveLength(0);
    const hook = (await s.findByLabelText("Teams webhook address")) as HTMLInputElement;
    fireEvent.change(hook, { target: { value: "http://example.test/hook" } });
    fireEvent.click(within(hook.closest("form")!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(hook.value).toBe(""));
    expect(writes(api)).toHaveLength(0);
  });

  it("shows the stored mark from Core's secret list and removes a stored secret", async () => {
    let stored = ["teams_link_key"];
    const api = mount(
      {
        "DELETE /api/capabilities/chat-approvals/secrets/teams_link_key": () => {
          stored = [];
          return view("enabled", {}, stored);
        },
      },
      () => view("enabled", {}, stored),
    );
    const s = await section();
    await waitFor(() =>
      expect(document.querySelector('[data-secret="teams_link_key"]')!.textContent).toBe("Stored"),
    );
    expect(document.querySelector('[data-secret="slack_bot_token"]')!.textContent).toBe(
      "Not stored",
    );
    fireEvent.click(s.getByRole("button", { name: "Remove stored Teams link key" }));
    await waitFor(() =>
      expect(document.querySelector('[data-secret="teams_link_key"]')!.textContent).toBe(
        "Not stored",
      ),
    );
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("shows a fixed text when Core has no credential store", async () => {
    mount(
      {
        "POST /api/capabilities/chat-approvals/secrets/slack_signing_secret": () =>
          new Response(
            JSON.stringify({ code: "CAPABILITY_UNAVAILABLE", message: `no store ${TYPED}` }),
            { status: 503 },
          ),
      },
      () => view("enabled", {}),
    );
    const s = await section();
    const input = (await s.findByLabelText("Slack signing secret")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: TYPED } });
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "Save" }));
    expect((await s.findByRole("alert")).textContent).toBe(
      "This Phoenix Core has no OS credential store, so a credential cannot be kept.",
    );
    expect(document.body.innerHTML).not.toContain(TYPED);
  });

  it("offers to turn on a disabled capability", async () => {
    const api = mount({}, () => view("disabled", {}));
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Turn on the capability" }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/chat-approvals/enable")).toHaveLength(1),
    );
  });
});
