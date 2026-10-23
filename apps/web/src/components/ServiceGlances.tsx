// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Where the per-service glances (Phase 67) are mounted: one entry per service, in this order.
import { N8nGlance, StripeGlance, VercelGlance } from "./ServiceGlancesA";
import { CalComGlance, NotionGlance, ResendGlance } from "./ServiceGlancesB";

/** Read-only glances of the services that are installed; each shows a prompt while its capability is off. */
export function ServiceGlances() {
  return (
    <>
      <VercelGlance />
      <StripeGlance />
      <N8nGlance />
      <ResendGlance />
      <NotionGlance />
      <CalComGlance />
    </>
  );
}
