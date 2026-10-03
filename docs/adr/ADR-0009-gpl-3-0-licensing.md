# ADR-0009: GPL-3.0 licensing

**Status:** Accepted  
**Date:** 2026-10-03

## Context

The vision documents set GNU GPL-3.0 as the licensing direction; Kage is GPL-3.0.

## Decision

Phoenix is licensed under GPL-3.0. Source files carry the SPDX header `GPL-3.0-or-later` (the FSF's standard notice). Every dependency and asset is recorded in `docs/licenses/INVENTORY.md` and must be GPL-3.0 compatible.

## Consequences

Maintainers may switch the SPDX identifier to `GPL-3.0-only` with a single search-and-replace if they prefer to forbid later GPL versions.
