// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Purpose categories (Phase 63). A call's free-text `purpose` is mapped to one of a few
// categories so the user can route each kind of work to a provider of their choice. The mapping is
// code, not a setting: nothing a request or a settings file says can move a purpose into another
// category. This only decides WHICH provider is tried; the privacy gate (grant + class opt-in +
// SENSITIVE_CLOUD_PURPOSES) is applied to the routed provider exactly as to any other.
import { PURPOSE_ANSWER_FROM_MEMORY } from "./gate";

/** `embeddings` is not routable: embeddings never leave this device. */
export type Category = "chat" | "summaries" | "cleanup" | "embeddings";

/** The categories a user can route in Settings. */
export type RoutableCategory = "chat" | "summaries" | "cleanup";
export const ROUTABLE_CATEGORIES: readonly RoutableCategory[] = ["chat", "summaries", "cleanup"];

/** Dictation clean-up. Deliberately NOT in SENSITIVE_CLOUD_PURPOSES: it is local-only by construction. */
export const PURPOSE_CLEANUP = "clean up dictated text";

// The retrieval purposes are written out here (ai/retrieval depends on this package, not the reverse).
const CATEGORY_OF_PURPOSE: Record<string, Category> = {
  [PURPOSE_ANSWER_FROM_MEMORY]: "chat",
  [PURPOSE_CLEANUP]: "cleanup",
  "embed memory for retrieval": "embeddings",
  "embed a retrieval query": "embeddings",
};

/**
 * The category of a purpose string. Unknown purposes (and anything inherited from `Object`) are
 * "summaries", the most conservative category: background and extraction work.
 */
export function purposeCategory(purpose: string): Category {
  return Object.hasOwn(CATEGORY_OF_PURPOSE, purpose) ? CATEGORY_OF_PURPOSE[purpose]! : "summaries";
}
