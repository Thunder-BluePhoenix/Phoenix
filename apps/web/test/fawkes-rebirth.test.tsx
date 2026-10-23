// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FawkesRebirth, type FawkesCelebration } from "../src/components/FawkesRebirth";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { en } from "../src/i18n/en";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

const rebirth: FawkesCelebration = { kind: "rebirth", id: 1 };
const milestone: FawkesCelebration = { kind: "first-green-week", id: 2 };

type Props = Partial<Parameters<typeof FawkesRebirth>[0]>;
const client = new PhoenixClient({
  token: "tok",
  baseUrl: "http://127.0.0.1:4870",
  WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  fetchImpl: fakeApi({}).fetchImpl,
});
function view(props: Props, locale: ActiveLocale = "en") {
  const ui = (p: Props) => (
    <CoreProvider client={client}>
      <I18nProvider forceLocale={locale}>
        <FawkesRebirth {...p}>
          <b data-testid="avatar">F</b>
        </FawkesRebirth>
      </I18nProvider>
    </CoreProvider>
  );
  const r = render(ui(props));
  return { ...r, update: (p: Props) => r.rerender(ui(p)) };
}
const status = (c: HTMLElement) => c.querySelector(".fawkes-rebirth__status")?.textContent;
const pulse = (c: HTMLElement) => c.querySelector(".fawkes-rebirth__pulse--playing");

describe("FawkesRebirth", () => {
  it("shows nothing and animates nothing without a celebration", () => {
    const { container } = view({});
    expect(status(container)).toBe("");
    expect(pulse(container)).toBeNull();
    expect(container.querySelector("[data-celebration]")?.getAttribute("data-celebration")).toBe(
      "none",
    );
  });

  it("plays and announces a rebirth, localized from the i18n catalogue", async () => {
    const { container } = view({ celebration: rebirth });
    await act(async () => {});
    expect(status(container)).toBe(en["fawkesRebirth.rebirth"]);
    expect(pulse(container)).not.toBeNull();
    expect(container.querySelector("[data-celebration]")?.getAttribute("data-celebration")).toBe(
      "rebirth",
    );
  });

  it("announces in another locale without English leaking", async () => {
    const { container } = view({ celebration: rebirth }, "fr");
    await waitFor(() => expect(status(container)).toContain("Fawkes renaît"));
    expect(status(container)).not.toContain("risen");
  });

  it("respects reduced motion: announces but never pulses", async () => {
    const { container } = view({ celebration: rebirth, reducedMotion: true });
    await act(async () => {});
    expect(status(container)).toBe(en["fawkesRebirth.rebirth"]);
    expect(pulse(container)).toBeNull();
  });

  it("ignores milestones unless opted in, and does not replay them when enabled later", async () => {
    const { container, update } = view({ celebration: milestone });
    await act(async () => {});
    expect(status(container)).toBe("");
    expect(pulse(container)).toBeNull();
    update({ celebration: milestone, milestonesEnabled: true });
    await act(async () => {});
    expect(status(container)).toBe("");
    update({ celebration: { kind: "first-green-week", id: 3 }, milestonesEnabled: true });
    await act(async () => {});
    expect(status(container)).toBe(en["fawkesRebirth.firstGreenWeek"]);
  });

  it("hides a shown milestone if the user turns milestones off", async () => {
    const { container, update } = view({ celebration: milestone, milestonesEnabled: true });
    await act(async () => {});
    expect(status(container)).toBe(en["fawkesRebirth.firstGreenWeek"]);
    update({ celebration: milestone, milestonesEnabled: false });
    await act(async () => {});
    expect(status(container)).toBe("");
  });

  it("speaks only when spoken changes are on, and only once per delivery id", async () => {
    const spoken: string[] = [];
    const speak = (text: string) => spoken.push(text);
    const silent = view({ celebration: rebirth, speak });
    await act(async () => {});
    expect(spoken).toEqual([]);
    silent.unmount();
    const loud = view({ celebration: rebirth, spokenChanges: true, speak });
    await act(async () => {});
    loud.update({ celebration: rebirth, spokenChanges: true, speak, highContrast: true });
    await act(async () => {});
    expect(spoken).toEqual([en["fawkesRebirth.rebirth"]]);
  });

  it("rejects non-integer delivery ids and toggles the high-contrast class", async () => {
    const { container, update } = view({ celebration: { kind: "rebirth", id: 1.5 } });
    await act(async () => {});
    expect(status(container)).toBe("");
    update({ highContrast: true });
    expect(container.querySelector(".fawkes-rebirth--contrast")).not.toBeNull();
    expect(container.querySelector("[data-testid=avatar]")).not.toBeNull();
  });
});
