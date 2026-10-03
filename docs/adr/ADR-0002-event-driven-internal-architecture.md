# ADR-0002: Event-driven internal architecture

**Status:** Accepted  
**Date:** 2026-10-03

## Context

Many independent systems (Kage, Git, CI, agents) produce state. Components must be loosely coupled (Tech Spec §05).

## Decision

All subsystems communicate through versioned events on the Phoenix event bus. Events use the envelope defined in `protocol/schemas/event-v1.schema.json`. Delivery is at-least-once; consumers are idempotent and deduplicate on `event_id`.

## Consequences

Adding an integration never requires changing the state engine or UI — only a mapping rule.
