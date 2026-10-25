// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useId, useReducer, useRef, useState, type FormEvent } from "react";
import { Shields, type ShieldsSettings } from "../core/browser/shields";
import { hostOf } from "../core/browser/site";
import { useClient } from "../core/context";
import { SHIELDS_PATH } from "../core/filter-lists";
import { PROFILES_PATH, PURGES_PATH } from "../core/browser-profiles";
import { useT, type MessageKey } from "../i18n";
import { classifyAddress, classifyPortRadarUrl, type SearchProvider } from "./address";
import {
  BROWSER_CHROME_HEIGHT,
  BROWSER_CHROME_PANEL_HEIGHT,
  type BrowserShell,
  type OpenResult,
  type TabInfo,
} from "./shell";
import { useBrowserRelay } from "./relay";
import { INITIAL_STATE, activeTab, addressText, clampZoom, reduce } from "./state";

/** Zoom steps the buttons walk through. The shell clamps anything else. */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export function nextZoom(current: number, direction: 1 | -1): number {
  const at = clampZoom(current);
  if (direction === 1) return ZOOM_STEPS.find((s) => s > at + 0.001) ?? at;
  return [...ZOOM_STEPS].reverse().find((s) => s < at - 0.001) ?? at;
}

const DENIAL_TEXT: Readonly<Record<string, MessageKey>> = {
  profile_invalid: "browser.deny.profile_invalid",
  profile_unsupported: "browser.deny.profile_unsupported",
  profile_busy: "browser.deny.profile_busy",
  profile_failed: "browser.deny.profile_failed",
  unparseable: "browser.deny.unparseable",
  scheme_not_allowed: "browser.deny.scheme_not_allowed",
  dangerous_scheme: "browser.deny.dangerous_scheme",
  file_blocked: "browser.deny.file_blocked",
  credentials_in_url: "browser.deny.credentials_in_url",
  private_network: "browser.deny.private_network",
  bad_port: "browser.deny.bad_port",
  insecure_blocked: "browser.deny.insecure_blocked",
  site_denied: "browser.deny.site_denied",
  dns_private: "browser.deny.dns_private",
  port_radar_invalid: "browser.deny.port_radar_invalid",
  action_failed: "browser.error.action",
};

export interface BrowserAppProps {
  /** The desktop shell; null in an ordinary browser tab (the chrome then cannot open anything). */
  shell: BrowserShell | null;
  /** A loopback address to confirm at start (the `?open=` query of the page). */
  initialOpen?: string | null;
  provider?: SearchProvider;
  /**
   * Starts the periodic check for removed profiles whose web data must be deleted; returns a stop
   * function. Defaults to `setInterval`; tests pass a manual one.
   */
  schedule?: (run: () => void, ms: number) => () => void;
}

/** How often the chrome asks Core whether a removed profile's web data is waiting to be deleted. */
export const PURGE_INTERVAL_MS = 5000;

const PRIVATE = "private";

const everyInterval = (run: () => void, ms: number) => {
  const timer = setInterval(run, ms);
  return () => clearInterval(timer);
};

type PurgeStatus = "idle" | "running" | "failed";

/**
 * Phase 93: the chrome of the Phoenix browser. It draws tabs, the address bar, the navigation and
 * zoom buttons and the per-site shields switch. It never draws a page: pages live in separate
 * content webviews owned by the shell, and everything this component shows about one (title,
 * address) is rendered as text.
 */
export function BrowserApp({
  shell,
  initialOpen = null,
  provider,
  schedule = everyInterval,
}: BrowserAppProps) {
  const t = useT();
  const client = useClient();
  // Phase 95: serves the browsing assistant's requests for the ACTIVE tab (chrome page only).
  useBrowserRelay(client, shell);
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE);
  const [shields, setShields] = useState(() => new Shields());
  const [, bump] = useState(0);
  const [shieldNote, setShieldNote] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [profileChoice, setProfileChoice] = useState(PRIVATE);
  const [purgeStatus, setPurgeStatus] = useState<PurgeStatus>("idle");
  const addressId = useId();
  const panelId = useId();
  const stateRef = useRef(state);
  stateRef.current = state;

  const tab = activeTab(state);

  // Shields choices are Core's (the Settings card writes the same ones); the chrome only reads them.
  useEffect(() => {
    let alive = true;
    client
      .request<{ shields: ShieldsSettings }>("GET", SHIELDS_PATH)
      .then((r) => alive && setShields(new Shields({ settings: r.shields })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);

  // The profiles Core knows, for the new-tab picker. If Core cannot answer, only private remains.
  // The picker is a convenience, not a boundary: the shell validates the id again.
  const loadProfiles = useCallback(async () => {
    try {
      const answer = await client.request<{ profiles?: unknown }>("GET", PROFILES_PATH);
      const list = Array.isArray(answer.profiles) ? answer.profiles : [];
      return list.flatMap((p: unknown) => {
        const id = Reflect.get(Object(p), "id");
        const name = Reflect.get(Object(p), "name");
        return typeof id === "string" && id !== PRIVATE && typeof name === "string"
          ? [{ id, name }]
          : [];
      });
    } catch {
      return [];
    }
  }, [client]);

  useEffect(() => {
    let alive = true;
    void loadProfiles().then((list) => alive && setProfiles(list));
    return () => {
      alive = false;
    };
  }, [loadProfiles]);

  // Removed profiles: Core queues the id, this window (the only one that may ask the shell) deletes
  // the web data and acknowledges. `running` keeps two loops from overlapping; a failure leaves the
  // id pending and the next tick tries again.
  useEffect(() => {
    if (!shell) return;
    let alive = true;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        let pending: unknown;
        try {
          pending = (await client.request<{ pending?: unknown }>("GET", PURGES_PATH)).pending;
        } catch {
          return;
        }
        const ids = Array.isArray(pending)
          ? pending.filter((id): id is string => typeof id === "string")
          : [];
        let failed = false;
        for (const id of ids) {
          if (!alive) return;
          setPurgeStatus("running");
          try {
            await shell.purgeProfileData(id);
            await client.request("POST", `${PURGES_PATH}/${encodeURIComponent(id)}/done`);
            if (alive) setProfileChoice((now) => (now === id ? PRIVATE : now));
          } catch {
            failed = true;
          }
        }
        if (alive) {
          setPurgeStatus(failed ? "failed" : "idle");
          if (ids.length > 0) setProfiles(await loadProfiles());
        }
      } finally {
        running = false;
      }
    };
    void tick();
    const stop = schedule(() => void tick(), PURGE_INTERVAL_MS);
    return () => {
      alive = false;
      stop();
    };
  }, [client, shell, schedule, loadProfiles]);

  const fail = useCallback((text: string) => {
    dispatch({ type: "refused", error: { reason: "action_failed", text } });
  }, []);

  const requestOpen = useCallback(
    (raw: string) => {
      const verdict = classifyPortRadarUrl(raw);
      if (!verdict.ok) {
        dispatch({
          type: "refused",
          error: { reason: "port_radar_invalid", text: raw.slice(0, 200) },
        });
        return;
      }
      dispatch({ type: "requestOpen", pending: { url: verdict.url, port: verdict.port } });
      void shell?.setChromeHeight(BROWSER_CHROME_PANEL_HEIGHT).catch(() => {});
    },
    [shell],
  );

  useEffect(() => {
    if (!shell) return;
    let alive = true;
    const undo: (() => void)[] = [];
    const keep = (p: Promise<() => void>) =>
      void p.then((off) => (alive ? undo.push(off) : off())).catch(() => {});
    keep(shell.onTab((next) => dispatch({ type: "tab", tab: next })));
    keep(shell.onTabClosed((tabId) => dispatch({ type: "tabClosed", tabId })));
    keep(shell.onOpenRequest((request) => requestOpen(request.url)));
    return () => {
      alive = false;
      undo.forEach((off) => off());
    };
  }, [shell, requestOpen]);

  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    if (initialOpen) requestOpen(initialOpen);
  }, [initialOpen, requestOpen]);

  const settle = (result: OpenResult, text: string) => {
    if (result.ok) dispatch({ type: "tab", tab: result.tab, activate: true });
    else dispatch({ type: "refused", error: { reason: result.reason, text } });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!shell) return;
    const verdict = classifyAddress(addressText(state), provider);
    if (verdict.kind === "empty") return;
    if (verdict.kind === "blocked") {
      dispatch({ type: "refused", error: { reason: verdict.reason, text: verdict.text } });
      return;
    }
    const typed = addressText(state).trim();
    try {
      const target = stateRef.current.newTab ? null : activeTab(stateRef.current);
      settle(
        target
          ? await shell.navigate(target.tabId, verdict.url)
          : await shell.openTab(
              verdict.url,
              "typed",
              profiles.some((p) => p.id === profileChoice) ? profileChoice : undefined,
            ),
        typed,
      );
    } catch {
      fail(typed);
    }
  };

  const run = async (action: () => Promise<TabInfo>) => {
    try {
      dispatch({ type: "tab", tab: await action() });
    } catch {
      fail("");
    }
  };

  const select = (tabId: string) => {
    dispatch({ type: "activate", tabId });
    void shell?.activateTab(tabId).catch(() => fail(""));
  };

  const close = (tabId: string) => {
    void shell
      ?.closeTab(tabId)
      .then(() => dispatch({ type: "tabClosed", tabId }))
      .catch(() => fail(""));
  };

  const zoomTo = async (factor: number) => {
    if (!shell || !tab) return;
    try {
      const applied = await shell.zoom(tab.tabId, clampZoom(factor));
      dispatch({ type: "tab", tab: { ...tab, zoom: applied } });
    } catch {
      fail("");
    }
  };

  const confirmOpen = async () => {
    const pending = state.pending;
    if (!shell || !pending) return;
    dispatch({ type: "endOpen" });
    void shell.setChromeHeight(BROWSER_CHROME_HEIGHT).catch(() => {});
    try {
      settle(await shell.openTab(pending.url, "port_radar"), pending.url);
    } catch {
      fail(pending.url);
    }
  };

  const cancelOpen = () => {
    dispatch({ type: "endOpen" });
    void shell?.setChromeHeight(BROWSER_CHROME_HEIGHT).catch(() => {});
  };

  const site = tab ? shields.siteOf(tab.url) : null;
  const exemption = site === null ? null : shields.exemption(site);
  const toggleSite = async (blocking: boolean) => {
    if (!shell || site === null) return;
    setShieldNote(null);
    shields.setSiteBlocking(site, blocking);
    bump((n) => n + 1);
    try {
      await shell.setSiteShields(site, blocking);
    } catch {
      shields.setSiteBlocking(site, !blocking);
      bump((n) => n + 1);
      fail(site);
      return;
    }
    try {
      await client.request("PUT", `${SHIELDS_PATH}/sites/${encodeURIComponent(site)}`, {
        blocking,
      });
    } catch {
      setShieldNote(t("browser.shields.saveFailed"));
    }
  };

  const title = (info: TabInfo) => info.title || hostOf(info.url) || t("browser.tab.untitled");

  return (
    <div className="browser-chrome">
      <div className="browser-tabs" role="tablist" aria-label={t("browser.tabs.label")}>
        {state.tabs.map((info) => (
          <div key={info.tabId} className="browser-tab" data-active={info.tabId === state.activeId}>
            <button
              type="button"
              role="tab"
              aria-selected={info.tabId === state.activeId}
              className="browser-tab-title"
              onClick={() => select(info.tabId)}
              title={title(info)}
            >
              {info.loading && (
                <span className="browser-spinner" aria-label={t("browser.tab.loading")} />
              )}
              <span className="browser-tab-text">{title(info)}</span>
              {info.profileId !== null && (
                <span className="browser-tab-profile">
                  {t("browser.tab.profile", {
                    name: profiles.find((p) => p.id === info.profileId)?.name ?? info.profileId,
                  })}
                </span>
              )}
            </button>
            <button
              type="button"
              className="browser-tab-close"
              aria-label={t("browser.tab.close", { title: title(info) })}
              onClick={() => close(info.tabId)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="browser-new-tab"
          aria-label={t("browser.tab.new")}
          disabled={!shell}
          onClick={() => dispatch({ type: "newTab" })}
        >
          +
        </button>
      </div>

      <form className="browser-toolbar" onSubmit={(e) => void submit(e)}>
        <button
          type="button"
          className="browser-button"
          aria-label={t("browser.nav.back")}
          disabled={!tab?.canGoBack}
          onClick={() => tab && void run(() => shell!.back(tab.tabId))}
        >
          ←
        </button>
        <button
          type="button"
          className="browser-button"
          aria-label={t("browser.nav.forward")}
          disabled={!tab?.canGoForward}
          onClick={() => tab && void run(() => shell!.forward(tab.tabId))}
        >
          →
        </button>
        <button
          type="button"
          className="browser-button"
          aria-label={t("browser.nav.reload")}
          disabled={!tab}
          onClick={() => tab && void run(() => shell!.reload(tab.tabId))}
        >
          ↻
        </button>
        <label htmlFor={addressId} className="browser-visually-hidden">
          {t("browser.address.label")}
        </label>
        <input
          id={addressId}
          className="browser-address"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={t("browser.address.placeholder")}
          value={addressText(state)}
          disabled={!shell}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => dispatch({ type: "edit", text: e.target.value })}
        />
        <button type="submit" className="browser-button" disabled={!shell}>
          {t("browser.address.go")}
        </button>
        <div className="browser-zoom" role="group" aria-label={t("browser.zoom.label")}>
          <button
            type="button"
            className="browser-button"
            aria-label={t("browser.zoom.out")}
            disabled={!tab || nextZoom(tab.zoom, -1) === clampZoom(tab.zoom)}
            onClick={() => tab && void zoomTo(nextZoom(tab.zoom, -1))}
          >
            −
          </button>
          <button
            type="button"
            className="browser-button browser-zoom-level"
            aria-label={t("browser.zoom.reset", { percent: "100%" })}
            disabled={!tab}
            onClick={() => void zoomTo(1)}
          >
            {Math.round((tab?.zoom ?? 1) * 100)}%
          </button>
          <button
            type="button"
            className="browser-button"
            aria-label={t("browser.zoom.in")}
            disabled={!tab || nextZoom(tab.zoom, 1) === clampZoom(tab.zoom)}
            onClick={() => tab && void zoomTo(nextZoom(tab.zoom, 1))}
          >
            +
          </button>
        </div>
      </form>

      <div className="browser-status">
        <label className="browser-profile-picker">
          {t("browser.profile.label")}{" "}
          <select
            value={profiles.some((p) => p.id === profileChoice) ? profileChoice : PRIVATE}
            disabled={!shell}
            onChange={(e) => setProfileChoice(e.target.value)}
          >
            <option value={PRIVATE}>{t("browser.profile.private")}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {purgeStatus !== "idle" && (
          <span className="browser-purge" role="status">
            {t(purgeStatus === "running" ? "browser.purge.running" : "browser.purge.failed")}
          </span>
        )}
        {tab && site !== null && (
          <label className="browser-shields">
            <input
              type="checkbox"
              checked={exemption === null}
              disabled={exemption === "shields_off"}
              onChange={(e) => void toggleSite(e.target.checked)}
            />{" "}
            {t("browser.shields.label", { site })}
          </label>
        )}
        {tab && (
          <span className="browser-blocked" role="status">
            {t("browser.shields.blocked", { count: tab.blocked })}
          </span>
        )}
        {state.error && (
          <p className="browser-error" role="alert">
            <span>
              {t(
                Object.hasOwn(DENIAL_TEXT, state.error.reason)
                  ? DENIAL_TEXT[state.error.reason]!
                  : "browser.deny.unknown",
              )}
            </span>
            {state.error.text && (
              <span className="browser-error-text">
                {" "}
                {t("browser.address.blocked", { text: state.error.text })}
              </span>
            )}
          </p>
        )}
        {!state.error && shieldNote && <span role="status">{shieldNote}</span>}
        {!state.error && !shieldNote && !tab && state.pending === null && (
          <span className="browser-hint">{shell ? t("browser.empty") : t("browser.noShell")}</span>
        )}
      </div>

      {state.pending && (
        <section className="browser-panel" role="dialog" aria-labelledby={panelId}>
          <h2 id={panelId}>{t("browser.radar.title")}</h2>
          <p>{t("browser.radar.body")}</p>
          <p className="browser-panel-url">{t("browser.radar.url", { url: state.pending.url })}</p>
          <div className="browser-panel-buttons">
            <button type="button" className="browser-button" onClick={() => void confirmOpen()}>
              {t("browser.radar.open")}
            </button>
            <button type="button" className="browser-button" onClick={cancelOpen}>
              {t("browser.radar.cancel")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
