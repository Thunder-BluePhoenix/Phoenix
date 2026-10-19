// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import {
  formatAgo,
  formatDate,
  formatNumber,
  formatRelative,
  formatTime,
  SEVERITY_LABEL,
} from "../src/core/format";
import { I18nProvider, useLocale, useT, type ActiveLocale, type MessageKey } from "../src/i18n";
import { en } from "../src/i18n/en";
import { loadMessages, resetActive } from "../src/i18n/store";
import { LOCALE_CODES } from "../src/i18n/supported";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  window.location.hash = "";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

/** A fake Core that keeps `ui.locale` the way the real one does, across page loads. */
function fakeCore(initial = "en") {
  const core = { locale: initial };
  const api = fakeApi({
    "GET /api/ui/settings": () => ({ locale: core.locale, supported: LOCALE_CODES }),
    "POST /api/ui/settings": (body) => {
      const locale = (body as { locale?: string }).locale;
      if (!locale || !(LOCALE_CODES as readonly string[]).includes(locale)) {
        return new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "bad locale" }), {
          status: 400,
        });
      }
      core.locale = locale;
      return { locale, supported: LOCALE_CODES };
    },
  });
  return { core, api };
}

function load(api: FakeApi, ui: React.ReactNode, forceLocale?: ActiveLocale) {
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <I18nProvider {...(forceLocale ? { forceLocale } : {})}>{ui}</I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return { ...view, ws: FakeWebSocket.last };
}

function Probe({ k = "common.button.save" as MessageKey }) {
  const t = useT();
  const { locale, dir } = useLocale();
  return (
    <p>
      <span data-testid="text">{t(k)}</span>
      <span data-testid="locale">{`${locale}/${dir}`}</span>
    </p>
  );
}

describe("language loading, lang and dir", () => {
  it("shows English until Core's saved language arrives, then switches, sets lang and dir=rtl for Arabic", async () => {
    const { api } = fakeCore("ar");
    load(api, <Probe />);
    expect(screen.getByTestId("text").textContent).toBe("Save");
    await waitFor(() => expect(screen.getByTestId("text").textContent).toBe("حفظ"));
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByTestId("locale").textContent).toBe("ar/rtl");
  });

  it("is left-to-right in every language except Arabic", async () => {
    for (const code of LOCALE_CODES) {
      const { api } = fakeCore(code);
      load(api, <Probe />);
      await waitFor(() => expect(document.documentElement.lang).toBe(code));
      expect(document.documentElement.dir).toBe(code === "ar" ? "rtl" : "ltr");
      cleanup();
      resetActive();
    }
  });

  it("applies a language change made in another window (ui.settings.changed) and goes back to ltr", async () => {
    const { core, api } = fakeCore("ar");
    const { ws } = load(api, <Probe />);
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    core.locale = "es";
    act(() =>
      ws.message("event.created", {
        seq: 1,
        event: {
          event_id: "evt_1aaaaaa",
          event_type: "ui.settings.changed",
          source: "core",
          severity: "info",
          timestamp: "2026-10-09T12:00:00Z",
          payload: { locale: "es" },
        },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("text").textContent).toBe("Guardar"));
    expect(document.documentElement.lang).toBe("es");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("ignores a locale from an event or from Core that is not one of the ten", async () => {
    const { api } = fakeCore("klingon");
    load(api, <Probe />);
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/ui/settings")).toBe(true));
    expect(screen.getByTestId("locale").textContent).toBe("en/ltr");
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps working when Core has no UI settings route (stays English)", async () => {
    const api = fakeApi();
    load(api, <Probe />);
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/ui/settings")).toBe(true));
    expect(screen.getByTestId("text").textContent).toBe("Save");
  });
});

describe("fallback to English", () => {
  it("a key missing from a locale is shown in English, not as a key", async () => {
    const { api } = fakeCore("es");
    load(api, <Probe k="common.button.save" />);
    await waitFor(() => expect(screen.getByTestId("text").textContent).toBe("Guardar"));
    const { default: es } = await import("../src/i18n/locales/es");
    const original = es["common.button.close"];
    delete (es as Record<string, string>)["common.button.close"];
    try {
      cleanup();
      resetActive();
      const second = fakeCore("es");
      load(second.api, <Probe k="common.button.close" />);
      await waitFor(() => expect(document.documentElement.lang).toBe("es"));
      expect(screen.getByTestId("text").textContent).toBe(en["common.button.close"]);
    } finally {
      (es as Record<string, string>)["common.button.close"] = original;
    }
  });

  it("every locale provides every key, none is empty and none loses a variable", async () => {
    const variables = (m: string) => [...m.matchAll(/\{(\w+)[,}]/g)].map((x) => x[1]).sort();
    for (const code of LOCALE_CODES) {
      const messages = await loadMessages(code);
      for (const key of Object.keys(en) as MessageKey[]) {
        const text = messages[key];
        expect(text, `${code} ${key}`).toBeTruthy();
        expect(variables(text!), `${code} ${key}`).toEqual(variables(en[key]));
      }
    }
  });
});

describe("pseudo-locale en-XA (dev and test builds only)", () => {
  it("accents, lengthens and brackets messages while keeping variables", async () => {
    const { api } = fakeCore();
    function Pseudo() {
      const t = useT();
      return (
        <>
          <p data-testid="a">{t("common.button.save")}</p>
          <p data-testid="b">{t("common.time.ago", { since: "5 min" })}</p>
        </>
      );
    }
    load(api, <Pseudo />, "en-XA");
    await waitFor(() => expect(screen.getByTestId("a").textContent).toMatch(/^\[.+\]$/));
    const save = screen.getByTestId("a").textContent!;
    expect(save).not.toContain("Save");
    expect(save.length).toBeGreaterThanOrEqual("Save".length * 1.3 + 2);
    expect(screen.getByTestId("b").textContent).toContain("5 min");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("is never accepted from Core", async () => {
    const { api } = fakeCore("en-XA");
    load(api, <Probe />);
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/ui/settings")).toBe(true));
    expect(screen.getByTestId("locale").textContent).toBe("en/ltr");
  });
});

describe("interpolated values are text", () => {
  it("renders a value that looks like a placeholder or HTML as plain text", async () => {
    const { api } = fakeCore();
    function Hostile() {
      const t = useT();
      return (
        <p data-testid="h">{t("common.time.ago", { since: '{x}<img src=x onerror="boom()">' })}</p>
      );
    }
    load(api, <Hostile />);
    const el = screen.getByTestId("h");
    expect(el.textContent).toBe('{x}<img src=x onerror="boom()"> ago');
    expect(el.querySelector("img")).toBeNull();
  });

  it("t.rich puts an element inside the sentence and still renders other values as text", async () => {
    const { api } = fakeCore();
    function Rich() {
      const t = useT();
      return (
        <p data-testid="r">{t.rich("shell.app.noToken", { command: <code>{"{x}<b>"}</code> })}</p>
      );
    }
    load(api, <Rich />);
    const el = screen.getByTestId("r");
    expect(el.querySelector("code")?.textContent).toBe("{x}<b>");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("no session token");
  });
});

describe("the language picker (Settings)", () => {
  function openSettings(api: FakeApi) {
    window.location.hash = "#/settings";
    return load(api, <App />);
  }
  /** The language select, found by its options: its label is in whatever language is on screen. */
  const picker = async () => {
    await screen.findAllByRole("combobox");
    const select = screen
      .getAllByRole("combobox")
      .find((el) => within(el).queryByRole("option", { name: "Bahasa Indonesia" }));
    if (!select) throw new Error("language picker not found");
    return select as HTMLSelectElement;
  };

  it("lists the ten languages by their own names, without the pseudo-locale", async () => {
    const { api } = fakeCore();
    openSettings(api);
    const select = await picker();
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "English",
      "中文",
      "हिन्दी",
      "Español",
      "العربية",
      "Français",
      "বাংলা",
      "Português",
      "Русский",
      "Bahasa Indonesia",
    ]);
    expect(select.value).toBe("en");
  });

  it("saves the choice in Core, translates the app, flips to rtl for Arabic and back", async () => {
    const { core, api } = fakeCore();
    openSettings(api);
    fireEvent.change(await picker(), { target: { value: "ar" } });
    await waitFor(() => expect(core.locale).toBe("ar"));
    expect(api.posts("/api/ui/settings")[0]!.body).toEqual({ locale: "ar" });
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(document.documentElement.lang).toBe("ar");
    expect(screen.getByRole("navigation", { name: "الرئيسية" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "الاجتماعات" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Meetings" })).toBeNull();

    fireEvent.change(await picker(), { target: { value: "fr" } });
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    expect(document.documentElement.lang).toBe("fr");
    expect(screen.getByRole("link", { name: "Réunions" })).toBeTruthy();

    fireEvent.change(await picker(), { target: { value: "en" } });
    await waitFor(() => expect(screen.getByRole("link", { name: "Meetings" })).toBeTruthy());
    expect(document.documentElement.dir).toBe("ltr");
    expect(core.locale).toBe("en");
  });

  it("survives a reload: a fresh page loads the saved language from Core", async () => {
    const { core, api } = fakeCore();
    const first = openSettings(api);
    fireEvent.change(await picker(), { target: { value: "es" } });
    await waitFor(() => expect(core.locale).toBe("es"));
    first.unmount();
    resetActive();
    document.documentElement.lang = "en";
    FakeWebSocket.reset();

    openSettings(api);
    await waitFor(() => expect(screen.getByRole("link", { name: "Reuniones" })).toBeTruthy());
    expect(document.documentElement.lang).toBe("es");
    expect((await picker()).value).toBe("es");
  });

  it("keeps the current language and says so when Core refuses the change", async () => {
    const { core, api } = fakeCore();
    api.set(
      "POST /api/ui/settings",
      () =>
        new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "no" }), { status: 400 }),
    );
    openSettings(api);
    fireEvent.change(await picker(), { target: { value: "ru" } });
    expect(await screen.findByText(en["shell.language.failed"])).toBeTruthy();
    expect(screen.getByText(en["shell.language.failed"]).getAttribute("role")).toBe("alert");
    expect(core.locale).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("link", { name: "Meetings" })).toBeTruthy();
  });

  it("the machine-translation notice is shown", async () => {
    const { api } = fakeCore();
    openSettings(api);
    await picker();
    expect(screen.getByText(en["shell.language.machineNote"])).toBeTruthy();
  });
});

describe("date, number and relative-time helpers follow the language", () => {
  const iso = "2026-10-09T14:03:09Z";

  it("format with the given locale (replacing the old en-US/[] defaults)", () => {
    expect(formatDate(iso, "en")).toMatch(/Oct/);
    expect(formatDate(iso, "es")).toMatch(/oct/);
    expect(formatDate(iso, "ar")).not.toBe(formatDate(iso, "en"));
    expect(formatDate(iso, "ar")).toContain("\u200f");
    expect(formatDate(iso, "ru")).toMatch(/окт/);
    expect(formatTime(iso, "en")).toMatch(/[AP]M/);
    expect(formatTime(iso, "fr")).not.toMatch(/[AP]M/);
    expect(formatNumber(1234567.5, "en")).toBe("1,234,567.5");
    expect(formatNumber(1234567.5, "fr")).not.toBe("1,234,567.5");
    expect(formatNumber(1234567, "bn")).not.toBe("1,234,567");
    expect(formatRelative(iso, Date.parse(iso) + 5 * 60_000, "es")).toBe("hace 5 minutos");
    expect(formatRelative(iso, Date.parse(iso) + 5 * 60_000, "en")).toBe("5 minutes ago");
    expect(formatRelative(iso, Date.parse(iso) - 3_600_000, "en")).toBe("in 1 hour");
  });

  it("a bad date is an empty string in every language", () => {
    expect(formatDate("nope", "ar")).toBe("");
    expect(formatTime("nope", "ar")).toBe("");
    expect(formatRelative("nope", 0, "ar")).toBe("");
  });

  it("use the active language when none is given, including the 'x min ago' phrases and severity labels", async () => {
    const { core, api } = fakeCore("es");
    load(api, <Probe />);
    await waitFor(() => expect(document.documentElement.lang).toBe("es"));
    const now = Date.parse(iso) + 5 * 60_000;
    expect(formatAgo(iso, now)).toBe("hace 5 min");
    expect(formatAgo(iso, Date.parse(iso) + 1000)).toBe("ahora mismo");
    expect(SEVERITY_LABEL.warning).toBe("Advertencia");
    expect(SEVERITY_LABEL.nope).toBeUndefined();
    expect(formatDate(iso)).toMatch(/oct/);
    void core;
  });

  it("stay in English with no provider (existing pages and tests are unchanged)", () => {
    expect(formatAgo("2026-10-09T14:00:00Z", Date.parse("2026-10-09T14:05:00Z"))).toBe("5 min ago");
    expect(SEVERITY_LABEL.error).toBe("Error");
  });
});
