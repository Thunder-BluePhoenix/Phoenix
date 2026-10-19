// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** One thing a service is doing or has done (a deployment, a payment, a workflow run). */
export interface ServiceItem {
  id: string;
  title: string;
  /** Short state word from the service, e.g. "ready", "failed", "running". */
  state: string;
  detail?: string;
  /** https link to the item on the service's own site. */
  url?: string;
  /** ISO time. */
  at?: string;
}

/** What every service capability's read-only `status` command returns. */
export interface ServiceStatus {
  /** False until the user has stored the credential this service needs. */
  configured: boolean;
  items: ServiceItem[];
  /** Why there is nothing to show, e.g. "Add an API key in Settings". Never remote text. */
  note?: string;
}
