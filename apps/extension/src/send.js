// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// "Send page to Phoenix", run only from the toolbar button's click. The extension reads the active
// tab's address and title (activeTab grants that for this click only) and, only if the person
// selected text, that selection. It sends one message to the native-messaging host and shows the
// host's answer on the button. It holds no session token and talks to nothing else.
import { HOST_NAME, buildPageMessage } from "./page.js";

/** Runs in the tab, once, on this click: the selection, never a password field's. */
function readSelection() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.type === "password") return "";
  return String(globalThis.getSelection() ?? "");
}

/** What the button shows after a click: a short badge and a hover text the person can read. */
export const OUTCOMES = {
  sent: { badge: "OK", title: "Sent to Phoenix. Review it in Phoenix, under Pages." },
  unsupported_page: { badge: "!", title: "Only http and https pages can be sent." },
  host_missing: {
    badge: "!",
    title: "Phoenix's native-messaging host is not installed for this browser.",
  },
  core_unreachable: { badge: "!", title: "Phoenix is not running, or the host cannot reach it." },
  token_missing: { badge: "!", title: "The host could not find Phoenix's session token." },
  token_rejected: { badge: "!", title: "Phoenix did not accept the host's session token." },
  rejected: { badge: "!", title: "Phoenix refused this page." },
  failed: { badge: "!", title: "Sending failed." },
};

const HOST_CODES = ["core_unreachable", "token_missing", "token_rejected", "rejected"];

/** Maps the host's reply (or a failure to reach the host) to an OUTCOMES key. */
export function outcomeOf(reply, lastError) {
  if (lastError) return "host_missing";
  if (reply && reply.ok === true) return "sent";
  if (reply && HOST_CODES.includes(reply.error)) return reply.error;
  return "failed";
}

/** One click. `api` is the `chrome` object (a fake in tests). Resolves to the OUTCOMES key. */
export async function sendActivePage(api, tab) {
  const tabId = tab?.id;
  const show = async (key) => {
    const { badge, title } = OUTCOMES[key];
    if (typeof tabId === "number") {
      await api.action.setBadgeText({ tabId, text: badge });
      await api.action.setTitle({ tabId, title });
    }
    return key;
  };
  if (typeof tabId !== "number") return "failed";
  // The address is checked before any script runs: a chrome:// or file: tab is never touched.
  const probe = buildPageMessage({ url: tab.url, title: "" });
  if (!probe.ok) return show("unsupported_page");

  let selection = "";
  try {
    const [result] = await api.scripting.executeScript({
      target: { tabId },
      func: readSelection,
    });
    if (typeof result?.result === "string") selection = result.result;
  } catch {
    // The page refused the script (for example a store page): send the address and title only.
  }
  const built = buildPageMessage({ url: tab.url, title: tab.title, selection });
  if (!built.ok) return show(built.reason);

  const reply = await new Promise((resolve) => {
    try {
      api.runtime.sendNativeMessage(HOST_NAME, built.message, (response) => {
        resolve({ response, lastError: api.runtime.lastError });
      });
    } catch {
      resolve({ response: undefined, lastError: true });
    }
  });
  return show(outcomeOf(reply.response, reply.lastError));
}
