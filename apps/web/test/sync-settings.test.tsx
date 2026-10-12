// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SyncItem, SyncStatus } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { openAt } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const item: SyncItem = {
  id: "record-1",
  owner: "device-one",
  scope: "project",
  project: "alpha",
  data_class: "context",
  value: { secret: "SECRET_CONTENT_NEVER_RENDER" },
  revision: "rev-local-uuid",
  updated_at: "2026-10-09T12:00:00Z",
  deleted: false,
  pending: false,
  base_revision: "rev-base-uuid",
  conflict: null,
};
type AdapterKey = "pet.settings.reduced_motion" | "retrieval.settings.k";
type AdapterSource = {
  key: AdapterKey;
  selected: boolean;
  current: unknown;
  revision: string | null;
  available: boolean;
};
type AdapterStatus = SyncStatus & { adapter_keys: AdapterKey[]; adapter_sources: AdapterSource[] };
const motion: AdapterKey = "pet.settings.reduced_motion";
const searchCount: AdapterKey = "retrieval.settings.k";
const source = (
  key: AdapterKey,
  current: unknown,
  revision = "staged-revision",
): AdapterSource => ({
  key,
  selected: true,
  current,
  revision,
  available: true,
});

const status = (enabled = false): AdapterStatus => ({
  enabled,
  identity: enabled ? "device-one" : null,
  endpoint: enabled ? "https://relay.example" : null,
  excluded_projects: [],
  excluded_classes: [],
  pending: 0,
  conflicts: 0,
  items: [],
  adapter_keys: [],
  adapter_sources: [],
});
const section = async () =>
  within((await screen.findByRole("heading", { name: "Encrypted sync" })).closest("section")!);

function open(initial: AdapterStatus = status()) {
  let current = initial;
  const view = openAt("#/settings", {
    "GET /api/sync": () => current,
    "POST /api/sync/adapter": (body) => {
      const { keys } = body as { keys: AdapterKey[]; refresh?: AdapterKey };
      current = { ...current, adapter_keys: keys };
      return current;
    },
    "POST /api/sync/adapter/apply": () => current,
    "POST /api/sync/configure": () => {
      current = {
        ...current,
        enabled: true,
        identity: "device-one",
        endpoint: "https://relay.example",
      };
      return { ...current, recovery_key: "ONE_TIME_RECOVERY_KEY" };
    },
    "POST /api/sync/disable": () => (current = { ...current, enabled: false }),
    "POST /api/sync/exclusions": (body) =>
      (current = {
        ...current,
        ...(body as Pick<SyncStatus, "excluded_projects" | "excluded_classes">),
      }),
    "POST /api/sync/run": () => current,
  });
  return {
    ...view,
    setStatus: (next: AdapterStatus) => {
      current = next;
    },
  };
}

describe("Encrypted sync Settings", () => {
  it("is off by default and configures only after explicit opt-in, with immediate manual sync available", async () => {
    const { api } = open();
    const s = await section();
    expect(await s.findByText(/Sync is off/)).toBeTruthy();
    expect(s.getByText(/queued records sync automatically while online afterward/)).toBeTruthy();
    expect(api.posts("/api/sync/configure")).toHaveLength(0);
    expect(api.posts("/api/sync/run")).toHaveLength(0);
    fireEvent.click(s.getByRole("checkbox", { name: "context" }));
    await waitFor(() => expect(api.posts("/api/sync/exclusions")).toHaveLength(1));
    expect(api.posts("/api/sync/configure")).toHaveLength(0);
    await waitFor(() =>
      expect((s.getByRole("checkbox", { name: "context" }) as HTMLInputElement).checked).toBe(true),
    );
    fireEvent.change(s.getByLabelText("Relay HTTPS URL"), {
      target: { value: "https://relay.example" },
    });
    fireEvent.change(s.getByLabelText("Relay authentication token"), {
      target: { value: "relay-private-token" },
    });
    fireEvent.click(s.getByRole("button", { name: "Configure encrypted sync" }));
    await waitFor(() => expect(api.posts("/api/sync/configure")).toHaveLength(1));
    expect(api.posts("/api/sync/configure")[0]?.body).toEqual({
      endpoint: "https://relay.example",
      relay_token: "relay-private-token",
    });
    expect(api.posts("/api/sync/run")).toHaveLength(0);
    fireEvent.click(await s.findByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api.posts("/api/sync/run")).toHaveLength(1));
  });

  it("shows key only once, then removes it and auth token from the DOM and never renders item values", async () => {
    const { container, setStatus } = open();
    const s = await section();
    fireEvent.change(s.getByLabelText("Relay HTTPS URL"), {
      target: { value: "https://relay.example" },
    });
    fireEvent.change(s.getByLabelText("Relay authentication token"), {
      target: { value: "relay-private-token" },
    });
    fireEvent.click(s.getByRole("button", { name: "Configure encrypted sync" }));
    expect(await s.findByText("ONE_TIME_RECOVERY_KEY")).toBeTruthy();
    expect(container.innerHTML).not.toContain("relay-private-token");
    fireEvent.click(s.getByRole("button", { name: /I saved the key/ }));
    expect(container.innerHTML).not.toContain("ONE_TIME_RECOVERY_KEY");
    setStatus({ ...status(true), items: [item] });
    fireEvent.click(s.getByRole("button", { name: "Refresh sync status" }));
    expect(await s.findByText("record-1", { selector: "strong" })).toBeTruthy();
    expect(container.innerHTML).not.toContain("SECRET_CONTENT_NEVER_RENDER");
  });

  it("requires an explicit preview and choice before resolving a conflict", async () => {
    const current = {
      ...status(true),
      conflicts: 1,
      items: [
        {
          ...item,
          conflict: { ...item, revision: "rev-remote-uuid", value: { secret: "REMOTE_SECRET" } },
        },
      ],
    };
    const { api, container } = open(current);
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Review keeping remote for record-1" }));
    expect(api.posts("/api/sync/items/resolve")).toHaveLength(0);
    expect(s.getByRole("group", { name: "Conflict resolution preview" }).textContent).toContain(
      "Keep remote: replace the local staged sync record",
    );
    expect(container.innerHTML).not.toContain("REMOTE_SECRET");
    fireEvent.click(s.getByRole("button", { name: "Confirm keep remote" }));
    await waitFor(() => expect(api.posts("/api/sync/items/resolve")).toHaveLength(1));
    expect(api.posts("/api/sync/items/resolve")[0]?.body).toEqual({
      id: "record-1",
      scope: "project",
      choice: "remote",
    });
  });

  it("previews missing-remote restore and accept-deletion without silently deleting", async () => {
    const { api } = open({
      ...status(true),
      conflicts: 1,
      items: [{ ...item, conflict: "remote_missing" }],
    });
    const s = await section();
    expect((await s.findByRole("alert")).textContent).toContain("missing on the relay");
    fireEvent.click(s.getByRole("button", { name: "Review keeping local for record-1" }));
    expect(s.getByRole("group", { name: "Conflict resolution preview" }).textContent).toContain(
      "Restore missing remote: queue the local version",
    );
    expect(api.posts("/api/sync/items/resolve")).toHaveLength(0);
    fireEvent.click(s.getByRole("button", { name: "Cancel resolution" }));
    fireEvent.click(
      s.getByRole("button", { name: "Review accepting remote deletion for record-1" }),
    );
    expect(s.getByRole("group", { name: "Conflict resolution preview" }).textContent).toContain(
      "delete the local staged sync record now; nothing is uploaded",
    );
    expect(api.posts("/api/sync/items/resolve")).toHaveLength(0);
    fireEvent.click(s.getByRole("button", { name: "Confirm accept remote deletion" }));
    await waitFor(() => expect(api.posts("/api/sync/items/resolve")).toHaveLength(1));
    expect(api.posts("/api/sync/items/resolve")[0]?.body).toEqual({
      id: "record-1",
      scope: "project",
      choice: "remote",
    });
  });

  it("cancels remote deletion and requires confirm:true for an explicit deletion", async () => {
    const { api } = open({ ...status(true), items: [item] });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Review remote deletion for record-1" }));
    fireEvent.click(s.getByRole("button", { name: "Cancel deletion" }));
    expect(api.posts("/api/sync/items/delete")).toHaveLength(0);
    fireEvent.click(s.getByRole("button", { name: "Review remote deletion for record-1" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm remote deletion" }));
    await waitFor(() => expect(api.posts("/api/sync/items/delete")).toHaveLength(1));
    expect(api.posts("/api/sync/items/delete")[0]?.body).toEqual({
      id: "record-1",
      scope: "project",
      confirm: true,
    });
  });

  it("saves class and project exclusions through the sync API", async () => {
    const { api } = open(status(true));
    const s = await section();
    fireEvent.click(await s.findByRole("checkbox", { name: "context" }));
    await waitFor(() => expect(api.posts("/api/sync/exclusions")).toHaveLength(1));
    await waitFor(() =>
      expect((s.getByRole("checkbox", { name: "context" }) as HTMLInputElement).checked).toBe(true),
    );
    expect(api.posts("/api/sync/exclusions")[0]?.body).toEqual({
      excluded_projects: [],
      excluded_classes: ["context"],
    });
    fireEvent.change(s.getByLabelText("Exclude project by name"), { target: { value: "alpha" } });
    fireEvent.click(s.getByRole("button", { name: "Exclude project" }));
    await waitFor(() => expect(api.posts("/api/sync/exclusions")).toHaveLength(2));
    expect(api.posts("/api/sync/exclusions")[1]?.body).toEqual({
      excluded_projects: ["alpha"],
      excluded_classes: ["context"],
    });
  });

  it("keeps deletion confirmation visible on a failed request and does not claim success", async () => {
    const { api } = open({ ...status(true), items: [item] });
    api.set(
      "POST /api/sync/items/delete",
      () =>
        new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "Deletion refused" }), {
          status: 400,
        }),
    );
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Review remote deletion for record-1" }));
    fireEvent.click(s.getByRole("button", { name: "Confirm remote deletion" }));
    expect((await s.findByRole("alert")).textContent).toContain("Deletion refused");
    expect(s.getByRole("group", { name: "Remote deletion confirmation" })).toBeTruthy();
    expect(s.queryByText(/Deletion queued/)).toBeNull();
  });

  it("turns sync off without dropping the queued count", async () => {
    const { api } = open({ ...status(true), pending: 2, items: [{ ...item, pending: true }] });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Turn sync off" }));
    await waitFor(() => expect(api.posts("/api/sync/disable")).toHaveLength(1));
    expect(await s.findByText(/Sync is off\. 2 queued/)).toBeTruthy();
    expect(s.queryByRole("button", { name: "Sync now" })).toBeNull();
  });

  it("reports a failed offline sync without claiming queued records were transmitted", async () => {
    const { api } = open({ ...status(true), pending: 2, items: [{ ...item, pending: true }] });
    api.set(
      "POST /api/sync/run",
      () =>
        new Response(JSON.stringify({ code: "RELAY_OFFLINE", message: "Relay unreachable" }), {
          status: 503,
        }),
    );
    const s = await section();
    expect(await s.findByText(/2 queued/)).toBeTruthy();
    fireEvent.click(s.getByRole("button", { name: "Sync now" }));
    expect((await s.findByRole("alert")).textContent).toContain("Relay unreachable");
    expect(s.getByText(/2 queued/)).toBeTruthy();
  });

  it("keeps adapters disabled before sync consent and never stages settings on status, configure, or sync", async () => {
    const { api } = open();
    const s = await section();
    const motionChoice = (await s.findByRole("checkbox", {
      name: "Reduced motion preference",
    })) as HTMLInputElement;
    const searchChoice = s.getByRole("checkbox", {
      name: "Search result count metadata",
    }) as HTMLInputElement;
    expect(motionChoice.closest("fieldset")?.disabled).toBe(true);
    expect(searchChoice.closest("fieldset")?.disabled).toBe(true);
    expect(motionChoice.checked).toBe(false);
    expect(searchChoice.checked).toBe(false);
    expect(api.posts("/api/sync/adapter")).toHaveLength(0);
    fireEvent.change(s.getByLabelText("Relay HTTPS URL"), {
      target: { value: "https://relay.example" },
    });
    fireEvent.change(s.getByLabelText("Relay authentication token"), {
      target: { value: "relay-private-token" },
    });
    fireEvent.click(s.getByRole("button", { name: "Configure encrypted sync" }));
    await s.findByRole("button", { name: "Sync now" });
    expect(motionChoice.closest("fieldset")?.disabled).toBe(false);
    expect(motionChoice.checked).toBe(false);
    fireEvent.click(s.getByRole("button", { name: "Refresh sync status" }));
    fireEvent.click(s.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api.posts("/api/sync/run")).toHaveLength(1));
    expect(api.posts("/api/sync/adapter")).toHaveLength(0);
    expect(api.posts("/api/sync/adapter/apply")).toHaveLength(0);
    expect(s.queryByRole("button", { name: /Publish current/ })).toBeNull();
  });

  it("selects only named account settings and requires explicit refresh for later changes", async () => {
    const { api, setStatus } = open(status(true));
    const s = await section();
    expect(await s.findByText(/there are no project-scoped sources/)).toBeTruthy();
    fireEvent.click(s.getByRole("checkbox", { name: "Reduced motion preference" }));
    await waitFor(() => expect(api.posts("/api/sync/adapter")).toHaveLength(1));
    expect(api.posts("/api/sync/adapter")[0]?.body).toEqual({ keys: [motion] });
    await s.findByRole("button", { name: `Publish current ${motion}` });
    fireEvent.click(s.getByRole("checkbox", { name: "Search result count metadata" }));
    await waitFor(() => expect(api.posts("/api/sync/adapter")).toHaveLength(2));
    expect(api.posts("/api/sync/adapter")[1]?.body).toEqual({ keys: [motion, searchCount] });
    setStatus({
      ...status(true),
      adapter_keys: [motion, searchCount],
      adapter_sources: [source(motion, false)],
    });
    fireEvent.click(s.getByRole("button", { name: "Refresh sync status" }));
    await s.findByRole("button", { name: `Review applying ${motion}` });
    expect(api.posts("/api/sync/adapter")).toHaveLength(2);
    expect(api.posts("/api/sync/adapter/apply")).toHaveLength(0);
    fireEvent.click(s.getByRole("button", { name: `Publish current ${motion}` }));
    await waitFor(() => expect(api.posts("/api/sync/adapter")).toHaveLength(3));
    expect(api.posts("/api/sync/adapter")[2]?.body).toEqual({
      keys: [motion, searchCount],
      refresh: motion,
    });
    expect(api.posts("/api/sync/adapter/apply")).toHaveLength(0);
    fireEvent.click(s.getByRole("checkbox", { name: "Reduced motion preference" }));
    await waitFor(() => expect(api.posts("/api/sync/adapter")).toHaveLength(4));
    expect(api.posts("/api/sync/adapter")[3]?.body).toEqual({ keys: [searchCount] });
    await waitFor(() =>
      expect(s.queryByRole("button", { name: `Publish current ${motion}` })).toBeNull(),
    );
  });

  it("hides decrypted values, previews remote apply, and only sends the exact selected source on confirmation", async () => {
    const raw = "SENSITIVE_RAW_SETTING_NEVER_RENDER";
    const incoming = { k: 9, private_value: raw };
    const { api, container } = open({
      ...status(true),
      adapter_keys: [searchCount],
      adapter_sources: [
        source(searchCount, incoming, "remote-revision"),
        { ...source(motion, raw), selected: false },
        { ...source(motion, raw, "unavailable-revision"), available: false },
      ],
    });
    const s = await section();
    expect(s.queryByRole("button", { name: `Review applying ${motion}` })).toBeNull();
    expect(container.innerHTML).not.toContain(raw);
    fireEvent.click(await s.findByRole("button", { name: `Review applying ${searchCount}` }));
    const preview = s.getByRole("group", { name: "Setting apply preview" });
    expect(preview.textContent).toContain("remote-revision");
    expect(preview.textContent).toContain("replace the current value only after confirmation");
    expect(container.innerHTML).not.toContain(raw);
    expect(api.posts("/api/sync/adapter/apply")).toHaveLength(0);
    fireEvent.click(s.getByRole("button", { name: "Cancel apply" }));
    expect(s.queryByRole("group", { name: "Setting apply preview" })).toBeNull();
    expect(api.posts("/api/sync/adapter/apply")).toHaveLength(0);
    fireEvent.click(s.getByRole("button", { name: `Review applying ${searchCount}` }));
    fireEvent.click(s.getByRole("button", { name: "Confirm apply setting" }));
    await waitFor(() => expect(api.posts("/api/sync/adapter/apply")).toHaveLength(1));
    expect(api.posts("/api/sync/adapter/apply")[0]?.body).toEqual({
      key: searchCount,
      revision: "remote-revision",
      current: incoming,
    });
    expect(container.innerHTML).not.toContain(raw);
  });

  it("refuses a stale local value or staged revision rather than claiming an apply succeeded", async () => {
    let localValue = false;
    let stagedRevision = "old-revision";
    const { api } = open({
      ...status(true),
      adapter_keys: [motion],
      adapter_sources: [source(motion, localValue, stagedRevision)],
    });
    api.set("POST /api/sync/adapter/apply", (body) => {
      const preview = body as { current: unknown; revision: string };
      if (preview.current !== localValue || preview.revision !== stagedRevision) {
        return new Response(
          JSON.stringify({
            code: "SYNC_CONFLICT",
            message: "Local setting or staged revision changed",
          }),
          { status: 409 },
        );
      }
      return status(true);
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: `Review applying ${motion}` }));
    localValue = true;
    stagedRevision = "new-revision";
    fireEvent.click(s.getByRole("button", { name: "Confirm apply setting" }));
    await waitFor(() => expect(api.posts("/api/sync/adapter/apply")).toHaveLength(1));
    expect(api.posts("/api/sync/adapter/apply")[0]?.body).toEqual({
      key: motion,
      revision: "old-revision",
      current: false,
    });
    expect((await s.findByRole("alert")).textContent).toContain(
      "Local setting or staged revision changed",
    );
    expect(s.queryByText("Selected synced setting applied locally.")).toBeNull();
  });

  it("invalidates an open apply preview when refreshed status changes the source", async () => {
    const { api, setStatus } = open({
      ...status(true),
      adapter_keys: [motion],
      adapter_sources: [source(motion, false, "old-revision")],
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: `Review applying ${motion}` }));
    expect(s.getByRole("group", { name: "Setting apply preview" }).textContent).toContain(
      "old-revision",
    );
    setStatus({
      ...status(true),
      adapter_keys: [motion],
      adapter_sources: [source(motion, true, "new-revision")],
    });
    fireEvent.click(s.getByRole("button", { name: "Refresh sync status" }));
    await waitFor(() =>
      expect(s.queryByRole("group", { name: "Setting apply preview" })).toBeNull(),
    );
    expect(api.posts("/api/sync/adapter/apply")).toHaveLength(0);
  });

  it("preserves exclusions when opting into adapter keys and never exposes excluded raw records", async () => {
    const { api, container } = open({
      ...status(true),
      excluded_classes: ["context"],
      excluded_projects: ["alpha"],
    });
    const s = await section();
    fireEvent.click(await s.findByRole("checkbox", { name: "Reduced motion preference" }));
    await waitFor(() => expect(api.posts("/api/sync/adapter")).toHaveLength(1));
    expect(api.posts("/api/sync/adapter")[0]?.body).toEqual({ keys: [motion] });
    expect(api.posts("/api/sync/exclusions")).toHaveLength(0);
    expect((s.getByRole("checkbox", { name: "context" }) as HTMLInputElement).checked).toBe(true);
    expect(s.getByRole("button", { name: "Remove exclusion for alpha" })).toBeTruthy();
    expect(container.innerHTML).not.toContain("SECRET_CONTENT_NEVER_RENDER");
  });

  it("marks a missing sync API as unavailable instead of suggesting a relay is running", async () => {
    openAt("#/settings", {});
    const s = await section();
    expect((await s.findByRole("alert")).textContent).toContain("unavailable from Phoenix Core");
    expect(s.queryByRole("button", { name: "Sync now" })).toBeNull();
  });
});
