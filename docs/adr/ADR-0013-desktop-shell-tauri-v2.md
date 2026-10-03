# ADR-0013: Desktop shell: Tauri v2

**Status:** Accepted (pending spike)  
**Date:** 2026-10-03

## Context

Floating Fawkes needs a transparent, borderless, always-on-top window (PRD v2.0 §15). Electron is heavy; Tauri is lighter and MIT/Apache licensed (GPL-compatible).

## Decision

apps/desktop uses Tauri v2, reusing the web pet runtime. Phase 14 begins with a transparent-window spike on Linux, macOS and Windows; if it fails on a platform, revisit this ADR.

## Consequences

OS-specific shell code stays isolated from the runtime.
