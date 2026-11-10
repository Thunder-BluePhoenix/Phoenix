// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the pages sent from the browser extension (Phase 89). */
export const pageNotes = {
  "pageNotes.title": "Pages sent from your browser",
  "pageNotes.intro":
    "Pages you chose to send with the Phoenix browser extension. The address, title and selected text were written by the website, so they are shown as plain text. Phoenix does not open, read or send them to an AI; delete any you do not want to keep.",
  "pageNotes.loading": "Loading pages…",
  "pageNotes.loadFailed": "The list of pages could not be loaded.",
  "pageNotes.empty": "No pages have been sent.",
  "pageNotes.list": "Pages sent from your browser",
  "pageNotes.untitled": "(no title)",
  "pageNotes.received": "Received {time}",
  "pageNotes.selection": "Selected text",
  "pageNotes.delete": "Delete",
  "pageNotes.deleteLabel": "Delete the page {title}",
} as const;
