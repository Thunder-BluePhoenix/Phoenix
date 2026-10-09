# Contributing to Phoenix

Thanks for helping build Phoenix and Fawkes.

## Ground rules

- **Licence.** Phoenix is GPL-3.0. By contributing you agree your contribution is licensed under GPL-3.0-or-later. Every source file starts with:

  ```ts
  // SPDX-License-Identifier: GPL-3.0-or-later
  // Copyright (C) 2026 Phoenix contributors
  ```

- **Dependencies and assets.** Any new dependency, font, image, animation or model must be GPL-3.0 compatible and added to [`docs/licenses/INVENTORY.md`](docs/licenses/INVENTORY.md) in the same pull request.
- **No copied character assets.** Do not copy Codex Pets, Coucou or any other proprietary character art. Fawkes artwork must be original.
- **No secrets.** Never commit tokens or credentials; never put secrets in event payloads or logs.

## Workflow

1. Pick a phase from the [tracker](docs/phases/TRACKER.md) and read its phase file.
2. Make changes with tests.
3. Run `pnpm check` (typecheck, licence headers, formatting, tests), then `scripts/secret-scan.sh` (needs Docker). It runs the same pinned gitleaks scan CI runs, over history and over your uncommitted files. Build fake credentials in tests at runtime (`protocol/testing/fake-secrets.ts`); a token-shaped literal fails CI even when it is obviously fake.
4. Open a pull request that references the phase and lists which exit criteria it covers.

## Architecture changes

Significant decisions are recorded as ADRs in [`docs/adr/`](docs/adr/README.md). Changing an accepted decision needs a new ADR that supersedes it.

## Event schema changes

`protocol/schemas/event-v1.schema.json` is frozen. Backwards-compatible additions (new optional fields) are allowed; breaking changes require a new major version and compatibility tests.
