# Chat approvals (`chat-approvals`)

Slack and Discord approval cards with Allow / Deny, Teams notify-only with a signed link into Phoenix.
Off by default, per project. Design, security model, runtime hooks and limitations:
[docs/chat-approvals.md](../../docs/chat-approvals.md). Simulated evidence only.

| Command        | Side effect | Notes                                                       |
| -------------- | ----------- | ----------------------------------------------------------- |
| `status`       | `read`      | Ready providers and enabled projects. No secrets.           |
| `post_pending` | `external`  | Cards for pending requests switched on for chat. Confirms.  |
| `post_digest`  | `external`  | Counts-only digest to providers with `digest` on. Confirms. |

Layout: `src/binding.ts` (owner mapping, single-use tokens, hash recheck, replay), `src/slack.ts`,
`src/discord.ts` (provider signature + payloads), `src/teams.ts` (webhook + signed link),
`src/cards.ts` (sanitized text), `src/digest.ts` (opt-in scheduled digest: formatter, quiet hours, verdict), `src/config.ts`, `src/index.ts` (capability). `test/rig.ts` is a pretend Core and
signers built from runtime-generated keys.
