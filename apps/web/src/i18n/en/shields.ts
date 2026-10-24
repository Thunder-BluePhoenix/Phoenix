// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings card "Ad and tracker blocking" (Phase 93): filter lists and shields. */
export const shields = {
  "shields.title": "Ad and tracker blocking",
  "shields.intro":
    "These settings apply in the Phoenix browser when it ships. Phoenix has no browser window yet, so nothing is blocked in any page today. Only network requests can be blocked this way: hiding page elements is not supported, and this is not a copy of any other browser's shields.",
  "shields.unavailable": "Ad and tracker blocking settings are not available from Phoenix Core.",
  "shields.loadFailed": "The blocking settings could not be read from Phoenix Core.",
  "shields.global.label": "Block ads and trackers",
  "shields.global.hint":
    "When off, no list is applied to any site. When on and no list is downloaded, a short built-in list of well-known ad and analytics hosts is used.",
  "shields.lists.title": "Filter lists",
  "shields.lists.note":
    "Lists are not included with Phoenix and are never downloaded on their own. Pressing Update contacts easylist.to once, to download that list. Nothing about you or your pages is sent.",
  "shields.list.purpose.ads": "Blocks advertising",
  "shields.list.purpose.trackers": "Blocks tracking",
  "shields.list.never": "Never downloaded.",
  "shields.list.damaged":
    "The stored copy is damaged and is not used. Press Update to download it again.",
  "shields.list.status":
    "Downloaded {date} · {rules} blocking rules · {cosmetic} page-element rules ignored",
  "shields.list.version": "List version {version}",
  "shields.list.due":
    "The list suggests looking for a new version after {date}. Phoenix never checks by itself.",
  "shields.list.licence": "Licence: {licence}. Credit: {attribution}.",
  "shields.list.source": "Update contacts {source}",
  "shields.list.enable": "Use {name}",
  "shields.list.enableNeedsDownload": "Download the list before turning it on.",
  "shields.list.update": "Update",
  "shields.list.updateFirst": "Download",
  "shields.list.updating": "Downloading…",
  "shields.list.updated": "{name} was updated.",
  "shields.list.remove": "Delete the downloaded copy",
  "shields.list.removed": "The downloaded copy of {name} was deleted.",
  "shields.sites.title": "Sites with blocking turned off",
  "shields.sites.empty": "No site has blocking turned off.",
  "shields.sites.add.label": "Site name, for example example.com",
  "shields.sites.add.submit": "Turn blocking off for this site",
  "shields.sites.remove": "Turn blocking back on for {site}",
  "shields.sites.hint":
    "Type a site name only, not an address. The site and its subdomains are included. YouTube's own ads are left alone while the YouTube music site is allowed, and that is set under music sites, not here.",
} as const;
