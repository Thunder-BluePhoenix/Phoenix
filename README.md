# 🐦‍🔥 Phoenix

**Phoenix is the platform. Fawkes is the pet.**

Phoenix is an open-source developer companion. It connects your developer tools, meetings and AI agents through a common event and capability architecture, and shows what is happening through **Fawkes**, an animated pet that lives in your navbar or floats on your desktop.

The first capability is **Kage**, which handles meeting capture, transcription, summaries and archiving.

> Status: early development (Stage 1 — MVP Foundation). See the [phase tracker](docs/phases/TRACKER.md).

## Repository layout

| Path            | Contents                                                                     |
| --------------- | ---------------------------------------------------------------------------- |
| `protocol/`     | Versioned event schema, error codes, Fawkes state definitions                |
| `core/`         | Phoenix Core: config, logging, persistence, event bus, state engine, runtime |
| `pet/`          | Fawkes runtime, states, animations and assets                                |
| `apps/`         | `web` (navbar + Pet Panel) and `desktop` (floating Fawkes)                   |
| `sdk/`          | Capability SDK                                                               |
| `capabilities/` | First-party capabilities (Kage, Git, terminal)                               |
| `docs/`         | Vision, phases, ADRs, contracts                                              |

## Getting started

Requires Node.js ≥ 22.13 and pnpm 10.

```sh
pnpm install
pnpm check        # typecheck + lint + tests
pnpm dev:core     # start Phoenix Core on http://127.0.0.1:4870
curl http://127.0.0.1:4870/api/health
```

## Documentation

- [Vision documents](docs/vision/)
- [Phase tracker](docs/phases/TRACKER.md)
- [Architecture decisions](docs/adr/README.md)
- [Event protocol v1](docs/protocol/events-v1.md)

## License

Phoenix is free software, licensed under the [GNU General Public License v3.0](LICENSE).
