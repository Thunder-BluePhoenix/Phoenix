# ADR-0012: Web framework: React + Vite

**Status:** Accepted  
**Date:** 2026-10-03

## Context

PRD v1 §13 suggests React / Next.js. Phoenix web UI talks to a local core and needs no server-side rendering.

## Decision

apps/web uses React with Vite (static SPA served by core).

## Consequences

Simpler than Next.js for a local-first app; can embed into other apps as a component library later.
