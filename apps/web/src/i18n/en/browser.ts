// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the Phoenix browser's chrome (tabs, address bar, shields, port-radar prompt). */
export const browser = {
  "browser.tabs.label": "Tabs",
  "browser.tab.untitled": "New tab",
  "browser.tab.loading": "Loading",
  "browser.tab.close": "Close tab {title}",
  "browser.tab.new": "New tab",
  "browser.nav.back": "Back",
  "browser.nav.forward": "Forward",
  "browser.nav.reload": "Reload",
  "browser.address.label": "Address or search",
  "browser.address.placeholder": "Search or type an address",
  "browser.address.go": "Go",
  "browser.address.blocked": "Not opened: {text}",
  "browser.deny.unparseable": "That is not a valid web address.",
  "browser.deny.scheme_not_allowed": "Only secure web addresses (https) can be opened.",
  "browser.deny.dangerous_scheme":
    "Addresses that run code or hold the page itself cannot be opened.",
  "browser.deny.file_blocked": "Files on this computer cannot be opened here.",
  "browser.deny.credentials_in_url": "Addresses with a user name or password in them are refused.",
  "browser.deny.private_network":
    "Addresses on this computer or your local network cannot be typed here. Open a program's page from the port radar instead.",
  "browser.deny.bad_port": "That port is blocked because it belongs to a non-web service.",
  "browser.deny.insecure_blocked": "Plain http addresses are not opened.",
  "browser.deny.site_denied": "This site is on the blocked list.",
  "browser.deny.dns_private":
    "That name points to an address on this computer or your local network.",
  "browser.deny.port_radar_invalid":
    "The request from the port radar was not a plain page on this computer, so it was ignored.",
  "browser.deny.unknown": "That address was refused.",
  "browser.zoom.label": "Zoom",
  "browser.zoom.out": "Zoom out",
  "browser.zoom.in": "Zoom in",
  "browser.zoom.reset": "Reset zoom to {percent}",
  "browser.shields.label": "Block ads and trackers on {site}",
  "browser.shields.saveFailed":
    "The choice was applied here but could not be saved in Phoenix Core.",
  "browser.shields.blocked": "{count, plural, one {# request blocked} other {# requests blocked}}",
  "browser.empty": "No tab is open. Type an address or a search above.",
  "browser.noShell":
    "This page is the Phoenix browser's toolbar. It only works inside the Phoenix desktop app.",
  "browser.radar.title": "Open a program from this computer?",
  "browser.radar.body":
    "The port radar asks to open this address. It is a program running on this computer, not a website, and it is not encrypted.",
  "browser.radar.url": "Address: {url}",
  "browser.radar.open": "Open it",
  "browser.radar.cancel": "Cancel",
  "browser.error.action": "The browser could not do that.",
} as const;
