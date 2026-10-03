# ADR-0017: Kage API contract v0

**Status:** Accepted (amended 2026-10-04)  
**Date:** 2026-10-03

## Context

Phoenix integrates Kage rather than duplicating it (PRD v2.0 §11). The v0 draft assumed Kage exposed start/stop, archive and delete endpoints and pushed webhooks. Checking Kage's actual backend and Meet bot showed it has none of these: meetings appear when the extension or bot uploads audio after the call, status is polled, and auth is a per-user `X-API-Key`.

## Decision

Integrate Kage as it is today (`docs/contracts/kage-api-v0.md`, v0.1):

- Poll `GET /api/meetings` with the user's API key (kept in OS secret storage) and map status changes to `kage.*` events.
- `meeting.start` runs Kage's own Meet bot after explicit per-use confirmation; Phoenix shows RECORDING while it records.
- No stop command (the bot cannot stop gracefully yet). Archive and delete act on Phoenix's copy only.
- Request microphone access no longer: the bot captures system audio, so the capability asks only for `meeting_recording` and `network`.

## Consequences

- No changes to Kage were needed for v0.1.
- Stop, delete-in-Kage, transcript segments and webhooks are listed as asks for Kage in the contract; the adapter adopts them when Kage ships them.
