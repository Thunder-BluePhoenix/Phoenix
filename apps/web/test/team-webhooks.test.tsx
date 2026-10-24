// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
  type BoundFunctions,
  type queries,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamWebhooksSection } from "../src/components/TeamWebhooks";
import type { WebhookSource, WebhookStatus } from "../src/core/team-webhooks";
import { cleanLabel, eventTypesProblem, sourceIdProblem } from "../src/core/team-webhooks";
import { mountWith } from "./ai-fixtures";
import type { FakeApi } from "./fake-api";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

const SECRET = "s3cr3t-value-0123456789abcdefghijklmnopqrstuvwxyz";

const source = (patch: Partial<WebhookSource> = {}): WebhookSource => ({
  id: "ci-main",
  path: "/api/webhooks/in/ci-main",
  eventTypes: ["ci.finished", "deploy.done"],
  enabled: true,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastAcceptedAt: null,
  ...patch,
});

interface CreateBody {
  id: string;
  eventTypes: string[];
}

/** Core's handlers receive the parsed JSON body as `unknown`; these tests send exactly this shape. */
const asCreate = (body: unknown) => body as CreateBody;

/** The master-switch request body, as the section sends it. */
const asMaster = (body: unknown) => body as { enabled: boolean };

interface World {
  status: WebhookStatus;
}

function open(world: World, extra: Parameters<typeof mountWith>[1] = {}) {
  return mountWith(<TeamWebhooksSection />, {
    "GET /api/team/webhooks": () => world.status,
    ...extra,
  });
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Incoming webhooks" })).closest("section")!);

const writes = (api: FakeApi) => api.calls.filter((c) => c.method !== "GET");

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

function fillCreate(s: BoundFunctions<typeof queries>, id: string, types: string) {
  fireEvent.change(s.getByLabelText("Source name"), { target: { value: id } });
  fireEvent.change(s.getByLabelText("Event types it may send"), { target: { value: types } });
}

describe("incoming webhook sources settings", () => {
  it("lists the sources with address, types, state and last delivery", async () => {
    const world: World = {
      status: {
        enabled: true,
        sources: [
          source(),
          source({
            id: "alerts-prod",
            path: "/api/webhooks/in/alerts-prod",
            eventTypes: ["alert.fired"],
            enabled: false,
            lastAcceptedAt: "2026-10-02T08:00:00.000Z",
          }),
        ],
      },
    };
    const { api } = open(world);
    const s = await section();
    await s.findByText("ci-main");
    expect(s.getByText("alerts-prod")).toBeTruthy();
    expect(s.getByText("Address: /api/webhooks/in/ci-main")).toBeTruthy();
    expect(s.getByText("Event types: ci.finished, deploy.done")).toBeTruthy();
    expect(s.getByText("Nothing received yet.")).toBeTruthy();
    expect(s.getByText("Last accepted: 2026-10-02T08:00:00.000Z")).toBeTruthy();
    expect((s.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(writes(api)).toEqual([]);
  });

  it("says so when there are no sources and when Core has no webhook route", async () => {
    open({ status: { enabled: false, sources: [] } });
    const s = await section();
    await s.findByText("You have not created any webhook sources yet.");
    expect(s.getByText(/off by default/)).toBeTruthy();
    cleanup();

    mountWith(<TeamWebhooksSection />);
    const absent = await section();
    await absent.findByText(/no operating system secret store/);
    expect(absent.queryByRole("button", { name: "Create source" })).toBeNull();
  });

  it("creates a source with exactly the typed name and types, shows the secret once, then clears it", async () => {
    const world: World = { status: { enabled: true, sources: [] } };
    const { api, container } = open(world, {
      "POST /api/team/webhooks/sources": (body) => {
        const input = asCreate(body);
        const made = source({ id: input.id, eventTypes: input.eventTypes });
        world.status = { ...world.status, sources: [made] };
        return { source: made, secret: SECRET };
      },
    });
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const s = await section();
    await s.findByText("You have not created any webhook sources yet.");

    const submit = s.getByRole("button", { name: "Create source" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fillCreate(s, "  ci-main ", "ci.finished, deploy.done  ci.finished");
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    const secret = (await s.findByLabelText("Signing secret")) as HTMLInputElement;
    expect(secret.value).toBe(SECRET);
    expect(secret.readOnly).toBe(true);
    expect(writes(api)).toEqual([
      {
        method: "POST",
        path: "/api/team/webhooks/sources",
        body: { id: "ci-main", eventTypes: ["ci.finished", "deploy.done"] },
      },
    ]);
    expect(s.getByText(/shown only once/)).toBeTruthy();
    expect((s.getByLabelText("Address to send to (on this Core)") as HTMLInputElement).value).toBe(
      "/api/webhooks/in/ci-main",
    );
    // The list refreshed from Core and the secret appears in one place only.
    await s.findByText("Address: /api/webhooks/in/ci-main");
    expect(container.textContent?.split(SECRET).length).toBe(1);
    expect((s.getByLabelText("Source name") as HTMLInputElement).value).toBe("");
    // Only one secret at a time: creating another waits until this one is closed.
    expect((s.getByRole("button", { name: "Create source" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(s.getByRole("button", { name: "Copy secret" }));
    await s.findByText("Copied to the clipboard.");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(SECRET);

    fireEvent.click(s.getByRole("button", { name: "I have saved it, close" }));
    expect(s.queryByLabelText("Signing secret")).toBeNull();
    expect(s.queryByText("Copied to the clipboard.")).toBeNull();
    expect(container.innerHTML).not.toContain(SECRET);
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();

    // Reloading from Core never brings it back.
    cleanup();
    open(world);
    const again = await section();
    await again.findByText("ci-main");
    expect(again.queryByLabelText("Signing secret")).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("falls back to copying by hand when the clipboard refuses, keeping the secret visible", async () => {
    const world: World = { status: { enabled: true, sources: [] } };
    open(world, {
      "POST /api/team/webhooks/sources": (body) => ({
        source: source({ id: asCreate(body).id }),
        secret: SECRET,
      }),
    });
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const s = await section();
    await s.findByText("You have not created any webhook sources yet.");
    fillCreate(s, "ci-main", "ci.finished");
    fireEvent.click(s.getByRole("button", { name: "Create source" }));
    await s.findByLabelText("Signing secret");
    fireEvent.click(s.getByRole("button", { name: "Copy secret" }));
    expect(await s.findByText(/copy it by hand/)).toBeTruthy();
    expect(s.queryByText("Copied to the clipboard.")).toBeNull();
    expect((s.getByLabelText("Signing secret") as HTMLInputElement).value).toBe(SECRET);
  });

  it("validates the name and event types with Core's rules before sending anything", async () => {
    const { api } = open({ status: { enabled: true, sources: [] } });
    const s = await section();
    await s.findByText("You have not created any webhook sources yet.");
    const submit = s.getByRole("button", { name: "Create source" }) as HTMLButtonElement;

    for (const bad of ["ab", "Ci-main", "1ci-main", "ci main", "ci.main", "a".repeat(33)]) {
      fillCreate(s, bad, "ci.finished");
      expect(submit.disabled, bad).toBe(true);
    }
    fillCreate(s, "ci-main", "stripe.charge");
    expect(submit.disabled).toBe(true);
    expect((await s.findByRole("alert")).textContent).toMatch(/must start with one of: build/);
    fillCreate(s, "ci-main", "ci");
    expect(submit.disabled).toBe(true);
    expect((await s.findByRole("alert")).textContent).toMatch(/lowercase words joined by dots/);
    fillCreate(s, "ci-main", Array.from({ length: 17 }, (_, n) => `ci.t${n}`).join(","));
    expect(submit.disabled).toBe(true);
    expect((await s.findByRole("alert")).textContent).toMatch(/at most 16/);
    fillCreate(s, "ci-main", "");
    expect(submit.disabled).toBe(true);

    fillCreate(s, "ci_main-2", "ci.finished");
    expect(submit.disabled).toBe(false);
    expect(writes(api)).toEqual([]);

    expect(sourceIdProblem("")).toBe("empty");
    expect(sourceIdProblem("abc")).toBeNull();
    expect(eventTypesProblem(["webhook.x"])).toBeNull();
    expect(eventTypesProblem(["dictation.idle"])).toBe("namespace");
  });

  it("shows a Core refusal as text and keeps the form", async () => {
    open(
      { status: { enabled: true, sources: [] } },
      {
        "POST /api/team/webhooks/sources": () =>
          new Response(
            JSON.stringify({
              code: "INVALID_REQUEST",
              message: "Source exists <img src=x onerror=alert(1)>",
              details: [],
            }),
            { status: 400 },
          ),
      },
    );
    const s = await section();
    await s.findByText("You have not created any webhook sources yet.");
    fillCreate(s, "ci-main", "ci.finished");
    fireEvent.click(s.getByRole("button", { name: "Create source" }));
    const alert = await s.findByRole("alert");
    expect(alert.textContent).toBe("Source exists <img src=x onerror=alert(1)>");
    expect(alert.querySelector("img")).toBeNull();
    expect(s.queryByLabelText("Signing secret")).toBeNull();
    expect((s.getByLabelText("Source name") as HTMLInputElement).value).toBe("ci-main");
  });

  it("asks before deleting, then calls the delete route and drops the source", async () => {
    const world: World = { status: { enabled: true, sources: [source()] } };
    const { api } = open(world, {
      "DELETE /api/team/webhooks/sources/ci-main": () => {
        world.status = { enabled: true, sources: [] };
        return world.status;
      },
    });
    const s = await section();
    await s.findByText("ci-main");

    fireEvent.click(s.getByRole("button", { name: "Delete source ci-main" }));
    expect(s.getByText(/Delete ci-main\? Its secret stops working immediately/)).toBeTruthy();
    expect(writes(api)).toEqual([]);

    fireEvent.click(s.getByRole("button", { name: "Cancel" }));
    expect(writes(api)).toEqual([]);
    expect(s.getByRole("button", { name: "Delete source ci-main" })).toBeTruthy();

    fireEvent.click(s.getByRole("button", { name: "Delete source ci-main" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    await s.findByText("You have not created any webhook sources yet.");
    expect(writes(api)).toEqual([
      { method: "DELETE", path: "/api/team/webhooks/sources/ci-main", body: {} },
    ]);
  });

  it("shows Core's error when deleting fails and keeps the source", async () => {
    open(
      { status: { enabled: true, sources: [source()] } },
      {
        "DELETE /api/team/webhooks/sources/ci-main": () =>
          new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "No such source" }), {
            status: 404,
          }),
      },
    );
    const s = await section();
    await s.findByText("ci-main");
    fireEvent.click(s.getByRole("button", { name: "Delete source ci-main" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    expect((await s.findByRole("alert")).textContent).toBe("No such source");
    expect(s.getByText("ci-main")).toBeTruthy();
  });

  it("deleting the source whose secret is showing clears the secret", async () => {
    const world: World = { status: { enabled: true, sources: [] } };
    open(world, {
      "POST /api/team/webhooks/sources": (body) => {
        const made = source({ id: asCreate(body).id });
        world.status = { enabled: true, sources: [made] };
        return { source: made, secret: SECRET };
      },
      "DELETE /api/team/webhooks/sources/ci-main": () => {
        world.status = { enabled: true, sources: [] };
        return world.status;
      },
    });
    const s = await section();
    await s.findByText("You have not created any webhook sources yet.");
    fillCreate(s, "ci-main", "ci.finished");
    fireEvent.click(s.getByRole("button", { name: "Create source" }));
    await s.findByLabelText("Signing secret");
    await s.findByText("Address: /api/webhooks/in/ci-main");
    fireEvent.click(s.getByRole("button", { name: "Delete source ci-main" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(s.queryByLabelText("Signing secret")).toBeNull());
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("sends the master switch exactly", async () => {
    const world: World = { status: { enabled: false, sources: [] } };
    const { api } = open(world, {
      "PUT /api/team/webhooks": (body) => {
        world.status = { enabled: asMaster(body).enabled, sources: [] };
        return world.status;
      },
    });
    const s = await section();
    const box = (await s.findByRole("checkbox")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect((s.getByRole("checkbox") as HTMLInputElement).checked).toBe(true));
    expect(writes(api)).toEqual([
      { method: "PUT", path: "/api/team/webhooks", body: { enabled: true } },
    ]);
  });

  it("renders hostile source names, paths and types as inert, cleaned text", async () => {
    const hostile = '<img src=x onerror="alert(1)">\u202Eevil\u200B';
    const world: World = {
      status: {
        enabled: true,
        sources: [
          source({
            id: hostile,
            path: `/api/webhooks/in/${hostile}`,
            eventTypes: ["<script>alert(1)</script>", "ci.\u202Edone"],
            lastAcceptedAt: "<b>now</b>",
          }),
        ],
      },
    };
    const { container, api } = open(world, {
      "DELETE /api/team/webhooks/sources/*": () => ({ enabled: true, sources: [] }),
    });
    const s = await section();
    const shown = '<img src=x onerror="alert(1)">evil';
    await s.findByText(shown);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).not.toMatch(/[\u202e\u200b]/);
    expect(s.getByText(`Address: /api/webhooks/in/${shown}`)).toBeTruthy();
    expect(s.getByText("Event types: <script>alert(1)</script>, ci.done")).toBeTruthy();
    expect(s.getByText("Last accepted: <b>now</b>")).toBeTruthy();

    // The route still gets the source's real id, encoded, not the cleaned label.
    fireEvent.click(s.getByRole("button", { name: `Delete source ${shown}` }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    await s.findByText("You have not created any webhook sources yet.");
    expect(writes(api)[0]?.path).toBe(`/api/team/webhooks/sources/${encodeURIComponent(hostile)}`);

    expect(cleanLabel("a\u0000b\u202ec")).toBe("abc");
    expect(cleanLabel("x".repeat(80))).toBe(`${"x".repeat(64)}…`);
  });

  it("shows a disabled source as disabled and sends the exact enable/disable body, showing Core's answer", async () => {
    const world: World = {
      status: {
        enabled: true,
        sources: [source(), source({ id: "alerts-prod", enabled: false })],
      },
    };
    const { api } = open(world, {
      "PUT /api/team/webhooks/sources/*": (body, url) => {
        const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        const { enabled } = asMaster(body);
        world.status = {
          ...world.status,
          sources: world.status.sources.map((s) => (s.id === id ? { ...s, enabled } : s)),
        };
        return world.status;
      },
    });
    const s = await section();
    await s.findByText("ci-main");
    expect(
      s.getAllByText("This source is disabled: Phoenix refuses everything sent to it."),
    ).toHaveLength(1);
    expect(s.getByText("Disabled")).toBeTruthy();

    fireEvent.click(s.getByRole("button", { name: "Disable source ci-main" }));
    await s.findByRole("button", { name: "Enable source ci-main" });
    expect(
      s.getAllByText("This source is disabled: Phoenix refuses everything sent to it."),
    ).toHaveLength(2);
    expect(s.queryByText("Enabled")).toBeNull();

    fireEvent.click(s.getByRole("button", { name: "Enable source alerts-prod" }));
    await s.findByRole("button", { name: "Disable source alerts-prod" });
    expect(
      s.getAllByText("This source is disabled: Phoenix refuses everything sent to it."),
    ).toHaveLength(1);
    expect(writes(api)).toEqual([
      { method: "PUT", path: "/api/team/webhooks/sources/ci-main", body: { enabled: false } },
      { method: "PUT", path: "/api/team/webhooks/sources/alerts-prod", body: { enabled: true } },
    ]);
  });

  it("does not flip the switch itself: Core's refusal is shown as text and the state stays", async () => {
    const { api } = open(
      { status: { enabled: true, sources: [source()] } },
      {
        "PUT /api/team/webhooks/sources/ci-main": () =>
          new Response(
            JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "No such source <b>x</b>" }),
            { status: 404 },
          ),
      },
    );
    const s = await section();
    await s.findByText("ci-main");
    fireEvent.click(s.getByRole("button", { name: "Disable source ci-main" }));
    const alert = await s.findByRole("alert");
    expect(alert.textContent).toBe("No such source <b>x</b>");
    expect(alert.querySelector("b")).toBeNull();
    expect(s.getByRole("button", { name: "Disable source ci-main" })).toBeTruthy();
    expect(s.queryByText(/This source is disabled/)).toBeNull();
    expect(writes(api)).toHaveLength(1);
  });

  it("rotates only after confirmation, shows the new secret once, then clears it", async () => {
    // Built from parts: gitleaks flags a secret-shaped literal even in a test.
    const NEW_SECRET = ["n3w", "secret", "9876543210zyxwvutsrqponmlkjihgfedcba"].join("-");
    const world: World = { status: { enabled: true, sources: [source()] } };
    const { api, container } = open(world, {
      "POST /api/team/webhooks/sources/ci-main/rotate": () => ({
        source: world.status.sources[0],
        secret: NEW_SECRET,
      }),
    });
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const s = await section();
    await s.findByText("ci-main");

    fireEvent.click(s.getByRole("button", { name: "Rotate the secret of source ci-main" }));
    expect(s.getByText(/old secret stops working immediately/)).toBeTruthy();
    expect(writes(api)).toEqual([]);

    // Cancelling sends nothing and shows nothing.
    fireEvent.click(s.getByRole("button", { name: "Cancel" }));
    expect(writes(api)).toEqual([]);
    expect(s.queryByLabelText("Signing secret")).toBeNull();

    fireEvent.click(s.getByRole("button", { name: "Rotate the secret of source ci-main" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    const shown = (await s.findByLabelText("Signing secret")) as HTMLInputElement;
    expect(shown.value).toBe(NEW_SECRET);
    expect(shown.readOnly).toBe(true);
    expect(writes(api)).toEqual([
      { method: "POST", path: "/api/team/webhooks/sources/ci-main/rotate", body: {} },
    ]);
    expect(s.getByText(/shown only once/)).toBeTruthy();
    expect(s.getByText(/The old secret has stopped working/)).toBeTruthy();
    expect(s.getByText("Secret for ci-main")).toBeTruthy();
    expect((s.getByLabelText("Address to send to (on this Core)") as HTMLInputElement).value).toBe(
      "/api/webhooks/in/ci-main",
    );
    expect(container.textContent?.split(NEW_SECRET).length).toBe(1);
    // The confirmation closed, so the row offers the actions again.
    expect(s.queryByRole("button", { name: "Confirm" })).toBeNull();

    fireEvent.click(s.getByRole("button", { name: "Copy secret" }));
    await s.findByText("Copied to the clipboard.");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(NEW_SECRET);

    fireEvent.click(s.getByRole("button", { name: "I have saved it, close" }));
    expect(s.queryByLabelText("Signing secret")).toBeNull();
    expect(s.queryByText("Copied to the clipboard.")).toBeNull();
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
    expect(screen.queryByDisplayValue(NEW_SECRET)).toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();

    // Reloading from Core never brings it back.
    cleanup();
    open(world);
    const again = await section();
    await again.findByText("ci-main");
    expect(again.queryByLabelText("Signing secret")).toBeNull();
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
  });

  it("a second rotate replaces the panel and the earlier secret is gone from the page", async () => {
    const FIRST = "first-secret-0123456789abcdefghijklmnopqrstuvwx";
    const SECOND = "second-secret-abcdefghijklmnopqrstuvwxyz0123456";
    const world: World = {
      status: { enabled: true, sources: [source(), source({ id: "alerts-prod" })] },
    };
    const secrets = [FIRST, SECOND];
    const { api, container } = open(world, {
      "POST /api/team/webhooks/sources/ci-main/rotate": () => ({
        source: world.status.sources[0],
        secret: secrets.shift(),
      }),
      "POST /api/team/webhooks/sources/alerts-prod/rotate": () => ({
        source: world.status.sources[1],
        secret: secrets.shift(),
      }),
    });
    const s = await section();
    await s.findByText("alerts-prod");

    fireEvent.click(s.getByRole("button", { name: "Rotate the secret of source ci-main" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect((s.getByLabelText("Signing secret") as HTMLInputElement).value).toBe(FIRST),
    );

    fireEvent.click(s.getByRole("button", { name: "Rotate the secret of source alerts-prod" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect((s.getByLabelText("Signing secret") as HTMLInputElement).value).toBe(SECOND),
    );
    expect(s.getByText("Secret for alerts-prod")).toBeTruthy();
    expect(s.getAllByLabelText("Signing secret")).toHaveLength(1);
    expect(container.innerHTML).not.toContain(FIRST);
    expect(screen.queryByDisplayValue(FIRST)).toBeNull();
    expect(writes(api).map((c) => c.path)).toEqual([
      "/api/team/webhooks/sources/ci-main/rotate",
      "/api/team/webhooks/sources/alerts-prod/rotate",
    ]);
  });

  it("deleting the rotated source clears its secret", async () => {
    const world: World = { status: { enabled: true, sources: [source()] } };
    open(world, {
      "POST /api/team/webhooks/sources/ci-main/rotate": () => ({
        source: world.status.sources[0],
        secret: SECRET,
      }),
      "DELETE /api/team/webhooks/sources/ci-main": () => {
        world.status = { enabled: true, sources: [] };
        return world.status;
      },
    });
    const s = await section();
    await s.findByText("ci-main");
    fireEvent.click(s.getByRole("button", { name: "Rotate the secret of source ci-main" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    await s.findByLabelText("Signing secret");
    fireEvent.click(s.getByRole("button", { name: "Delete source ci-main" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(s.queryByLabelText("Signing secret")).toBeNull());
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("shows Core's refusal to rotate as text, shows no secret and keeps an earlier panel", async () => {
    const world: World = {
      status: { enabled: true, sources: [source(), source({ id: "alerts-prod" })] },
    };
    open(world, {
      "POST /api/team/webhooks/sources/ci-main/rotate": () => ({
        source: world.status.sources[0],
        secret: SECRET,
      }),
      "POST /api/team/webhooks/sources/alerts-prod/rotate": () =>
        new Response(
          JSON.stringify({ code: "INTERNAL", message: "secret store locked <img src=x>" }),
          { status: 500 },
        ),
    });
    const s = await section();
    await s.findByText("alerts-prod");
    fireEvent.click(s.getByRole("button", { name: "Rotate the secret of source ci-main" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    await s.findByLabelText("Signing secret");

    fireEvent.click(s.getByRole("button", { name: "Rotate the secret of source alerts-prod" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm" }));
    const alert = await s.findByRole("alert");
    expect(alert.textContent).toBe("secret store locked <img src=x>");
    expect(alert.querySelector("img")).toBeNull();
    // The failure shows nothing new; the panel still holds the secret Core did give.
    expect((s.getByLabelText("Signing secret") as HTMLInputElement).value).toBe(SECRET);
    expect(s.getByText("Secret for ci-main")).toBeTruthy();
  });

  it("sends hostile source names encoded to the toggle and rotate routes, rendered inert", async () => {
    const hostile = '<img src=x onerror="alert(1)">\u202Eevil\u200B';
    const shown = '<img src=x onerror="alert(1)">evil';
    const world: World = {
      status: {
        enabled: true,
        sources: [source({ id: hostile, path: `/api/webhooks/in/${hostile}` })],
      },
    };
    const { api, container } = open(world, {
      "PUT /api/team/webhooks/sources/*": () => ({
        enabled: true,
        sources: [{ ...world.status.sources[0]!, enabled: false }],
      }),
    });
    const s = await section();
    await s.findByText(shown);

    fireEvent.click(s.getByRole("button", { name: `Disable source ${shown}` }));
    await s.findByText(/This source is disabled/);
    fireEvent.click(s.getByRole("button", { name: `Rotate the secret of source ${shown}` }));
    expect(s.getByText(new RegExp("Rotate the secret of .*evil\\?"))).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toMatch(/[\u202e\u200b]/);
    expect(writes(api)).toEqual([
      {
        method: "PUT",
        path: `/api/team/webhooks/sources/${encodeURIComponent(hostile)}`,
        body: { enabled: false },
      },
    ]);
  });

  it("shows Core's words when the list cannot be loaded", async () => {
    mountWith(<TeamWebhooksSection />, {
      "GET /api/team/webhooks": () =>
        new Response(JSON.stringify({ code: "INTERNAL", message: "settings unreadable" }), {
          status: 500,
        }),
    });
    const s = await section();
    expect((await s.findByRole("alert")).textContent).toBe("settings unreadable");
  });
});
