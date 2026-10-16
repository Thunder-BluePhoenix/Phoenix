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
import { Feedback } from "./Feedback";

const LOCALITY_TEXT: Record<AiLocality, string> = {
  local: "On this device",
  cloud: "Cloud (leaves this device)",
};

const MAX_ENDPOINTS = 8;
const MAX_KEY_CHARS = 8192;
const ENDPOINT_ID = /^[a-z][a-z0-9-]{1,23}$/;
const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

const PRESETS: AiPreset[] = ["openai", "deepseek", "qwen", "moonshot", "lmstudio"];

const ROUTE_LABEL: Record<AiRouteCategory, string> = {
  chat: "Chat",
  summaries: "Summaries",
  cleanup: "Cleanup",
};
const ROUTE_HELP: Record<AiRouteCategory, string> = {
  chat: "Answers to your questions in the chat and in Ask Fawkes.",
  summaries: "Meeting summaries, plans, extraction and CI diagnosis.",
  cleanup: "Tidying dictated text.",
};

interface BaseUrlCheck {
  locality: AiLocality | null;
  problem: string | null;
}

/** Core derives the real locality from the address; this is the same rule, so the user sees it before saving. */
function checkBaseUrl(raw: string): BaseUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { locality: null, problem: "Enter a full address such as https://api.example.com/v1." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { locality: null, problem: "The address must start with https:// or http://." };
  }
  if (LOOPBACK_HOST.test(url.hostname)) return { locality: "local", problem: null };
  if (url.protocol === "http:") {
    return {
      locality: null,
      problem: "Use https; plain http is only allowed for this computer.",
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

function keyState(p: AiProviderStatus): string {
  if (p.key_policy === "none") return "No key needed";
  return p.key_set ? "Key set" : "Key missing";
}

/** The key goes to Core and into the OS keychain; this component never holds it after saving. */
function ProviderRow({
  provider,
  reload,
}: {
  provider: AiProviderStatus;
  reload: () => Promise<void>;
}) {
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
    setSaved("Key set. It is stored in your OS keychain and is never shown again.");
    await reload();
  };
  const remove = async () => {
    setSaved(null);
    if ((await run("DELETE", path)) === undefined) return;
    setValue("");
    setSaved("Key removed from your keychain.");
    await reload();
  };

  return (
    <li>
      <strong>{provider.label}</strong>{" "}
      <span className="small">{LOCALITY_TEXT[provider.locality]}</span>{" "}
      <span className="small">
        {provider.available
          ? "Available"
          : `Not available${provider.reason ? `: ${provider.reason}` : ""}`}
      </span>{" "}
      <span className="small">{keyState(provider)}</span>
      {provider.key_policy !== "none" && (
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {provider.key_set ? "Replace key" : "Set key"}
        </button>
      )}
      {open && (
        <form className="settings-form ai-key-form" onSubmit={(e) => void submit(e)}>
          <label className="field">
            {provider.label} API key
            <input
              type="password"
              autoComplete="off"
              value={value}
              maxLength={MAX_KEY_CHARS}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <p className="muted small">
            Write-only: it is stored in your OS keychain and never shown again. Only used if you
            allow external AI.
          </p>
          <div className="button-row wrap">
            <button type="submit" className="btn" disabled={busy || !value}>
              Save {provider.label} key
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>
              Remove {provider.label} key
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
  const { save, busy, error, saved, setProblem } = useSettingsSave(reload);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [preset, setPreset] = useState("");
  const check = baseUrl.trim() === "" ? null : checkBaseUrl(baseUrl);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const name = label.trim();
    const verdict = checkBaseUrl(baseUrl);
    if (status.endpoints.length >= MAX_ENDPOINTS) {
      return setProblem(`You can add at most ${MAX_ENDPOINTS} endpoints.`);
    }
    if (!ENDPOINT_ID.test(id)) {
      return setProblem(
        "The id needs 2 to 24 characters: lowercase letters, digits and hyphens, starting with a letter.",
      );
    }
    if (status.providers.some((p) => p.id === id)) {
      return setProblem("That id is already used by another provider.");
    }
    if (name.length < 1 || name.length > 40)
      return setProblem("The name needs 1 to 40 characters.");
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
      `Endpoint ${name} added.`,
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
      `Endpoint ${target.label} removed.`,
    );

  return (
    <fieldset className="ai-subsection">
      <legend className="small">Custom endpoints (OpenAI-compatible servers)</legend>
      <p className="muted small">
        Phoenix works out whether an address is on this computer or in the cloud; you cannot claim
        it. Anything that is not this computer must use https.
      </p>
      {status.endpoints.length === 0 ? (
        <p className="muted small">No custom endpoints.</p>
      ) : (
        <ul className="privacy-list ai-providers" aria-label="Custom endpoints">
          {status.endpoints.map((ep) => (
            <li key={ep.id}>
              <strong>{ep.label}</strong> <span className="small">{ep.base_url}</span>{" "}
              <span className="small">{LOCALITY_TEXT[ep.locality]}</span>
              <button type="button" className="btn" disabled={busy} onClick={() => void remove(ep)}>
                Remove endpoint {ep.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {status.endpoints.length < MAX_ENDPOINTS && (
        <form className="settings-form" onSubmit={(e) => void add(e)}>
          <label className="field">
            Id
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
            Name
            <input
              type="text"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="field">
            Base URL
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
              This address is{" "}
              {check.locality === "local" ? "on this device" : "in the cloud (leaves this device)"}.
            </p>
          )}
          {check?.problem && <p className="error-text small">{check.problem}</p>}
          <label className="field">
            Preset (optional)
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">None</option>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn" disabled={busy}>
            Add endpoint
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
  const route = status.routing[category];
  const { save, busy, error, saved } = useSettingsSave(reload);
  const [provider, setProvider] = useState(route?.provider ?? "");
  const [model, setModel] = useState(route?.model ?? "");
  const name = ROUTE_LABEL[category];
  const chosen = status.providers.find((p) => p.id === provider);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = model.trim();
    const next =
      provider === "" ? null : trimmed === "" ? { provider } : { provider, model: trimmed };
    void save({ routing: { [category]: next } }, `${name} route saved.`);
  };

  return (
    <form className="settings-form ai-route" onSubmit={submit}>
      <p className="small">
        <strong>{name}</strong>: {ROUTE_HELP[category]}
      </p>
      <label className="field">
        {name} provider
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel("");
          }}
        >
          <option value="">Automatic (on this device first)</option>
          {status.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.locality === "local" ? "on this device" : "cloud"})
            </option>
          ))}
        </select>
      </label>
      {provider !== "" && (
        <label className="field">
          {name} model (optional)
          <input
            type="text"
            value={model}
            autoComplete="off"
            spellCheck={false}
            placeholder={chosen?.default_model ?? "default model"}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
      )}
      <button type="submit" className="btn" disabled={busy}>
        Save {name.toLowerCase()} route
      </button>
      <Feedback error={error} saved={saved} />
    </form>
  );
}

function Routing({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
  return (
    <fieldset className="ai-subsection">
      <legend className="small">Which model does what</legend>
      <p className="muted small">
        A cloud route still needs the permission to send data to external AI and the opt-in for the
        type of memory, both below. Without them nothing is sent, and the reason is shown instead.
      </p>
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

function parsePrices(rows: PriceRow[]): Record<string, AiPrice> | string {
  const out: Record<string, AiPrice> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "" && row.input.trim() === "" && row.output.trim() === "") continue;
    const colon = key.indexOf(":");
    if (colon < 1 || colon === key.length - 1) {
      return `Use the form provider:model for the model key, for example "openai:gpt-4o".`;
    }
    if (key in out) return `The model key ${key} appears twice.`;
    const input = row.input.trim() === "" ? Number.NaN : Number(row.input);
    const output = row.output.trim() === "" ? Number.NaN : Number(row.output);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
      return `Prices for ${key} must be numbers that are zero or more.`;
    }
    out[key] = { input_per_mtok: input, output_per_mtok: output };
  }
  return out;
}

function Prices({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
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
    const parsed = parsePrices(rows);
    if (typeof parsed === "string") return setProblem(parsed);
    void save({ prices: parsed }, "Prices saved.");
  };

  return (
    <fieldset className="ai-subsection">
      <legend className="small">Prices (optional)</legend>
      <p className="muted small">
        Phoenix has no built-in prices. Costs are shown only from the numbers you enter.
      </p>
      <form className="settings-form" onSubmit={submit}>
        {rows.map((row, i) => (
          // Rows have no stable identity before they are saved, so the index is the key.
          <div key={i} className="memory-row">
            <label className="field">
              Model key, row {i + 1}
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
              Input $ per 1M tokens, row {i + 1}
              <input
                type="text"
                inputMode="decimal"
                value={row.input}
                onChange={(e) => edit(i, { input: e.target.value })}
              />
            </label>
            <label className="field">
              Output $ per 1M tokens, row {i + 1}
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
              Remove price row {i + 1}
            </button>
          </div>
        ))}
        <div className="button-row wrap">
          <button
            type="button"
            className="btn"
            onClick={() => setRows([...rows, { key: "", input: "", output: "" }])}
          >
            Add price
          </button>
          <button type="submit" className="btn" disabled={busy}>
            Save prices
          </button>
        </div>
      </form>
      <Feedback error={error} saved={saved} />
    </fieldset>
  );
}

/** AI providers: what is available, their keys, custom endpoints, routing and optional prices. */
export function AiProviders({ status, reload }: { status: AiStatus; reload: () => Promise<void> }) {
  return (
    <div className="ai-providers-section">
      <h3 className="h3">AI providers</h3>
      {status.providers.length === 0 ? (
        <p className="muted small">No AI providers found.</p>
      ) : (
        <ul className="privacy-list ai-providers" aria-label="AI providers">
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
