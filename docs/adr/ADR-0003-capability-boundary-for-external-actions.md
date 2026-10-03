# ADR-0003: Capability boundary for external actions

**Status:** Accepted  
**Date:** 2026-10-03

## Context

External side effects must be controlled and auditable (PRD v2.0 §10, §18).

## Decision

Every integration is a capability with a manifest declaring events, commands and permissions. Phoenix only touches external systems through capabilities.

## Consequences

Capability failures are contained; permissions are reviewable per capability.
