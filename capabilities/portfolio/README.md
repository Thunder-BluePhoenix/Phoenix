# Portfolio capability (Phase 68)

A **read-only** view of crypto balances. **Display only. Phoenix never places or moves anything.**

## Read-only by construction

- The only HTTP client used is service-kit's `ReadOnlyClient`, which has no method that sends a body.
  `ServiceClient` (which can POST) is not imported; `fetch` is not called directly.
- Public addresses (config, not secrets) and read-only exchange keys only. Create exchange keys with the
  read permission only and every other permission off.
- `test/read-only.test.ts` reads every file in `src/` and fails on any non-GET method, any use of
  `ServiceClient`, any raw `fetch`/`node:http`, and any identifier naming an order, transfer, withdrawal,
  deposit, trade, swap or broadcast. `test/read-only-scan.test.ts` checks the scanner itself.
- A source that fails is listed with a fixed message; remote text is never shown or logged.

## Networks (16): public GET endpoints, native coin (tokens on 11, from your watch list), no key

| id                                                  | Network            | Endpoint (default)                                             |
| --------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| btc                                                 | Bitcoin            | blockstream.info `/api/address/{a}`                            |
| ltc, doge                                           | Litecoin, Dogecoin | api.blockcypher.com `/v1/{chain}/main/addrs/{a}/balance`       |
| eth, optimism, base, arbitrum, polygon, gnosis, etc | EVM chains         | `{chain}.blockscout.com/api/v2/addresses/{a}`                  |
| xrp                                                 | XRP Ledger         | api.xrpscan.com `/api/v1/account/{a}`                          |
| xlm                                                 | Stellar            | horizon.stellar.org `/accounts/{a}`                            |
| algo                                                | Algorand           | mainnet-api.algonode.cloud `/v2/accounts/{a}`                  |
| ton                                                 | TON                | toncenter.com `/api/v2/getAddressBalance?address=`             |
| trx                                                 | TRON               | api.trongrid.io `/v1/accounts/{a}`                             |
| atom                                                | Cosmos Hub         | cosmos-rest.publicnode.com `/cosmos/bank/v1beta1/balances/{a}` |

Not included: **Solana** (its public interface is JSON-RPC over POST; the rule is GET only). Tokens are
read only on the networks listed under "Tokens" below. A network's default host can be replaced under
`endpoints` (a self-hosted indexer); these requests carry no key or other credential (they are plain
unauthenticated GETs of a public address), so the override moves nothing secret. `endpoints` has no entry
for exchanges. Addresses are validated per network against a strict pattern before
they reach a URL.

## Tokens (ERC-20, TRC-20, Stellar and Algorand assets, Cosmos denominations)

Read-only, from the **owner's watch list only** (config `tokens`, by network id, at most 10 per network,
only for addresses already listed under `networks`). Each entry is `{contract, symbol, decimals}`; all three
are the owner's. No response, chat text or token list can add a token, change its symbol or its decimals.
No new host: the same indexer, with the wallet address only, as for the native coin; the watch list is
applied locally.

| Networks                                            | Request (GET)                                                 | Contract / asset identifier           |
| --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------- |
| eth, optimism, base, arbitrum, polygon, gnosis, etc | `{chain}.blockscout.com/api/v2/addresses/{a}/token-balances`  | `0x` + 40 hex, lower-cased (ERC-20)   |
| trx                                                 | `api.trongrid.io/v1/accounts/{a}` (`data[0].trc20`)           | Base58Check, checksum verified (0x41) |
| xlm                                                 | `horizon.stellar.org/accounts/{a}` (`balances`)               | `CODE:ISSUER`, always 7 decimals      |
| algo                                                | `mainnet-api.algonode.cloud/v2/accounts/{a}` (`assets`)       | numeric asset id                      |
| atom                                                | `cosmos-rest.publicnode.com/cosmos/bank/v1beta1/balances/{a}` | bank denom, e.g. `ibc/HASH`           |

- Own source `<id>:tokens` in `sources`: a token problem never marks the native coin unreadable.
- Strict parsing: amounts are integer strings (a JSON number only for Algorand, refused unless a safe
  integer), at most 78 digits and below 2^256, parsed with `BigInt`; negative, fractional, exponent, hex,
  object, HTML and over-2 MB answers fail the source with a fixed, secret-free message. Where the service
  reports decimals (Blockscout) they must equal yours or the source fails. A watched contract listed
  twice, an NFT row, or a Cosmos answer with a next page also fail rather than guess.
- Amounts: `amount` is the number rounded half-up to 8 decimals (integer arithmetic), `amount_exact` the
  exact decimal text (no float digit loss). Same no-redirect, 15 s, GET-only client as everything else.
- **Tokens are never priced.** A symbol is not an identity, so no token gets a price, value or 24 h
  figure, even when its symbol equals a priced coin; it counts in `unpriced` and not in the total.
- Contract check is format (plus Base58Check for TRON). The mixed-case EIP-55 checksum needs Keccak-256,
  which `node:crypto` does not provide, and no dependency was added, so it is not verified.
- **Not supported (and why):** btc, ltc, doge (no token layer); xrp (issued currencies need `account_lines`,
  a JSON-RPC POST; a keyless GET shape was not established); ton (jetton balances: the documented
  keyless route could not be confirmed to be GET-only and unthrottled). They are skipped, not guessed.

## Exchanges (6): documented balance endpoint is a GET with a read-only key

binance (`/api/v3/account`), bybit (`/v5/account/wallet-balance`), okx (`/api/v5/account/balance`),
kucoin (`/api/v1/accounts`), gate (`/api/v4/spot/accounts`): requests signed with HMAC from
`node:crypto`. coinbase (Advanced Trade `GET /api/v3/brokerage/accounts?limit=250`): see below.
**Excluded: Kraken** (private endpoints are POST-only). Spot/funding balances only.

Secrets (named, stored in the OS secret store): `binance_key`, `binance_secret`, `bybit_key`,
`bybit_secret`, `okx_key`, `okx_secret`, `okx_passphrase`, `kucoin_key`, `kucoin_secret`,
`kucoin_passphrase`, `gate_key`, `gate_secret`, `coinbase_key`, `coinbase_secret`. A key is sent only to
that exchange's own host. There is deliberately no config setting to change it: anyone holding the API
token could otherwise point a stored exchange key at a host of their choosing. Tests inject a local mock
through the code-only `exchangeUrls` creation option.

### Coinbase (ES256 JWT, `src/coinbase-jwt.ts`)

Coinbase has no shared secret: each request carries `Authorization: Bearer <JWT>` signed with an ECDSA
P-256 private key. Phoenix builds it with `node:crypto` only (no dependency, no vendor SDK):

- Header `{alg: "ES256", kid: <key name>, nonce: <16 random bytes, hex>, typ: "JWT"}`; claims
  `{sub: <key name>, iss: "cdp", nbf, exp: nbf + 120, uri: "GET api.coinbase.com/api/v3/brokerage/accounts"}`.
  The signature is the raw 64-byte `r||s` (`dsaEncoding: "ieee-p1363"`), base64url.
- **A new token for every request** (new nonce, `nbf` from the capability clock), 120 s lifetime, never
  cached. The `uri` claim is built from the fixed method, host and path in code, never from input, and
  excludes the query string; `buildJwt` has no method parameter, so a non-GET token cannot be made.
- `coinbase_key` is the key _name_ (`organizations/{org}/apiKeys/{key}`, validated against that shape);
  `coinbase_secret` is the PEM private key. Create the key in the CDP portal with the **ECDSA** signature
  algorithm (Ed25519 is not supported by this API) and the **View** permission only. The portal shows
  the PEM on one line with `\n` escapes, and a stored secret must be one line, so that form is
  accepted and turned back into newlines. Before use the key is parsed and refused unless it is an
  unencrypted EC key on P-256 (Ed25519, RSA, P-384, secp256k1, public keys, encrypted keys, garbage and
  anything over 4096 characters are all refused with a fixed message that never echoes the key).
- One GET to the exchange host (`api.coinbase.com`, https only; loopback http only for tests). The
  response is read through `ReadOnlyClient` (2 MB cap), parsed defensively: only `ACCOUNT_TYPE_CRYPTO`
  and `ACCOUNT_TYPE_VAULT` accounts, `available_balance + hold` as plain decimal strings, a currency
  code of letters and digits, unknown fields ignored. Fiat and futures accounts are not counted. If the
  response says there is another page (`has_next` not `false`) the source fails rather than showing a
  partial total; only the portfolio's own accounts are read, so 250 accounts is the limit.
- `test/coinbase.test.ts` generates a P-256 key pair at test time; its mock verifies signature, exact
  header and claim sets, `kid = sub`, nonce uniqueness, `exp - nbf = 120`, the clock window and the
  `uri`, and refuses an expired, altered or replayed token.

## Prices, 24h change, sparklines

One public GET per cycle to **CoinGecko's `coins/markets`** (`sparkline=true`,
`price_change_percentage=24h`, no key): current USD price, 24h percentage, and the 7-day hourly series
(~168 points, down-sampled to 42, first and last kept). `price_url` may point at a compatible service.
These are third-party estimates; **Phoenix does not verify them**. An asset with no entry in
`SYMBOLS` (`src/prices.ts`) has no price and is counted in `unpriced`, never guessed. If the price
service fails, balances still show and `prices` appears as a failed source.

## Rounding rule (amount.ts)

Half away from zero (with a one-ulp nudge so 1.005 gives 1.01). Coin amounts: 8 decimals. Prices: 8
significant digits. Holding value = amount x price rounded to cents. **Total = sum of the rounded holding
values**, so the rows add up. 24h change = value-weighted over holdings that have a figure, 2 decimals.
The aggregate sparkline adds amount x price per point and exists only when every priced holding has a
full series.

## Commands and events

`snapshot` (read) returns the cached result of the last check. `portfolio.snapshot.updated`
(ephemeral, `sensitive`) tells an open window to reload; its payload holds counts only, no amounts.
Checks run while Phoenix is open (default every 5 min, minimum 60 s), back off on failure, and the
snapshot lives in memory only (nothing is stored on disk).

## Not verified

No real network, indexer, exchange or price service was contacted. Response shapes and the six signing
recipes come from each service's public documentation and are exercised only against a local mock
that recomputes or verifies each signature from the same reading (Coinbase: the mock verifies the ES256
JWT with the public key of a pair generated at test time, but the header, claims and `uri` rule are
Phoenix's reading of Coinbase's documentation; real Coinbase and a real CDP key were never used, so whether
Coinbase accepts the token, and whether the query string really stays out of `uri`, is unconfirmed),
so a documentation misreading would pass here and
fail live. Free public indexers rate-limit; 16 networks x several addresses may be throttled (shown as
a failed source). `xrpscan` field naming (`xrpBalance`) and Blockscout's `coin_balance` are the shapes
most worth checking first.
