// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useState, type FormEvent } from "react";
import { useAction } from "../core/hooks";
import type {
  AiEndpoint,
  AiLocality,
  AiPreset,
  AiPrice,
  AiProviderStatus,
  AiRouteCategory,
  AiStatus,
} from "../core/types";
import { useT, type MessageKey, type Translate } from "../i18n";
import { Feedback } from "./Feedback";

const LOCALITY_TEXT: Record<AiLocality, MessageKey> = {
  local: "services.ai.locality.local",
  cloud: "services.ai.locality.cloud",
};

const MAX_ENDPOINTS = 8;
const MAX_KEY_CHARS = 8192;
const ENDPOINT_ID = /^[a-z][a-z0-9-]{1,23}$/;
const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

const PRESETS: AiPreset[] = ["openai", "deepseek", "qwen", "moonshot", "lmstudio"];

interface RouteText {
  name: MessageKey;
  help: MessageKey;
  provider: MessageKey;
  model: MessageKey;
  save: MessageKey;
  saved: MessageKey;
}
const ROUTE_TEXT: Record<AiRouteCategory, RouteText> = {
  chat: {
    name: "services.ai.routing.chat.name",
    help: "services.ai.routing.chat.help",
    provider: "services.ai.routing.chat.provider",
    model: "services.ai.routing.chat.model",
    save: "services.ai.routing.chat.save",
    saved: "services.ai.routing.chat.saved",
  },
  summaries: {
    name: "services.ai.routing.summaries.name",
    help: "services.ai.routing.summaries.help",
    provider: "services.ai.routing.summaries.provider",
    model: "services.ai.routing.summaries.model",
    save: "services.ai.routing.summaries.save",
    saved: "services.ai.routing.summaries.saved",
  },
  cleanup: {
    name: "services.ai.routing.cleanup.name",
    help: "services.ai.routing.cleanup.help",
    provider: "services.ai.routing.cleanup.provider",
    model: "services.ai.routing.cleanup.model",
    save: "services.ai.routing.cleanup.save",
    saved: "services.ai.routing.cleanup.saved",
  },
};

interface BaseUrlCheck {
  locality: AiLocality | null;
  problem: string | null;
}

/** Core derives the real locality from the address; this is the same rule, so the user sees it before saving. */
function checkBaseUrl(raw: string, t: Translate): BaseUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { locality: null, problem: t("services.ai.endpoints.urlInvalid") };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { locality: null, problem: t("services.ai.endpoints.urlScheme") };
  }
  if (LOOPBACK_HOST.test(url.hostname)) return { locality: "local", problem: null };
  if (url.protocol === "http:") {
    return {
      locality: null,
      problem: t("services.ai.endpoints.urlInsecure"),
    };
  }
  return { locality: "cloud", problem: null };
}

/** Saves one part of /api/ai/settings, reloads the status and reports in words. */
function useSettingsSave(reload: () => Promise<void>) {
  const { run, busy, error } = useAction();
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (body: unknown, message: string) => {
    setSaved(null);
    setProblem(null);
    if ((await run("POST", "/api/ai/settings", body)) === undefined) return false;
    await reload();
    setSaved(message);
    return true;
  };
  return { save, busy, error: problem ?? error, saved, setSaved, setProblem };
}

function keyState(p: AiProviderStatus, t: Translate): string {
  if (p.key_policy === "none") return t("services.ai.provider.keyNotNeeded");
  return p.key_set ? t("services.ai.provider.keySet") : t("services.ai.provider.keyMissing");
}

/** The key goes to Core and into the OS keychain; this component never holds it after saving. */
function ProviderRow({
  provider,
  reload,
}: {
  provider: AiProviderStatus;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const { run, busy, error } = useAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const path = `/api/ai/providers/${encodeURIComponent(provider.id)}/secret`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    if ((await run("POST", path, { value })) === undefined) return;
    setValue("");
    setSaved(t("services.ai.provider.keySaved"));
    await reload();
  };
  const remove = async () => {
    setSaved(null);
    if ((await run("DELETE", path)) === undefined) return;
    setValue("");
    setSaved(t("services.ai.provider.keyRemoved"));
    await reload();
  };

  return (
    <li>
      <strong>{provider.label}</strong>{" "}
      <span className="small">{t(LOCALITY_TEXT[provider.locality])}</span>{" "}
      <span className="small">
        {provider.available
          ? t("services.ai.provider.available")
          : provider.reason
            ? t("services.ai.provider.unavailableReason", { reason: provider.reason })
            : t("services.ai.provider.unavailable")}
      </span>{" "}
      <span className="small">{keyState(provider, t)}</span>
      {provider.key_policy !== "none" && (
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {provider.key_set
            ? t("services.ai.provider.replaceKey")
            : t("services.ai.provider.setKey")}
        </button>
      )}
      {open && (
        <form className="settings-form ai-key-form" onSubmit={(e) => void submit(e)}>
          <label className="field">
            {t("services.ai.provider.apiKey", { provider: provider.label })}
            <input
              type="password"
              autoComplete="off"
              value={value}
              maxLength={MAX_KEY_CHARS}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <p className="muted small">{t("services.ai.provider.keyNote")}</p>
          <div className="button-row wrap">
            <button type="submit" className="btn" disabled={busy || !value}>
              {t("services.ai.provider.saveKey", { provider: provider.label })}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
              {t("services.ai.provider.removeKey", { provider: provider.label })}
            </button>
          </div>
        </form>
      )}
      <Feedback error={error} saved={saved} />
    </li>
  );
}

function endpointBody(e: AiEndpoint) {
  return e.preset
    ? { id: e.id, label: e.label, base_url: e.base_url, preset: e.preset }
    : { id: e.id, label: e.label, base_url: e.base_url };
}

function Endpoints({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
  const t = useT();
  const { save, busy, error, saved, setProblem } = useSettingsSave(reload);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [preset, setPreset] = useState("");
  const check = baseUrl.trim() === "" ? null : checkBaseUrl(baseUrl, t);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const name = label.trim();
    const verdict = checkBaseUrl(baseUrl, t);
    if (status.endpoints.length >= MAX_ENDPOINTS) {
      return setProblem(t("services.ai.endpoints.tooMany", { max: MAX_ENDPOINTS }));
    }
    if (!ENDPOINT_ID.test(id)) {
      return setProblem(t("services.ai.endpoints.badId"));
    }
    if (status.providers.some((p) => p.id === id)) {
      return setProblem(t("services.ai.endpoints.idTaken"));
    }
    if (name.length < 1 || name.length > 40) return setProblem(t("services.ai.endpoints.badName"));
    if (verdict.problem) return setProblem(verdict.problem);
    const entry: AiEndpoint = {
      id,
      label: name,
      base_url: baseUrl.trim(),
      preset: preset === "" ? null : (preset as AiPreset),
      locality: verdict.locality ?? "cloud",
    };
    const ok = await save(
      { endpoints: [...status.endpoints, entry].map(endpointBody) },
      t("services.ai.endpoints.added", { name }),
    );
    if (ok) {
      setId("");
      setLabel("");
      setBaseUrl("");
      setPreset("");
    }
  };
  const remove = (target: AiEndpoint) =>
    save(
      { endpoints: status.endpoints.filter((x) => x.id !== target.id).map(endpointBody) },
      t("services.ai.endpoints.removed", { name: target.label }),
    );

  return (
    <fieldset className="ai-subsection">
      <legend className="small">{t("services.ai.endpoints.legend")}</legend>
      <p className="muted small">{t("services.ai.endpoints.note")}</p>
      {status.endpoints.length === 0 ? (
        <p className="muted small">{t("services.ai.endpoints.empty")}</p>
      ) : (
        <ul className="privacy-list ai-providers" aria-label={t("services.ai.endpoints.list")}>
          {status.endpoints.map((ep) => (
            <li key={ep.id}>
              <strong>{ep.label}</strong> <span className="small">{ep.base_url}</span>{" "}
              <span className="small">{t(LOCALITY_TEXT[ep.locality])}</span>
              <button type="button" className="btn" disabled={busy} onClick={() => void remove(ep)}>
                {t("services.ai.endpoints.remove", { label: ep.label })}
              </button>
            </li>
          ))}
        </ul>
      )}
      {status.endpoints.length < MAX_ENDPOINTS && (
        <form className="settings-form" onSubmit={(e) => void add(e)}>
          <label className="field">
            {t("services.ai.endpoints.id")}
            <input
              type="text"
              value={id}
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setId(e.target.value)}
            />
          </label>
          <label className="field">
            {t("common.label.name")}
            <input
              type="text"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="field">
            {t("services.ai.endpoints.baseUrl")}
            <input
              type="text"
              value={baseUrl}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          {check?.locality && (
            <p className="muted small">
              {check.locality === "local"
                ? t("services.ai.endpoints.addressLocal")
                : t("services.ai.endpoints.addressCloud")}
            </p>
          )}
          {check?.problem && <p className="error-text small">{check.problem}</p>}
          <label className="field">
            {t("services.ai.endpoints.preset")}
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">{t("common.status.none")}</option>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn" disabled={busy}>
            {t("services.ai.endpoints.add")}
          </button>
        </form>
      )}
      <Feedback error={error} saved={saved} />
    </fieldset>
  );
}

function RouteRow({
  category,
  status,
  reload,
}: {
  category: AiRouteCategory;
  status: AiStatus;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const route = status.routing[category];
  const { save, busy, error, saved } = useSettingsSave(reload);
  const [provider, setProvider] = useState(route?.provider ?? "");
  const [model, setModel] = useState(route?.model ?? "");
  const text = ROUTE_TEXT[category];
  const chosen = status.providers.find((p) => p.id === provider);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = model.trim();
    const next =
      provider === "" ? null : trimmed === "" ? { provider } : { provider, model: trimmed };
    void save({ routing: { [category]: next } }, t(text.saved));
  };

  return (
    <form className="settings-form ai-route" onSubmit={submit}>
      <p className="small">
        <strong>{t(text.name)}</strong>: {t(text.help)}
      </p>
      <label className="field">
        {t(text.provider)}
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel("");
          }}
        >
          <option value="">{t("services.ai.automatic")}</option>
          {status.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {t(
                p.locality === "local"
                  ? "services.ai.routing.providerLocal"
                  : "services.ai.routing.providerCloud",
                { label: p.label },
              )}
            </option>
          ))}
        </select>
      </label>
      {provider !== "" && (
        <label className="field">
          {t(text.model)}
          <input
            type="text"
            value={model}
            autoComplete="off"
            spellCheck={false}
            placeholder={chosen?.default_model ?? t("services.ai.defaultModel")}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
      )}
      <button type="submit" className="btn" disabled={busy}>
        {t(text.save)}
      </button>
      <Feedback error={error} saved={saved} />
    </form>
  );
}

function Routing({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
  const t = useT();
  return (
    <fieldset className="ai-subsection">
      <legend className="small">{t("services.ai.routing.legend")}</legend>
      <p className="muted small">{t("services.ai.routing.note")}</p>
      {(["chat", "summaries", "cleanup"] as const).map((category) => (
        <RouteRow key={category} category={category} status={status} reload={reload} />
      ))}
    </fieldset>
  );
}

interface PriceRow {
  key: string;
  input: string;
  output: string;
}

function parsePrices(rows: PriceRow[], t: Translate): Record<string, AiPrice> | string {
  const out: Record<string, AiPrice> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "" && row.input.trim() === "" && row.output.trim() === "") continue;
    const colon = key.indexOf(":");
    if (colon < 1 || colon === key.length - 1) {
      return t("services.ai.prices.badKey");
    }
    if (key in out) return t("services.ai.prices.duplicateKey", { key });
    const input = row.input.trim() === "" ? Number.NaN : Number(row.input);
    const output = row.output.trim() === "" ? Number.NaN : Number(row.output);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
      return t("services.ai.prices.badNumber", { key });
    }
    out[key] = { input_per_mtok: input, output_per_mtok: output };
  }
  return out;
}

function Prices({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
  const t = useT();
  const { save, busy, error, saved, setProblem } = useSettingsSave(reload);
  const [rows, setRows] = useState<PriceRow[]>(() =>
    Object.entries(status.prices).map(([key, p]) => ({
      key,
      input: String(p.input_per_mtok),
      output: String(p.output_per_mtok),
    })),
  );
  const edit = (index: number, patch: Partial<PriceRow>) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parsePrices(rows, t);
    if (typeof parsed === "string") return setProblem(parsed);
    void save({ prices: parsed }, t("services.ai.prices.saved"));
  };

  return (
    <fieldset className="ai-subsection">
      <legend className="small">{t("services.ai.prices.legend")}</legend>
      <p className="muted small">{t("services.ai.prices.note")}</p>
      <form className="settings-form" onSubmit={submit}>
        {rows.map((row, i) => (
          // Rows have no stable identity before they are saved, so the index is the key.
          <div key={i} className="memory-row">
            <label className="field">
              {t("services.ai.prices.modelKey", { n: i + 1 })}
              <input
                type="text"
                value={row.key}
                placeholder="provider:model"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => edit(i, { key: e.target.value })}
              />
            </label>
            <label className="field">
              {t("services.ai.prices.input", { n: i + 1 })}
              <input
                type="text"
                inputMode="decimal"
                value={row.input}
                onChange={(e) => edit(i, { input: e.target.value })}
              />
            </label>
            <label className="field">
              {t("services.ai.prices.output", { n: i + 1 })}
              <input
                type="text"
                inputMode="decimal"
                value={row.output}
                onChange={(e) => edit(i, { output: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              {t("services.ai.prices.removeRow", { n: i + 1 })}
            </button>
          </div>
        ))}
        <div className="button-row wrap">
          <button
            type="button"
            className="btn"
            onClick={() => setRows([...rows, { key: "", input: "", output: "" }])}
          >
            {t("services.ai.prices.add")}
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {t("services.ai.prices.save")}
          </button>
        </div>
      </form>
      <Feedback error={error} saved={saved} />
    </fieldset>
  );
}

/** AI providers: what is available, their keys, custom endpoints, routing and optional prices. */
export function AiProviders({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
  const t = useT();
  return (
    <div className="ai-providers-section">
      <h3 className="h3">{t("services.ai.title")}</h3>
      {status.providers.length === 0 ? (
        <p className="muted small">{t("services.ai.empty")}</p>
      ) : (
        <ul className="privacy-list ai-providers" aria-label={t("services.ai.title")}>
          {status.providers.map((p) => (
            <ProviderRow key={p.id} provider={p} reload={reload} />
          ))}
        </ul>
      )}
      <Endpoints status={status} reload={reload} />
      <Routing status={status} reload={reload} />
      <Prices status={status} reload={reload} />
    </div>
  );
}
