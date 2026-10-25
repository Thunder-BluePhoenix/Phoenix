// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { BrowserAction } from "./index";

/**
 * The tool names Core registers for the Phoenix browser (capability id `browser`, one command per
 * action kind). Trusted integration config for `BrowsingBridgeOptions.tools`, never page or model text.
 */
export const BROWSER_TOOL_NAMES: Readonly<Record<BrowserAction["kind"], string>> = {
  click: "browser.click",
  type: "browser.type",
  submit: "browser.submit",
  navigate: "browser.navigate",
  download: "browser.download",
};

/**
 * The only selectors the Phoenix browser will act on: what the page reader emits for a control with a
 * unique id or name (`input#q`, `button[name="go"]`). Positional (`:nth-of-type`) and de-duplicated
 * (`~1`) selectors are not valid CSS and are refused, so the host never has to run a page-controlled
 * selector through the page's own query engine.
 */
export const BROWSER_SELECTOR_PATTERN =
  '^(?:input|button|form|select|textarea)(?:#[A-Za-z0-9_:.-]{1,80}|\\[name="[A-Za-z0-9_:.-]{1,80}"\\])$';

const SELECTOR = new RegExp(BROWSER_SELECTOR_PATTERN);

export function isActionableSelector(selector: string): boolean {
  return SELECTOR.test(selector);
}
