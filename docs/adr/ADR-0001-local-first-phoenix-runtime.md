# ADR-0001: Local-first Phoenix runtime

**Status:** Accepted  
**Date:** 2026-10-03

## Context

Phoenix must stay useful without cloud services, and meeting/project data is sensitive (PRD v2.0 §3.1, §19).

## Decision

Phoenix Core runs on the user's machine. All state lives in a local data directory. Cloud services (AI providers, sync) are optional capabilities that are off by default and need explicit permission.

## Consequences

Offline operation is the default path. Remote features must be added as opt-in capabilities, never as core requirements.
