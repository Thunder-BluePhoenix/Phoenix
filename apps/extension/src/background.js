// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The only listener: the toolbar button's click. No content script runs on any page, and nothing
// here runs without that click.
import { sendActivePage } from "./send.js";

chrome.action.onClicked.addListener((tab) => {
  void sendActivePage(chrome, tab);
});
