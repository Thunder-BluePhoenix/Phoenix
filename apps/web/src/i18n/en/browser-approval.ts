// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the approval card of a browsing-assistant action (Phase 95). */
export const browserApproval = {
  "browserApproval.action": "Browser action",
  "browserApproval.action.click": "Click a control on the page",
  "browserApproval.action.type": "Type text into a field on the page",
  "browserApproval.action.submit": "Submit a form on the page",
  "browserApproval.action.download": "Start a download from the page",
  "browserApproval.action.navigate": "Go to another address",
  "browserApproval.action.missing": "The request does not say what kind of action this is.",
  "browserApproval.page": "Page",
  "browserApproval.page.missing": "The request does not name the page.",
  "browserApproval.selector": "Control",
  "browserApproval.selector.missing": "The request does not name a control.",
  "browserApproval.destination": "Destination",
  "browserApproval.destination.missing": "The request does not name a destination.",
  "browserApproval.queryHidden": "The address also has a query part, which is not shown.",
  "browserApproval.text": "Text that will be typed (shown in full)",
  "browserApproval.text.missing": "The request does not include the text.",
  "browserApproval.textLength": "Text length",
  "browserApproval.textLength.value": "{length} characters",
  "browserApproval.textLength.missing": "The text length is missing.",
} as const;
