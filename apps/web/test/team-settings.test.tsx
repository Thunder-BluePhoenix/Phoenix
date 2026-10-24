// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TeamSettingsSection } from "../src/components/TeamSettings";
import type { TeamLink, TeamStatus } from "../src/core/team";
import { mountWith } from "./ai-fixtures";
import type { FakeApi } from "./fake-api";

afterEach(cleanup);

const ownKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const SELF = {
  id: "tm_0123456789ab",
  public_key: btoa(
    String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("spki", ownKey.publicKey))),
  ),
};
const OFF: TeamLink = {
  enabled: false,
  connected: false,
  url: null,
  route: null,
  self: null,
  last_error: null,
};
const ON: TeamLink = {
  enabled: true,
  connected: true,
  url: "https://relay.example.com",
  route: "a".repeat(32),
  self: SELF,
  last_error: null,
};
const STATUS: TeamStatus = {
  sharing: {
    enabled: false,
    consent: { deploying: false, agent_run: false, meeting: false },
    outgoing: { sharing: false, items: [] },
  },
  members: [{ id: "tm_aaaaaaaaaaaa", label: "Ada" }],
  presence: {
    members: [
      { id: "tm_aaaaaaaaaaaa", label: "Ada", items: [{ kind: "deploying", since: 5 }] },
      { id: "tm_bbbbbbbbbbbb", label: "Grace", items: [] },
    ],
    counts: { deploying: 1, agent_run: 0, meeting: 0 },
  },
};

interface World {
  link: TeamLink;
  status: TeamStatus;
}

/** A Core whose link and status follow what the section sends; every change is recorded by fakeApi. */
function open(world: World, extra: Parameters<typeof mountWith>[1] = {}) {
  return mountWith(<TeamSettingsSection />, {
    "GET /api/team/link": () => world.link,
    "GET /api/team/status": () => world.status,
    ...extra,
  });
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Team presence" })).closest("section")!);

const writes = (api: FakeApi) => api.calls.filter((c) => c.method !== "GET");

describe("team presence settings", () => {
  it("explains the off state and turns it on with exactly the relay address", async () => {
    const world: World = { link: OFF, status: STATUS };
    const { api } = open(world, {
      "POST /api/team/link": () => {
        world.link = ON;
        return ON;
      },
    });
    const s = await section();
    await s.findByText(/off by default/);
    expect(s.getByText(/never names a repository, branch or person/)).toBeTruthy();
    expect(s.queryByRole("checkbox")).toBeNull();
    expect(s.queryByRole("button", { name: "Leave the team" })).toBeNull();

    const turnOn = s.getByRole("button", { name: "Turn on" }) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    fireEvent.change(s.getByLabelText("Relay address"), {
      target: { value: "https://relay.example.com" },
    });
    fireEvent.click(turnOn);
    await s.findByLabelText("Your team id");
    expect(writes(api)).toEqual([
      { method: "POST", path: "/api/team/link", body: { url: "https://relay.example.com" } },
    ]);
  });

  it("sends the route too when one is typed", async () => {
    const world: World = { link: OFF, status: STATUS };
    const route = "b".repeat(32);
    const { api } = open(world, {
      "POST /api/team/link": () => {
        world.link = { ...ON, route };
        return world.link;
      },
    });
    const s = await section();
    fireEvent.change(await s.findByLabelText("Relay address"), {
      target: { value: "https://relay.example.com" },
    });
    fireEvent.change(s.getByLabelText("Route (optional)"), { target: { value: route } });
    fireEvent.click(s.getByRole("button", { name: "Turn on" }));
    await s.findByLabelText("Your team id");
    expect(writes(api)).toEqual([
      {
        method: "POST",
        path: "/api/team/link",
        body: { url: "https://relay.example.com", route },
      },
    ]);
  });

  it("shows the connection, own id and public key, and never a private key", async () => {
    const world: World = {
      link: {
        ...ON,
        connected: false,
        last_error: "relay refused",
        // Core never sends this; if one ever slipped in, the section must not render it.
        ...{ private_key: "SECRET-PRIVATE-KEY-VALUE" },
      },
      status: STATUS,
    };
    const { container } = open(world);
    const s = await section();
    const id = (await s.findByLabelText("Your team id")) as HTMLInputElement;
    const key = s.getByLabelText("Your public key") as HTMLInputElement;
    expect(id.value).toBe(SELF.id);
    expect(id.readOnly).toBe(true);
    expect(key.value).toBe(SELF.public_key);
    expect(key.readOnly).toBe(true);
    expect((s.getByLabelText("Relay route") as HTMLInputElement).value).toBe("a".repeat(32));
    expect(s.getByText("Connection: connecting")).toBeTruthy();
    expect(s.getByRole("alert").textContent).toBe("Last error: relay refused");

    const everyInput = [...container.querySelectorAll("input")];
    expect(everyInput.some((i) => i.value.includes("SECRET-PRIVATE-KEY-VALUE"))).toBe(false);
    expect(container.textContent).not.toContain("SECRET-PRIVATE-KEY-VALUE");
    const labels = [...container.querySelectorAll("label")].map((l) => l.textContent ?? "");
    expect(labels.some((l) => /private/i.test(l))).toBe(false);
  });

  it("saves the sharing choices exactly as the API expects", async () => {
    const world: World = { link: ON, status: STATUS };
    const { api } = open(world, {
      "PUT /api/team/sharing": (body) => {
        const sent = body as { enabled?: boolean; consent?: Partial<Record<string, boolean>> };
        const sharing = world.status.sharing;
        world.status = {
          ...world.status,
          sharing: {
            ...sharing,
            enabled: sent.enabled ?? sharing.enabled,
            consent: { ...sharing.consent, ...sent.consent },
            outgoing: {
              sharing: true,
              items: [{ kind: "deploying", since: 9 }],
            },
          },
        };
        return world.status;
      },
    });
    const s = await section();
    const master = (await s.findByRole("checkbox", {
      name: "Share my status with my team",
    })) as HTMLInputElement;
    const deploying = s.getByRole("checkbox", { name: "Deploying" }) as HTMLInputElement;
    const agent = s.getByRole("checkbox", {
      name: "Running an agent for a long time",
    }) as HTMLInputElement;
    const meeting = s.getByRole("checkbox", { name: "In a meeting" }) as HTMLInputElement;
    for (const box of [deploying, agent, meeting]) expect(box.disabled).toBe(true);
    expect(s.getByText("Teammates see nothing from you right now.")).toBeTruthy();

    fireEvent.click(master);
    await waitFor(() => expect(master.checked).toBe(true));
    await waitFor(() => expect(deploying.disabled).toBe(false));
    fireEvent.click(deploying);
    await waitFor(() => expect(deploying.checked).toBe(true));
    await s.findByText("Teammates see right now: deploying.");

    expect(writes(api)).toEqual([
      { method: "PUT", path: "/api/team/sharing", body: { enabled: true } },
      { method: "PUT", path: "/api/team/sharing", body: { consent: { deploying: true } } },
    ]);
  });

  it("removes a teammate and lists who is around, with what they share", async () => {
    const world: World = { link: ON, status: STATUS };
    const { api } = open(world, {
      "DELETE /api/team/members/*": () => {
        world.status = { ...world.status, members: [] };
        return world.status;
      },
    });
    const s = await section();
    await s.findByRole("heading", { name: "Who is around" });
    const around = within(s.getByRole("heading", { name: "Who is around" }).parentElement!);
    expect(around.getByText("Ada").nextElementSibling?.textContent).toBe("deploying");
    expect(around.getByText("Grace").nextElementSibling?.textContent).toBe("nothing shared");

    fireEvent.click(s.getByRole("button", { name: "Remove Ada" }));
    await s.findByText("You have not added any teammates yet.");
    expect(writes(api)).toEqual([
      { method: "DELETE", path: "/api/team/members/tm_aaaaaaaaaaaa", body: {} },
    ]);
  });

  it("pauses the link without asking", async () => {
    const world: World = { link: ON, status: STATUS };
    const { api } = open(world, {
      "POST /api/team/link/pause": () => {
        world.link = { ...ON, enabled: false, connected: false };
        return world.link;
      },
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Pause" }));
    await s.findByText("Connection: paused");
    expect(writes(api)).toEqual([{ method: "POST", path: "/api/team/link/pause", body: {} }]);
    expect(s.getByRole("button", { name: "Turn back on" })).toBeTruthy();
  });

  it("asks before leaving and deletes only after Confirm", async () => {
    const world: World = { link: ON, status: STATUS };
    const { api } = open(world, {
      "DELETE /api/team/link": () => {
        world.link = OFF;
        return OFF;
      },
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Leave the team" }));
    await s.findByText("Leave the team and forget everyone?");
    expect(writes(api)).toEqual([]);

    fireEvent.click(s.getByRole("button", { name: "Cancel" }));
    expect(s.queryByText("Leave the team and forget everyone?")).toBeNull();
    expect(writes(api)).toEqual([]);

    fireEvent.click(s.getByRole("button", { name: "Leave the team" }));
    fireEvent.click(await s.findByRole("button", { name: "Confirm" }));
    await s.findByRole("button", { name: "Turn on" });
    expect(writes(api)).toEqual([{ method: "DELETE", path: "/api/team/link", body: {} }]);
    expect(s.queryByLabelText("Your team id")).toBeNull();
  });

  it("shows a plain not-available message and no controls when Core has no team route", async () => {
    mountWith(<TeamSettingsSection />, {
      "GET /api/team/link": () =>
        new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Not found" }), {
          status: 404,
        }),
    });
    const s = await section();
    await s.findByText(/Team presence is not available/);
    expect(s.queryByRole("button")).toBeNull();
    expect(s.queryByRole("checkbox")).toBeNull();
    expect(s.queryByRole("textbox")).toBeNull();
    expect(s.queryByRole("alert")).toBeNull();
  });

  it("reports a refused change through its alert and keeps the form", async () => {
    const world: World = { link: OFF, status: STATUS };
    open(world, {
      "POST /api/team/link": () =>
        new Response(JSON.stringify({ code: "FORBIDDEN", message: "The emergency stop is on" }), {
          status: 403,
        }),
    });
    const s = await section();
    fireEvent.change(await s.findByLabelText("Relay address"), {
      target: { value: "https://relay.example.com" },
    });
    await act(async () => {
      fireEvent.click(s.getByRole("button", { name: "Turn on" }));
    });
    expect((await s.findByRole("alert")).textContent).toBe("The emergency stop is on");
    expect((s.getByLabelText("Relay address") as HTMLInputElement).value).toBe(
      "https://relay.example.com",
    );
  });
});
