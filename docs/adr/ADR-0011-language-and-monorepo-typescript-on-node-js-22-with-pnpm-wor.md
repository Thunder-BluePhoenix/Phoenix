# ADR-0011: Language and monorepo: TypeScript on Node.js 22 with pnpm workspaces

**Status:** Accepted  
**Date:** 2026-10-03

## Context

PRD v1 §13 proposed Go or Python for core and React for web. Using two languages would duplicate the event types, schema validation and SDK.

## Decision

Core, SDK, protocol bindings and web UI are written in TypeScript. Core runs on Node.js ≥ 22.13. The repo is a pnpm workspace. Tests use Vitest. The JSON Schema in `protocol/` stays the language-neutral source of truth, so capabilities can still be written in any language.

## Consequences

One toolchain for contributors. Performance-critical pieces can later move to Rust/Go behind the same event protocol.
