# ADR-0006: Permission gateway before tool execution

**Status:** Accepted  
**Date:** 2026-10-03

## Context

AI and capabilities must not gain implicit authority (Tech Spec §09).

## Decision

Every side-effecting command passes a permission check that can return PERMISSION_DENIED or ACTION_REQUIRES_CONFIRMATION, and emits an audit event.

## Consequences

Implemented in Phase 11; extended with risk tiers in Phase 30.
