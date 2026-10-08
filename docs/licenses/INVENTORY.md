# Dependency & Asset Licence Inventory

Every distributed dependency and asset must be GPL-3.0 compatible. Update this file in the same pull request that adds or removes one.

## npm dependencies

`pnpm licenses list --prod` (2026-10-08): 10 production packages that ship, all GPL-3.0 compatible. `pnpm audit` reports no known vulnerabilities, production or development.

| Package              | Used by   | Licence      | Compatible |
| -------------------- | --------- | ------------ | ---------- |
| ajv                  | protocol  | MIT          | ✅         |
| ajv-formats          | protocol  | MIT          | ✅         |
| fast-deep-equal      | ajv       | MIT          | ✅         |
| fast-uri             | ajv       | BSD-3-Clause | ✅         |
| json-schema-traverse | ajv       | MIT          | ✅         |
| require-from-string  | ajv       | MIT          | ✅         |
| ws                   | core/api  | MIT          | ✅         |
| react                | apps/web  | MIT          | ✅         |
| react-dom            | apps/web  | MIT          | ✅         |
| scheduler            | react-dom | MIT          | ✅         |

### Development dependencies (not distributed)

| Package                | Licence    |
| ---------------------- | ---------- |
| typescript             | Apache-2.0 |
| vitest                 | MIT        |
| tsx                    | MIT        |
| prettier               | MIT        |
| happy-dom              | MIT        |
| @types/node            | MIT        |
| @types/ws              | MIT        |
| vite                   | MIT        |
| @vitejs/plugin-react   | MIT        |
| @testing-library/react | MIT        |
| @testing-library/dom   | MIT        |
| @types/react           | MIT        |
| @types/react-dom       | MIT        |

## Built-in platform modules

| Module                                              | Licence |
| --------------------------------------------------- | ------- |
| Node.js (`node:sqlite`, `node:http`, `node:crypto`) | MIT     |

## Desktop shell (apps/desktop)

Direct dependencies:

| Package                | Kind    | Licence        | Compatible |
| ---------------------- | ------- | -------------- | ---------- |
| tauri                  | runtime | MIT/Apache-2.0 | ✅         |
| tauri-plugin-autostart | runtime | MIT/Apache-2.0 | ✅         |
| tauri-plugin-opener    | runtime | MIT/Apache-2.0 | ✅         |
| parking_lot            | runtime | MIT/Apache-2.0 | ✅         |
| serde, serde_json      | runtime | MIT/Apache-2.0 | ✅         |
| tauri-build            | build   | MIT/Apache-2.0 | ✅         |
| tempfile               | test    | MIT/Apache-2.0 | ✅         |
| @tauri-apps/cli        | dev     | MIT/Apache-2.0 | ✅         |

### Transitive crates (scanned 2026-10-08)

`cargo metadata` over `Cargo.lock` lists 458 third-party crates, counting every target (macOS, Windows, Linux, Android), so it is a superset of what any one build ships. Every licence expression offers at least one GPL-3.0-compatible option. Counting by expression: about 400 are MIT and/or Apache-2.0 (including the `OR Zlib`, `OR Unlicense` and LLVM-exception variants), 18 Unicode-3.0, plus a few Zlib, BSD-3-Clause, ISC, 0BSD and CC0-1.0.

Worth naming:

| Crate                                                                    | Licence                                | Note                                                                                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors` | MPL-2.0                                | File-level copyleft; compatible with GPL-3.0 (MPL-2.0 §3.3). We do not modify them. Their source must stay available, which `Cargo.lock` plus crates.io satisfies. |
| `r-efi` (2 versions)                                                     | MIT OR Apache-2.0 OR LGPL-2.1-or-later | UEFI only; we use the MIT option.                                                                                                                                  |

Licence texts are not yet bundled with release artefacts; that belongs to packaging (Phase 20).

### Vulnerability scan (2026-10-08)

`cargo audit` (RustSec database, 1,294 advisories): no vulnerabilities. Two warnings, both in the Linux GTK stack Tauri uses on Linux only (`cargo tree --target aarch64-apple-darwin -i <crate>` finds neither):

- `proc-macro-error 1.0.4`: unmaintained (RUSTSEC-2024-0370)
- `glib 0.18.5`: unsound `VariantStrIter` (RUSTSEC-2024-0429)

They need to be revisited before a Linux build ships. CI runs `cargo audit` on every change so a new advisory shows up.

## Artwork, audio and fonts

| Asset                                             | Author               | Licence      | Provenance                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | -------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fawkes (`pet/assets/src/fawkes.ts`)               | Phoenix contributors | CC BY-SA 4.0 | Original artwork drawn for Phoenix in Phase 10 as hand-written SVG paths and CSS keyframes; no traced, generated-from-reference or third-party material (no Codex Pets or Coucou assets). Replaces the Phase 07 placeholder. Previews: `docs/images/fawkes-states.svg`, `docs/images/fawkes-states-still.svg` (generated by `scripts/render-fawkes-gallery.ts`, same licence) |
| Fawkes app icon (`apps/desktop/src-tauri/icons/`) | Phoenix contributors | CC BY-SA 4.0 | Rendered from the Fawkes artwork above on a plain tile, then converted with `tauri icon`.                                                                                                                                                                                                                                                                                     |
