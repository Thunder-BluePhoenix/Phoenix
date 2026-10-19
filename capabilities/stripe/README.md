# capabilities/stripe

Recent Stripe payments and a balance summary, **read-only by construction** ([Phase 67](../../docs/phases/phase-67-service-integrations.md)). The manifest declares one command, `status`, with side effect `read`; the client is a service-kit `ReadOnlyClient` (GET only, no method that sends a body) and the capability never imports `ServiceClient`. Nothing here can create a charge, refund, capture, payout or anything else that moves money; a test asserts the manifest has no command with side effect `write`, `execute`, `external` or `production`, and that no source file imports `ServiceClient`.

| Event                      | When                                                | Fawkes                                        |
| -------------------------- | --------------------------------------------------- | --------------------------------------------- |
| `stripe.payment.succeeded` | a charge with status `succeeded` appears or settles | SUCCESS for 8 s "Payment received: 20.00 USD" |
| `stripe.payment.failed`    | a charge with status `failed` appears or settles    | WARNING for 60 s "Payment failed: 20.00 USD"  |

Payload: `charge_id`, `amount` (smallest unit), `currency`, `livemode`, optional `failure_code` and `url` (https receipt). Phoenix never reads customer names, e-mail addresses, card details, descriptions or metadata, so they cannot reach an event, log or the knowledge graph. Pending charges and refunds make no event.

## Setup

Create a **restricted API key with read-only access** (Developers, API keys, _Create restricted key_; Charges: Read, Balance: Read; everything else None). Do not use your secret key. Phoenix does not try to detect key types: a key with write access would still only ever be used for GET, but a restricted read-only key keeps that true even if this code had a bug.

```sh
TOKEN=$(cat .phoenix/dev/session.token)
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
read -rs STRIPE_KEY && printf '{"value":"%s"}' "$STRIPE_KEY" | \
  curl "${H[@]}" -d @- http://127.0.0.1:4870/api/capabilities/stripe/secrets/restricted_key
curl "${H[@]}" -X POST -d '{}' http://127.0.0.1:4870/api/capabilities/stripe/enable
```

Secret `restricted_key` is sent only as a Bearer credential to Stripe's own API origin (`https://api.stripe.com`). There is deliberately **no `base_url` setting**: anyone holding the API token could otherwise point the stored key at a host of their choosing. Tests inject a local mock through the code-only `apiUrl` creation option. The key is never logged or put in an error, event or config. Config: `poll_ms` (15000+, default 60000). Enabling grants `network` and `external_api`.

## `status` command (read)

`{configured, items[], summary, balance}`: counts and per-currency totals of the latest 25 charges (succeeded / failed / pending) and the available and pending balance, formatted by the currency's decimals.

## How it behaves

- **No history replay**; **pauses** while no client is connected; 401 waits 5 minutes (health _degraded_), 429/`Retry-After` honoured, other failures back off. Redirects are not followed, responses over 2 MiB are cut off, malformed entries skipped. Health is _degraded_ without a key.

## Unverified

Written from Stripe's public API reference. **Nothing has been run against the real Stripe API** (test mode or live); the mock in `testing/mock-stripe.ts` encodes my reading of the docs. Whether a restricted key limited to Charges and Balance reads is accepted by `GET /v1/charges` and `GET /v1/balance` has not been checked.
