// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings screen for browser profiles (Phase 96) and music sites (Phase 94). */
export const browserProfiles = {
  "browserProfiles.title": "Browser profiles",
  "browserProfiles.intro":
    "Phoenix has no browser of its own yet, so nothing opens a page here: a profile is a record of bookmarks, a sync choice and extensions.",
  "browserProfiles.unavailable":
    "Browser profiles are not available: Phoenix Core has no operating-system secret store to keep them safe.",
  "browserProfiles.loadFailed": "Browser profiles could not be read from Phoenix Core.",
  "browserProfiles.empty": "No profiles yet.",
  "browserProfiles.list": "Profiles",
  "browserProfiles.create.name": "Profile name",
  "browserProfiles.create.submit": "Create profile",
  "browserProfiles.counts":
    "Bookmarks: {bookmarks} · History: {history} · Extensions: {extensions}",
  "browserProfiles.sync.label": "Sync this profile across my devices",
  "browserProfiles.sync.hint":
    "Sync only runs when account sync is also set up in Settings → Sync.",
  "browserProfiles.import.label": "Bookmarks to import (HTML file exported by a browser)",
  "browserProfiles.import.hint":
    "Paste the contents of the file. Up to 256 KiB at a time; split a larger export into parts.",
  "browserProfiles.import.submit": "Import bookmarks",
  "browserProfiles.import.result": "Imported {imported}, skipped {skipped}.",
  "browserProfiles.publish.submit": "Publish to my other devices",
  "browserProfiles.publish.done": "Published.",
  "browserProfiles.remove.start": "Remove profile",
  "browserProfiles.remove.ask":
    "Remove “{name}”? This deletes its bookmarks, history, extensions and saved credentials, and cannot be undone.",
  "browserProfiles.remove.done":
    "Profile removed. Its bookmarks, history, extensions and saved credentials were deleted. The isolated web storage named {partition} cannot be cleared by Phoenix Core yet.",
  "browserProfiles.devices.heading": "Other devices",
  "browserProfiles.devices.check": "Check for profiles from my other devices",
  "browserProfiles.devices.none": "No new profiles from your other devices.",
  "browserProfiles.devices.found": "Profiles from your other devices",
  "browserProfiles.devices.adopt": "Adopt",
  "browserProfiles.devices.adoptLabel": "Adopt {name} onto this device",
  "browserProfiles.devices.adopted": "Profile adopted.",
  "browserProfiles.ext.heading": "Extensions",
  "browserProfiles.ext.admin": "Extensions are installed by your administrator.",
  "browserProfiles.ext.none": "No extensions.",
  "browserProfiles.ext.loadFailed": "Extensions could not be read.",
  "browserProfiles.ext.version": "Version {version}",
  "browserProfiles.ext.origins": "Sites: {origins}",
  "browserProfiles.ext.permissions": "Permissions: {permissions}",
  "browserProfiles.ext.noneListed": "none",
  "browserProfiles.ext.approved": "Approved",
  "browserProfiles.ext.notApproved": "Not approved",
  "browserProfiles.ext.approve": "Approve",
  "browserProfiles.ext.approveLabel": "Approve extension {id}",
  "browserProfiles.ext.withdraw": "Withdraw approval",
  "browserProfiles.ext.withdrawLabel": "Withdraw approval of extension {id}",
  "browserProfiles.ext.remove": "Remove",
  "browserProfiles.ext.removeLabel": "Remove extension {id}",
  "browserProfiles.ext.waiting": "Waiting for your answer to the approval question…",
  "browserProfiles.music.title": "Music sites",
  "browserProfiles.music.intro":
    "Phoenix does not play music. Turning a site on only lets Phoenix build a search address for it, which you open yourself. Every site is off until you turn it on.",
  "browserProfiles.music.unavailable": "Music sites are not available in this Phoenix Core.",
  "browserProfiles.music.loadFailed": "Music sites could not be read from Phoenix Core.",
  "browserProfiles.music.list": "Music sites",
  "browserProfiles.music.hosts": "Addresses used: {hosts}",
  "browserProfiles.music.adBlocking":
    "While YouTube is on, ad blocking does not apply to its own player.",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "Music site {site}",
  "browserProfiles.music.search.label": "Search {site}",
  "browserProfiles.music.search.submit": "Search",
  "browserProfiles.music.search.open": "Search address (opens in a new tab):",
  "browserProfiles.music.search.badAddress":
    "Phoenix Core returned an address that cannot be opened.",
} as const;
