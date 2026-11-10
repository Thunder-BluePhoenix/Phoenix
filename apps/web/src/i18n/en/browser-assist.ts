// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the browser's "Ask Fawkes to help with this page" panel (Phase 95). */
export const browserAssist = {
  "browser.assist.open": "Ask Fawkes to help with this page",
  "browser.assist.title": "Ask Fawkes to help with this page",
  "browser.assist.goalLabel": "What do you want done on this page?",
  "browser.assist.goalPlaceholder": "For example: add the blue one to the cart",
  "browser.assist.propose": "Propose steps",
  "browser.assist.proposing": "Asking the local model…",
  "browser.assist.close": "Close the assistant",
  "browser.assist.goalTooLong": "The goal can be at most {max} characters.",
  "browser.assist.goalControl": "The goal cannot contain control characters.",
  "browser.assist.goalHidden": "The goal cannot contain text-direction or zero-width characters.",
  "browser.assist.requestFailed": "The assistant could not be reached. Nothing was run.",
  "browser.assist.busy":
    "The assistant is still working on another request. Wait a moment and try again. Nothing was run.",
  "browser.assist.noLocalModel":
    "No on-device model is available, so Fawkes did not read this page. Page text is never sent to a cloud service.",
  "browser.assist.localModelFailed":
    "The on-device model failed. Nothing was run and nothing was sent anywhere else.",
  "browser.assist.noBrowser": "This Phoenix app has no browser to read a page from.",
  "browser.assist.inert":
    "Proposed by a local model that read this page. Nothing has run. These steps are plain text and may be wrong.",
  "browser.assist.forPage": "For the page: {url}",
  "browser.assist.dropped":
    "{count, plural, one {# model suggestion was refused and is not shown.} other {# model suggestions were refused and are not shown.}}",
  "browser.assist.noSteps": "The model proposed no steps for this page.",
  "browser.assist.kind.click": "Click",
  "browser.assist.kind.type": "Type into",
  "browser.assist.kind.submit": "Submit the form",
  "browser.assist.typeText": "the text: {text}",
  "browser.assist.modelWritten": "written by the local model, not by you",
  "browser.assist.run": "Run this step",
  "browser.assist.step.running": "Waiting for your approval…",
  "browser.assist.step.done": "Done. Nothing else was run.",
  "browser.assist.refused.noTab": "There is no active tab to run this step on.",
  "browser.assist.refused.moved":
    "The tab is no longer on the page these steps were proposed for. Ask again.",
  "browser.assist.failed.denied": "You declined this step.",
  "browser.assist.failed.blocked":
    "Phoenix refused this step (the page or control is not allowed).",
  "browser.assist.failed.unavailable": "The browser could not be reached.",
  "browser.assist.failed.timeout": "The step timed out. It may or may not have run.",
  "browser.assist.failed.failed": "The step did not run.",
} as const;
