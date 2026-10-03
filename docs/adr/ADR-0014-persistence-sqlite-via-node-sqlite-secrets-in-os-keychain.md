# ADR-0014: Persistence: SQLite via node:sqlite; secrets in OS keychain

**Status:** Accepted  
**Date:** 2026-10-03

## Context

Local history, settings and meeting metadata need durable storage with no server (PRD v1 §13).

## Decision

Use SQLite through Node's built-in `node:sqlite` module (no native build step). Secrets are never stored in SQLite: the DB holds only a credential reference, and values live behind a `SecretStore` interface (OS keychain implementation added with the first capability that needs credentials).

## Consequences

Schema changes go through numbered migrations.
