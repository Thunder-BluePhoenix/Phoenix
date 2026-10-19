// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** The one Vite flag the i18n code reads; Vite replaces it at build time (false in production). */
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}
