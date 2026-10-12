// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState } from "react";
import { useClient } from "../core/context";

type RegistryProvenance = {
  signer_key_id: string;
  signature: string;
  signature_status: "verified";
  index_sha256: string;
  artifact_verification: "not_verified";
};

type RegistryListing = {
  id: string;
  version: string;
  name: string;
  description: string;
};
type RegistryBrowse =
  | { configured: false; sandbox_status: "unavailable"; entries: [] }
  | {
      configured: true;
      sandbox_status: "unavailable";
      provenance: RegistryProvenance;
      entries: RegistryListing[];
    };
type RegistryPreview = {
  entry: {
    id: string;
    version: string;
    manifest: { name: string; description: string };
    permissions: string[];
    data_categories: string[];
    license: string;
    security: { contact: string; advisory_url: string };
    artifact: { sha256: string; size: number };
  };
  provenance: RegistryProvenance;
  permission_descriptions: Record<string, string>;
  data_categories: string[];
  license_policy: string;
  installable: false;
};

/** Browse verified, host-configured local metadata only; executable installation is not offered. */
export function RegistrySettingsSection() {
  const client = useClient();
  const [browse, setBrowse] = useState<RegistryBrowse | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RegistryListing | null>(null);
  const [preview, setPreview] = useState<RegistryPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    client.request<RegistryBrowse>("GET", "/api/registry").then(
      (result) => {
        if (current) setBrowse(result);
      },
      (error: unknown) => {
        if (current)
          setBrowseError(error instanceof Error ? error.message : "Registry unavailable");
      },
    );
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    if (!selected) return;
    let current = true;
    setPreview(null);
    client
      .request<RegistryPreview>(
        "GET",
        `/api/registry/${encodeURIComponent(selected.id)}/${encodeURIComponent(selected.version)}`,
      )
      .then(
        (result) => {
          if (current) setPreview(result);
        },
        (error: unknown) => {
          if (current)
            setPreviewError(error instanceof Error ? error.message : "Registry unavailable");
        },
      );
    return () => {
      current = false;
    };
  }, [client, selected]);

  return (
    <section aria-labelledby="registry-h" className="card">
      <h2 id="registry-h" className="h3">
        Capability registry
      </h2>
      <p className="small">
        Browse metadata from a locally configured, host-trusted signed index. Phoenix Core verifies
        the index signature before returning entries. Browsing does not install or run third-party
        code.
      </p>
      <p className="muted small" role="status">
        Installation unavailable: an audited OS sandbox is not available. Third-party capabilities
        cannot be installed here.
      </p>
      {browseError && (
        <p className="error-text small" role="alert">
          Registry could not be loaded: {browseError}
        </p>
      )}
      {!browse && !browseError && <p className="muted small">Loading registry…</p>}
      {browse && !browse.configured && (
        <p className="muted small">
          No local registry is configured. Ask the host administrator to configure a trusted key and
          signed index to browse capabilities.
        </p>
      )}
      {browse?.configured && (
        <div className="small">
          <p>
            Index signature: {browse.provenance.signature_status} with host-trusted Ed25519 signer{" "}
            <code>{browse.provenance.signer_key_id}</code>.
          </p>
          <p>
            Signature: <code>{browse.provenance.signature}</code>
          </p>
          <p>
            Signed index SHA-256: <code>{browse.provenance.index_sha256}</code>
          </p>
        </div>
      )}
      {browse?.configured && browse.entries.length === 0 && (
        <p className="muted small">The signed registry contains no capabilities.</p>
      )}
      {browse?.configured && browse.entries.length > 0 && (
        <ul>
          {browse.entries.map((entry) => (
            <li key={`${entry.id}@${entry.version}`}>
              <button
                type="button"
                aria-pressed={selected?.id === entry.id && selected.version === entry.version}
                onClick={() => setSelected(entry)}
              >
                Preview {entry.name} {entry.version}
              </button>
              <span> — {entry.description}</span>
            </li>
          ))}
        </ul>
      )}
      {selected && browse?.configured && (
        <div aria-live="polite">
          {previewError && (
            <p className="error-text small" role="alert">
              Preview unavailable: {previewError}
            </p>
          )}
          {!preview && !previewError && <p className="muted small">Loading verified preview…</p>}
          {preview &&
            preview.entry.id === selected.id &&
            preview.entry.version === selected.version && (
              <div>
                <h3>
                  {preview.entry.manifest.name} {preview.entry.version}
                </h3>
                <p>{preview.entry.manifest.description}</p>
                <h4>Permissions</h4>
                {preview.entry.permissions.length ? (
                  <ul>
                    {preview.entry.permissions.map((permission) => (
                      <li key={permission}>
                        {permission}:{" "}
                        {preview.permission_descriptions[permission] ?? "No description supplied"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None declared.</p>
                )}
                <h4>Data categories</h4>
                {preview.data_categories.length ? (
                  <ul>
                    {preview.data_categories.map((category) => (
                      <li key={category}>{category}</li>
                    ))}
                  </ul>
                ) : (
                  <p>None declared.</p>
                )}
                <h4>Licence</h4>
                <p>
                  {preview.entry.license}. {preview.license_policy}
                </p>
                <h4>Security</h4>
                <dl>
                  <dt>Security contact</dt>
                  <dd>{preview.entry.security.contact}</dd>
                  <dt>Advisories</dt>
                  <dd>{preview.entry.security.advisory_url}</dd>
                </dl>
                <h4>Signed provenance</h4>
                <p>
                  Index signature: {preview.provenance.signature_status} with host-trusted Ed25519
                  signer <code>{preview.provenance.signer_key_id}</code>.
                </p>
                <p>
                  Signature: <code>{preview.provenance.signature}</code>
                </p>
                <p>
                  Signed index SHA-256: <code>{preview.provenance.index_sha256}</code>
                </p>
                <p>
                  Artifact SHA-256 declared by the signed index:{" "}
                  <code>{preview.entry.artifact.sha256}</code> ({preview.entry.artifact.size}{" "}
                  bytes). Artifact verification: not verified; artifact bytes have not been fetched
                  or checked. Browsing does not execute the artifact.
                </p>
                <p className="muted small">
                  Sandbox: unavailable. Installation is disabled; no install request will be sent.
                </p>
              </div>
            )}
        </div>
      )}
    </section>
  );
}
