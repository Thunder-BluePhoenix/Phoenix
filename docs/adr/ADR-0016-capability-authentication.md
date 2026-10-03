# ADR-0016: Capability authentication

**Status:** Accepted  
**Date:** 2026-10-03

## Context

Event injection is a listed threat (PRD v2.0 §18).

## Decision

When a capability is enabled, core issues it a random per-capability token. Events submitted with that token must have `source` equal to the capability id; otherwise they are rejected with SECURITY_POLICY_BLOCKED. In-process capabilities are bound to their id at registration.

## Consequences

Implemented in Phase 12.
