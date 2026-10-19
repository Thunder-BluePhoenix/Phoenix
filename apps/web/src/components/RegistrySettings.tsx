// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useState } from "react";
import { useClient } from "../core/context";
import { formatNumber } from "../core/format";
import { useT } from "../i18n";
import { translate } from "../i18n/store";

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
  const t = useT();
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
          setBrowseError(
            error instanceof Error ? error.message : translate("automation.registry.unavailable"),
          );
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
            setPreviewError(
              error instanceof Error ? error.message : translate("automation.registry.unavailable"),
            );
        },
      );
    return () => {
      current = false;
    };
  }, [client, selected]);

  return (
    <section aria-labelledby="registry-h" className="card">
      <h2 id="registry-h" className="h3">
        {t("automation.registry.title")}
      </h2>
      <p className="small">{t("automation.registry.intro")}</p>
      <p className="muted small" role="status">
        {t("automation.registry.noInstall")}
      </p>
      {browseError && (
        <p className="error-text small" role="alert">
          {t("automation.registry.loadFailed", { error: browseError })}
        </p>
      )}
      {!browse && !browseError && <p className="muted small">{t("automation.registry.loading")}</p>}
      {browse && !browse.configured && (
        <p className="muted small">{t("automation.registry.notConfigured")}</p>
      )}
      {browse?.configured && (
        <div className="small">
          <p>
            {t.rich("automation.registry.indexSignature", {
              signer: <code>{browse.provenance.signer_key_id}</code>,
            })}
          </p>
          <p>
            {t.rich("automation.registry.signature", {
              signature: <code>{browse.provenance.signature}</code>,
            })}
          </p>
          <p>
            {t.rich("automation.registry.indexHash", {
              hash: <code>{browse.provenance.index_sha256}</code>,
            })}
          </p>
        </div>
      )}
      {browse?.configured && browse.entries.length === 0 && (
        <p className="muted small">{t("automation.registry.empty")}</p>
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
                {t("automation.registry.preview", { name: entry.name, version: entry.version })}
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
              {t("automation.registry.previewFailed", { error: previewError })}
            </p>
          )}
          {!preview && !previewError && (
            <p className="muted small">{t("automation.registry.previewLoading")}</p>
          )}
          {preview &&
            preview.entry.id === selected.id &&
            preview.entry.version === selected.version && (
              <div>
                <h3>
                  {preview.entry.manifest.name} {preview.entry.version}
                </h3>
                <p>{preview.entry.manifest.description}</p>
                <h4>{t("automation.registry.permissions")}</h4>
                {preview.entry.permissions.length ? (
                  <ul>
                    {preview.entry.permissions.map((permission) => (
                      <li key={permission}>
                        {permission}:{" "}
                        {preview.permission_descriptions[permission] ??
                          t("automation.registry.noDescription")}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("automation.registry.noneDeclared")}</p>
                )}
                <h4>{t("automation.registry.dataCategories")}</h4>
                {preview.data_categories.length ? (
                  <ul>
                    {preview.data_categories.map((category) => (
                      <li key={category}>{category}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("automation.registry.noneDeclared")}</p>
                )}
                <h4>{t("automation.registry.licence")}</h4>
                <p>
                  {t("automation.registry.licenceLine", {
                    licence: preview.entry.license,
                    policy: preview.license_policy,
                  })}
                </p>
                <h4>{t("automation.registry.security")}</h4>
                <dl>
                  <dt>{t("automation.registry.securityContact")}</dt>
                  <dd>{preview.entry.security.contact}</dd>
                  <dt>{t("automation.registry.advisories")}</dt>
                  <dd>{preview.entry.security.advisory_url}</dd>
                </dl>
                <h4>{t("automation.registry.provenance")}</h4>
                <p>
                  {t.rich("automation.registry.indexSignature", {
                    signer: <code>{preview.provenance.signer_key_id}</code>,
                  })}
                </p>
                <p>
                  {t.rich("automation.registry.signature", {
                    signature: <code>{preview.provenance.signature}</code>,
                  })}
                </p>
                <p>
                  {t.rich("automation.registry.indexHash", {
                    hash: <code>{preview.provenance.index_sha256}</code>,
                  })}
                </p>
                <p>
                  {t.rich("automation.registry.artifact", {
                    hash: <code>{preview.entry.artifact.sha256}</code>,
                    bytes: preview.entry.artifact.size,
                  })}
                </p>
                <p className="muted small">{t("automation.registry.sandbox")}</p>
              </div>
            )}
        </div>
      )}
    </section>
  );
}
