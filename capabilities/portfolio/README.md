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

## Networks (16): public GET endpoints, native coin only, no key

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

Not included: **Solana** (its public interface is JSON-RPC over POST; the rule is GET only), and
tokens (ERC-20 etc.): only each network's native coin. A network's default host can be replaced under
`endpoints` (a self-hosted indexer); these requests carry no key or other credential (they are plain
unauthenticated GETs of a public address), so the override moves nothing secret. `endpoints` has no entry
for exchanges. Addresses are validated per network against a strict pattern before
they reach a URL.

## Exchanges (5): documented balance endpoint is a GET with a read-only key

binance (`/api/v3/account`), bybit (`/v5/account/wallet-balance`), okx (`/api/v5/account/balance`),
kucoin (`/api/v1/accounts`), gate (`/api/v4/spot/accounts`). Requests are signed with HMAC from
`node:crypto`. **Excluded: Kraken** (private endpoints are POST-only) and Coinbase Advanced Trade (JWT
signing needs a vendor library or a long ES256 flow; not attempted). Spot/funding balances only.

Secrets (named, stored in the OS secret store): `binance_key`, `binance_secret`, `bybit_key`,
`bybit_secret`, `okx_key`, `okx_secret`, `okx_passphrase`, `kucoin_key`, `kucoin_secret`,
`kucoin_passphrase`, `gate_key`, `gate_secret`. A key is sent only to that exchange's own host. There is
deliberately no config setting to change it: anyone holding the API token could otherwise point a stored
exchange key at a host of their choosing. Tests inject a local mock through the code-only
`exchangeUrls` creation option.

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

No real network, indexer, exchange or price service was contacted. Response shapes and the five signing
recipes come from each service's public documentation and are exercised only against a local mock
that recomputes each signature from the same recipe, so a documentation misreading would pass here and
fail live. Free public indexers rate-limit; 16 networks x several addresses may be throttled (shown as
a failed source). `xrpscan` field naming (`xrpBalance`) and Blockscout's `coin_balance` are the shapes
most worth checking first.
