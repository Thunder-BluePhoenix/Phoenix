# ADR-0013: Desktop shell: Tauri v2

**Status:** Accepted (pending spike: macOS verified on a real desktop; Linux and Windows not yet run)  
**Date:** 2026-10-03

## Context

Floating Fawkes needs a transparent, borderless, always-on-top window (PRD v2.0 §15). Electron is heavy; Tauri is lighter and MIT/Apache licensed (GPL-compatible).

## Decision

apps/desktop uses Tauri v2, reusing the web pet runtime. Phase 14 begins with a transparent-window spike on Linux, macOS and Windows; if it fails on a platform, revisit this ADR.

## Spike result (Phase 14)

- **macOS (Apple silicon):** passes. The transparent, borderless window renders with fully transparent corners, drags, keeps its position across restarts, and the tray, keep-on-top and start-on-login all work. Transparency needs Tauri's `macos-private-api` feature, so the app cannot go in the Mac App Store.
- **Linux, Windows:** not run. The decision stays "pending spike" until they are.

## Consequences

OS-specific shell code stays isolated from the runtime.
