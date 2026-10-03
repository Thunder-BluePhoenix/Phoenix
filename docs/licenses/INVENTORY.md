# Dependency & Asset Licence Inventory

Every distributed dependency and asset must be GPL-3.0 compatible. Update this file in the same pull request that adds or removes one.

## Runtime dependencies

| Package     | Used by  | Licence | Compatible |
| ----------- | -------- | ------- | ---------- |
| ajv         | protocol | MIT     | ✅         |
| ajv-formats | protocol | MIT     | ✅         |
| ws          | core/api | MIT     | ✅         |

## Development dependencies (not distributed)

| Package     | Licence    |
| ----------- | ---------- |
| typescript  | Apache-2.0 |
| vitest      | MIT        |
| tsx         | MIT        |
| prettier    | MIT        |
| happy-dom   | MIT        |
| @types/node | MIT        |
| @types/ws   | MIT        |

## Built-in platform modules

| Module                                              | Licence |
| --------------------------------------------------- | ------- |
| Node.js (`node:sqlite`, `node:http`, `node:crypto`) | MIT     |

## Artwork, audio and fonts

| Asset                                                | Author               | Licence      | Provenance                                                                                    |
| ---------------------------------------------------- | -------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| Placeholder Fawkes (`pet/assets/src/placeholder.ts`) | Phoenix contributors | CC BY-SA 4.0 | Original, drawn for Phoenix in Phase 07. Preview: `docs/images/fawkes-placeholder-states.png` |
