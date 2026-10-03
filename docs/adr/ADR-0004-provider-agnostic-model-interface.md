# ADR-0004: Provider-agnostic model interface

**Status:** Accepted  
**Date:** 2026-10-03

## Context

Avoid AI provider lock-in and support local models (Tech Spec §04, AI Evolution §16).

## Decision

AI is accessed through a common model interface with adapters per provider. Implementation starts in Phase 27.

## Consequences

Core never imports a provider SDK directly.
