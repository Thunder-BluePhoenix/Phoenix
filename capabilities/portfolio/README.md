# Portfolio capability (Phase 68)

A **read-only** view of crypto balances. **Display only. Phoenix never places or moves anything.**

## Read-only by construction

- The only HTTP client used is service-kit's `ReadOnlyClient`, which has no method that sends a body,
  except the one pinned Solana client in `src/solana.ts` (see "Solana"). `ServiceClient` (which can POST)
  is not imported; `fetch` is called directly in that one file only.
- Public addresses (config, not secrets) and read-only exchange keys only. Create exchange keys with the
  read permission only and every other permission off.
- `test/read-only.test.ts` reads every file in `src/` and fails on any non-GET method, any use of
  `ServiceClient`, any raw `fetch`/`node:http`, and any identifier naming an order, transfer, withdrawal,
  deposit, trade, swap or broadcast. `test/read-only-scan.test.ts` checks the scanner itself.
- A source that fails is listed with a fixed message; remote text is never shown or logged.
- One deliberate exception to GET-only: the pinned Solana `getBalance` client (see "Solana").

## Networks (16 GET + Solana): public GET endpoints, native coin (tokens on 13, from your watch list), no key

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

**Solana** is the 17th network and the one exception to "GET only": see "Solana" below. Tokens are
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
| xrp                                                 | `api.xrpscan.com/api/v1/account/{a}/trustlines2` (`lines`)    | `CURRENCY:ISSUER`, issuer checksummed |
| ton                                                 | `toncenter.com/api/v3/jetton/wallets?owner_address={a}`       | jetton master, raw or friendly form   |

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
- **XRP Ledger issued currencies** (`xrplTokens`): XRPSCAN's keyless `GET /api/v1/account/{a}/trustlines2`, a
  rippled `account_lines` answer. Only the watched `CURRENCY:ISSUER` pairs are read (3-character or 40-hex
  currency, issuer verified with the XRPL Base58Check). The decimals are yours; a balance with more
  fractional digits than yours, a negative or exponent balance, a duplicate line or a next-page `marker`
  fails the source. The XRPL Data API v2 (data.ripple.com) is deprecated and is not used. Same host as the
  native XRP balance. Sources: <https://docs.xrpscan.com/api-documentation/account/trustlines>,
  <https://docs.xrpscan.com/api-documentation/pricing> (free tier 10,000 requests per day),
  <https://xrpl.org/docs/references/data-api>. XRPSCAN's API is licensed CC BY-NC-SA 4.0: personal,
  non-commercial use.
- **TON jettons** (`tonJettons`): TON Center API v3 `GET /api/v3/jetton/wallets?owner_address=...`
  (`exclude_zero_balance=true`, `limit=1000`). Documented as usable without an API key but limited to **1
  request per second**, so the requests of this network (native balance, jettons, each address) are issued
  one at a time at least 1.1 s apart (`minIntervalMs`). A full page of 1000 wallets fails the source rather
  than undercount. A watched master may be given as `0:<64 hex>` or in the 48-character friendly form
  (mainnet tags only, CRC-16 checked); it is matched as raw. Sources: <https://docs.ton.org/api/v3/jettons/get-jetton-wallets>,
  <https://docs.ton.org/api/v3/authentication>, <https://docs.ton.org/api/rate-limit>.
- **Not supported (and why):** btc, ltc, doge (no token layer). Solana tokens (SPL) are not read.

## Solana (the one POST: `src/solana.ts`)

**Decision taken by the implementer under a conservative reading, reversible by deleting `src/solana.ts`
and its call sites (`index.ts`, `collect.ts`, `test/solana.test.ts`).** The owner had left open whether a
POST-only read call may be allowed for one method. Solana's public interface is JSON-RPC over POST only.
`SolanaBalanceClient` is a separate client, not `ReadOnlyClient` and not `ServiceClient`, that can send
exactly one request:

- Host pinned in code: `https://api.mainnet.solana.com/` (Solana Labs' public mainnet endpoint; its docs
  say it is rate-limited, 100 requests per 10 s per IP, and "not intended for production applications").
  There is no setting, argument or `endpoints` entry that changes it.
- Body from a constant template: `{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["<address>"]}`.
  The one slot holds an address that decoded as exactly 32 base58 bytes (32-44 characters). No caller JSON is
  serialised (`JSON.stringify` does not appear in the file), so no other method, parameter or path can be
  expressed. The method is named once, the path is `/`.
- No redirects, 15 s timeout, 64 KiB response cap, lamports parsed as `BigInt` from the response text
  (above 2^53 a double loses digits) and range-checked to a u64, an `error` object or a mismatched `id`
  refused, fixed secret-free messages. The Solana host sees your listed Solana addresses and your IP.
- `test/solana.test.ts` proves address-injection attempts never produce a request, the body equals the
  template, the file names one method, one POST, one `fetch` and one host, and the hostile responses fail.
  `test/read-only.test.ts` skips this one file by name; `solana.test.ts` scans it instead and allows only the
  POST and `fetch` findings.
- Config: `networks.sol` (up to 10 addresses). SOL is priced like any native coin. No SPL tokens.

## Exchanges (6): documented balance endpoint is a GET with a read-only key

binance (`/api/v3/account`), bybit (`/v5/account/wallet-balance`), okx (`/api/v5/account/balance`),
kucoin (`/api/v1/accounts`), gate (`/api/v4/spot/accounts`): requests signed with HMAC from
`node:crypto`. coinbase (Advanced Trade `GET /api/v3/brokerage/accounts?limit=250`): see below.
**Excluded: Kraken** (private endpoints are POST-only and need signed API keys: a different risk class from Solana's keyless `getBalance`). Spot/funding balances only.

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
a failed source; TON Center allows 1 request per second without a key). The XRPSCAN `trustlines2`, TON
Center `jetton/wallets` and Solana `getBalance` shapes were written from documentation and never run
live. `xrpscan` field naming (`xrpBalance`) and Blockscout's `coin_balance` are the shapes
most worth checking first.

## Indexer limits and terms (docs/service-terms.md)

Read on 2026-11-10 from public pages; not legal advice. BlockCypher documents 100 requests per hour and 3 per second for
the free tier, so Litecoin/Dogecoin requests are spaced 400 ms apart on one shared gate and the delay between checks is
raised so one cycle never exceeds 100 per hour (`src/budget.ts`, `maxRequestsPerHour` in `networks.ts`). XRPSCAN
documents 10,000 requests a day on its free tier and licenses its API under CC BY-NC-SA 4.0 (personal, non-commercial
display only); Stellar Horizon's default is 3,600 an hour. Solana's public RPC allows 40 requests per 10 s per method:
`getBalance` calls are spaced 300 ms apart. Blockscout's public hosts, Blockstream and TronGrid document no number
(TronGrid and Blockscout say keyless scripted access may be refused); those defaults are unchanged. `test/service-limits.test.ts`
fails if a default or spacing goes below these.
