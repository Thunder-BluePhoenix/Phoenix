# ADR-0007: Fawkes as presentation layer

**Status:** Accepted  
**Date:** 2026-10-03

## Context

Fawkes must never fabricate state (Tech Spec §10).

## Decision

Fawkes only renders the state computed by the state engine. Animation code has no knowledge of specific integrations.

## Consequences

State engine is the single source of truth; UI is replaceable.
