# Security Policy

Phoenix can record meetings, read repositories and (later) act through AI agents, so security and privacy issues are treated as high priority.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository. Include steps to reproduce and the affected version or commit.

You can expect an acknowledgement within 7 days.

## Scope

Of particular interest:

- Recording or capture without a visible indicator or explicit permission
- Capability permission bypass or privilege escalation
- Secrets appearing in logs, events or diagnostic exports
- Event injection or spoofing of another capability's `source`
- Prompt injection leading to unauthorised actions
- Core reachable from the network without explicit configuration

## Security principles

See the threat model in the Full System PRD (§18) and [ADR-0006](docs/adr/ADR-0006-permission-gateway-before-tool-execution.md), [ADR-0015](docs/adr/ADR-0015-topology-local-only-core-bound-to-loopback.md), [ADR-0016](docs/adr/ADR-0016-capability-authentication.md).
