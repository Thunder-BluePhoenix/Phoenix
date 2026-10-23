// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeWebSocket } from "./fake-ws";
import { expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const entry = {
  kind: "capability" as const,
  id: "sample",
  version: "1.2.3",
  name: "Sample capability",
  description: "Example metadata",
  permissions: ["network.outbound"],
  data_categories: ["calendar"],
  license: "MIT",
  installable: false,
};
const provenance = {
  signer_key_id: "testkey",
  signature: "signature-value",
  signature_status: "verified" as const,
  index_sha256: "b".repeat(64),
  artifact_verification: "not_verified" as const,
};
const browse = { configured: true, sandbox_status: "unavailable", provenance, entries: [entry] };
const preview = {
  provenance,
  entry: {
    id: entry.id,
    version: entry.version,
    manifest: { name: entry.name, description: entry.description },
    permissions: entry.permissions,
    data_categories: entry.data_categories,
    license: entry.license,
    security: {
      contact: "mailto:security@example.org",
      advisory_url: "https://example.org/advisories",
    },
    artifact: { sha256: "a".repeat(64), size: 321 },
  },
  permission_descriptions: { "network.outbound": "Makes outbound network requests" },
  data_categories: ["calendar"],
  license_policy:
    "Reviewed SPDX allowlist compatible with Phoenix GPL-3.0; redistribution still requires independent legal review.",
  sandbox_status: "unavailable",
  installable: false,
};

async function panel() {
  const heading = await screen.findByRole("heading", { name: "Capability registry" });
  return within(heading.closest("section")!);
}

describe("Capability registry settings", () => {
  it("shows no configuration and an explicit sandbox block without offering an install action", async () => {
    const { api } = openAt("#/settings", {
      "GET /api/registry": () => ({
        configured: false,
        sandbox_status: "unavailable",
        entries: [],
      }),
    });
    const s = await panel();
    expect(await s.findByText(/No local registry is configured/)).toBeTruthy();
    expect(
      s.getByText(/Installation unavailable: an audited OS sandbox is not available/),
    ).toBeTruthy();
    expect(s.queryByRole("button", { name: /install/i })).toBeNull();
    expect(api.calls.filter((call) => call.path.startsWith("/api/registry"))).toHaveLength(1);
    expect(api.posts("/api/registry/sample/1.2.3/install")).toHaveLength(0);
  });

  it("previews signed provenance, permissions, data, licence and security without installing", async () => {
    const { api } = openAt("#/settings", {
      "GET /api/registry": () => browse,
      "GET /api/registry/sample/1.2.3": () => preview,
    });
    const s = await panel();
    fireEvent.click(await s.findByRole("button", { name: "Preview Sample capability 1.2.3" }));
    expect(await s.findByRole("heading", { name: "Signed provenance" })).toBeTruthy();
    const text = s.getByRole("heading", { name: "Signed provenance" }).parentElement!.textContent!;
    expect(text).toContain("Index signature: verified with host-trusted Ed25519 signer testkey");
    expect(text).toContain("signature-value");
    expect(text).toContain("Signed index SHA-256: " + "b".repeat(64));
    expect(text).toContain("Artifact SHA-256 declared by the signed index: " + "a".repeat(64));
    expect(text).toContain(
      "Artifact verification: not verified; artifact bytes have not been fetched or checked",
    );
    expect(s.getByText(/network.outbound: Makes outbound network requests/)).toBeTruthy();
    expect(s.getByText("calendar")).toBeTruthy();
    expect(s.getByText(/MIT\. Reviewed SPDX allowlist/)).toBeTruthy();
    expect(s.getByText("mailto:security@example.org")).toBeTruthy();
    expect(s.getByText("https://example.org/advisories")).toBeTruthy();
    expect(s.getByText(/Sandbox: unavailable\. Installation is disabled/)).toBeTruthy();
    expect(s.queryByRole("button", { name: /install/i })).toBeNull();
    expect(api.posts("/api/registry/sample/1.2.3/install")).toHaveLength(0);
  });

  it("shows a data-only skin disclosure before using the dedicated install route", async () => {
    const skin = {
      kind: "skin-pack" as const,
      id: "moon-hat",
      version: "1.0.0",
      name: "Moon hat",
      description: "A data-only outfit.",
      license: "CC-BY-4.0",
      installable: true,
    };
    const { api } = openAt("#/settings", {
      "GET /api/registry": () => ({ ...browse, entries: [skin] }),
      "GET /api/registry/moon-hat/1.0.0": () => ({
        kind: "skin-pack",
        provenance,
        entry: { ...skin, artifact: { sha256: "c".repeat(64), size: 123 } },
        installable: true,
      }),
      "POST /api/registry/skins/moon-hat/1.0.0/install": () => ({}),
      "GET /api/fawkes/appearance": () => ({
        outfit: "none",
        hemisphere: "north",
        packs: [],
        sources: {},
        builtin: [],
        known: [],
        glyphs: [],
        limits: { packs: 8, pack_bytes: 200000, sources: 64 },
      }),
    });
    const s = await panel();
    fireEvent.click(await s.findByRole("button", { name: /Preview Moon hat 1.0.0/ }));
    const install = await s.findByRole("button", { name: "Install skin Moon hat 1.0.0" });
    expect(s.getByText(/Data-only Phoenix outfit pack/)).toBeTruthy();
    expect(s.getByText("CC-BY-4.0")).toBeTruthy();
    expect(s.getByText(new RegExp("c".repeat(64)))).toBeTruthy();
    expect(api.posts("/api/registry/skins/moon-hat/1.0.0/install")).toHaveLength(0);
    fireEvent.click(install);
    await waitFor(() =>
      expect(api.posts("/api/registry/skins/moon-hat/1.0.0/install")).toHaveLength(1),
    );
    expect(api.posts("/api/registry/skins/moon-hat/1.0.0/install")[0]?.body).toBeUndefined();
    expect(api.posts("/api/registry/moon-hat/1.0.0/install")).toHaveLength(0);
  });

  it("renders untrusted registry strings as inert text", async () => {
    const unsafe = { ...entry, name: XSS, description: XSS };
    const { container, api } = openAt("#/settings", {
      "GET /api/registry": () => ({
        ...browse,
        provenance: { ...provenance, signer_key_id: XSS, signature: XSS, index_sha256: XSS },
        entries: [unsafe],
      }),
      "GET /api/registry/sample/1.2.3": () => ({
        ...preview,
        entry: {
          ...preview.entry,
          manifest: { name: XSS, description: XSS },
          security: { contact: XSS, advisory_url: XSS },
        },
        permission_descriptions: { "network.outbound": XSS },
        data_categories: [XSS],
        license_policy: XSS,
        provenance: { ...provenance, signer_key_id: XSS, signature: XSS, index_sha256: XSS },
      }),
    });
    const s = await panel();
    fireEvent.click(await s.findByRole("button", { name: `Preview ${XSS} 1.2.3` }));
    await s.findByRole("heading", { name: "Signed provenance" });
    expectInert(container);
    expect(api.posts("/api/registry/sample/1.2.3/install")).toHaveLength(0);
  });

  it("reports a failed signature verification instead of displaying unverified entries", async () => {
    const { api } = openAt("#/settings", {
      "GET /api/registry": () =>
        new Response(
          JSON.stringify({
            code: "SECURITY_POLICY_BLOCKED",
            message: "Registry verification failed: INVALID_SIGNATURE",
          }),
          { status: 403 },
        ),
    });
    const s = await panel();
    expect((await s.findByRole("alert")).textContent).toContain("INVALID_SIGNATURE");
    expect(s.queryByRole("button", { name: /Preview/ })).toBeNull();
    await waitFor(() =>
      expect(api.calls.filter((call) => call.path === "/api/registry")).toHaveLength(1),
    );
  });
});
