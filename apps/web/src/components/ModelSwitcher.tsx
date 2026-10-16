// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ApiError } from "../core/client";
import { useAction, useAiStatus } from "../core/hooks";
import { useClient } from "../core/context";
import type { AiModelInfo, AiProviderStatus, AiStatus } from "../core/types";
import { Feedback } from "./Feedback";

const LOCALITY_TEXT = {
  local: "On this device",
  cloud: "Cloud (leaves this device)",
} as const;

interface ListOption {
  key: string;
  selected: boolean;
  content: ReactNode;
}

/**
 * A single-select listbox with aria-activedescendant: focus stays on the list, the arrow keys,
 * Home and End move the highlight, Enter or Space chooses.
 */
function Listbox({
  label,
  options,
  autoFocus,
  onChoose,
}: {
  label: string;
  options: ListOption[];
  autoFocus: boolean;
  onChoose: (index: number) => void;
}) {
  const baseId = useId();
  const ref = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.selected),
    ),
  );
  const current = Math.min(active, options.length - 1);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const onKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    if (e.key === "ArrowDown") setActive(Math.min(last, current + 1));
    else if (e.key === "ArrowUp") setActive(Math.max(0, current - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Enter" || e.key === " ") onChoose(current);
    else return;
    e.preventDefault();
  };

  return (
    <ul
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      className="model-listbox"
      aria-activedescendant={`${baseId}-${current}`}
      onKeyDown={onKey}
    >
      {options.map((o, i) => (
        <li
          key={o.key}
          id={`${baseId}-${i}`}
          role="option"
          aria-selected={o.selected}
          className={i === current ? "model-option model-option-active" : "model-option"}
          onClick={() => onChoose(i)}
        >
          {o.content}
        </li>
      ))}
    </ul>
  );
}

interface LoadedModels {
  providerId: string;
  models: AiModelInfo[] | null;
  error: string | null;
}

function currentLabel(status: AiStatus): string {
  const route = status.routing.chat;
  if (!route) return "Automatic (on this device first)";
  const provider = status.providers.find((p) => p.id === route.provider);
  const model = route.model ?? provider?.default_model ?? "default model";
  return `${model} · ${provider?.label ?? route.provider}`;
}

/** The chat model, shown above the message box: change the provider and the model here. */
export function ModelSwitcher() {
  const { data: status, error: statusError, reload } = useAiStatus();
  const client = useClient();
  const { run, error } = useAction();
  const [open, setOpen] = useState(false);
  const [chose, setChose] = useState(false);
  const [loaded, setLoaded] = useState<LoadedModels | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popupId = useId();

  const route = status?.routing.chat ?? null;
  const routeProvider = route?.provider ?? null;

  const close = () => {
    setOpen(false);
    setChose(false);
    button.current?.focus();
  };

  // Model lists come from the provider itself, so they are fetched only while the popup is open.
  useEffect(() => {
    if (!open || !routeProvider) return;
    let cancelled = false;
    client
      .request<AiStatus>("GET", `/api/ai/status?models=${encodeURIComponent(routeProvider)}`)
      .then((s) => {
        const p = s.providers.find((x) => x.id === routeProvider);
        if (!cancelled) {
          setLoaded({
            providerId: routeProvider,
            models: p?.models ?? null,
            error: p?.models_error ?? null,
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({
            providerId: routeProvider,
            models: null,
            error: err instanceof ApiError ? err.message : "Could not load the model list",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, routeProvider, client]);

  // Click outside closes; the focus is left where the user clicked.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) {
        setOpen(false);
        setChose(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!status) {
    if (statusError) return null;
    return (
      <div className="model-switcher">
        <button type="button" className="btn model-button" disabled>
          Model: loading…
        </button>
      </div>
    );
  }

  const save = async (chat: { provider: string; model?: string } | null) => {
    const saved = await run("POST", "/api/ai/settings", { routing: { chat } });
    if (saved === undefined) return false;
    await reload();
    return true;
  };

  const providerOptions: ListOption[] = [
    {
      key: "",
      selected: route === null,
      content: <strong>Automatic (on this device first)</strong>,
    },
    ...status.providers.map((p) => ({
      key: p.id,
      selected: route?.provider === p.id,
      content: (
        <>
          <strong>{p.label}</strong>{" "}
          <span
            className={p.locality === "cloud" ? "model-badge model-badge-cloud" : "model-badge"}
          >
            {LOCALITY_TEXT[p.locality]}
          </span>
          {p.key_policy === "required" && !p.key_set && (
            <>
              {" "}
              <span className="model-badge model-badge-warn">Key missing</span>
              <span className="muted small model-hint">
                Add the key in Settings, AI providers. You can still choose it.
              </span>
            </>
          )}
        </>
      ),
    })),
  ];

  const chooseProvider = async (index: number) => {
    if (index === 0) {
      if (route === null || (await save(null))) close();
      return;
    }
    const p = status.providers[index - 1];
    if (!p) return;
    if (route?.provider === p.id || (await save({ provider: p.id }))) setChose(true);
  };

  const provider = status.providers.find((p) => p.id === routeProvider) ?? null;
  const modelsFor = loaded?.providerId === routeProvider ? loaded : null;
  const defaultModel = provider?.default_model ?? "default model";
  const listed = (modelsFor?.models ?? []).filter((m) => m.kind !== "embed");
  const modelOptions: ListOption[] = provider
    ? [
        {
          key: "",
          selected: route?.model == null,
          content: <strong>{`Default (${defaultModel})`}</strong>,
        },
        ...listed.map((m) => ({
          key: m.id,
          selected: route?.model === m.id,
          content: <span>{m.id}</span>,
        })),
      ]
    : [];

  const chooseModel = async (index: number) => {
    if (!provider) return;
    const model = index === 0 ? null : listed[index - 1]?.id;
    if (model === undefined) return;
    if ((route?.model ?? null) === model) {
      close();
      return;
    }
    if (await save(model === null ? { provider: provider.id } : { provider: provider.id, model })) {
      close();
    }
  };

  return (
    <div
      className="model-switcher"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="model-current">
        <button
          type="button"
          ref={button}
          className="btn model-button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          onClick={() => {
            setOpen(!open);
            setChose(false);
          }}
        >
          Model: {currentLabel(status)}
        </button>
        {provider && (
          <span
            className={
              provider.locality === "cloud" ? "model-badge model-badge-cloud" : "model-badge"
            }
          >
            {LOCALITY_TEXT[provider.locality]}
          </span>
        )}
        {!status.enabled && <span className="muted small">AI is off</span>}
      </div>
      {open && (
        <div className="model-popup" id={popupId}>
          <Listbox
            label="Providers"
            options={providerOptions}
            autoFocus
            onChoose={(i) => void chooseProvider(i)}
          />
          {provider && (
            <div>
              <p className="small model-heading">Models for {provider.label}</p>
              <Listbox
                key={provider.id}
                label="Models"
                options={modelOptions}
                autoFocus={chose}
                onChoose={(i) => void chooseModel(i)}
              />
              {!modelsFor && (
                <p className="muted small" role="status">
                  Loading models…
                </p>
              )}
              {modelsFor?.error && (
                <p className="muted small">
                  Could not list models: {modelsFor.error}. Showing the default model only.
                </p>
              )}
              {modelsFor && !modelsFor.error && modelsFor.models === null && (
                <p className="muted small">This provider did not list its models.</p>
              )}
            </div>
          )}
          <p className="muted small">
            A cloud model only receives what you have allowed in Settings, AI.
          </p>
        </div>
      )}
      <Feedback error={error} />
    </div>
  );
}
