# ADR-0015: Topology: local-only core bound to loopback

**Status:** Accepted  
**Date:** 2026-10-03

## Context

Fawkes PRD §22 asks whether the bus runs locally or on a remote server.

## Decision

For v0.x the core listens on 127.0.0.1 only. Binding to another interface requires `allowRemote: true` in config and is unsupported until an auth model exists. A remote/cross-device mode is revisited in Phase 45.

## Consequences

No network exposure by default.
