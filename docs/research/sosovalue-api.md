# SoSoValue OpenAPI: developer reference

Source: https://sosovalue-1.gitbook.io/sosovalue-api-doc (fetched 2026-11-11 via `.md` pages, `llms.txt`, `llms-full.txt`).
Machine-readable spec (OpenAPI 3.0, 71 endpoints): https://static.sosovalue.com/2026/09/11/933b5fac-1903-4d07-9dd5-10751290fc34.json

## 1. Basics

| Item | Value |
|---|---|
| Base URL (v1, everything below) | `https://openapi.sosovalue.com/openapi/v1` |
| Base URL (v3, US equities + perps, not covered here) | `https://openapi.sosovalue.com/openapi/v3` |
| Auth | Header `x-soso-api-key: YOUR_API_KEY` on **every** request (OAS global `ApiKeyAuth`, no per-endpoint exemptions) |
| Methods | All endpoints are `GET` |
| Rate limit (v1 doc page) | Per API key: **100,000 requests / month**, **20 requests / minute** |
| Rate-limit headers (v1 doc page) | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix ms) |
| 429 body | `{"code": 42901, "message": "Rate limit exceeded", "details": {"limit": 20, "window": "60s", "retry_after": 45}}` (the error table says code `402901`) |
| Get a key | Sign in at `https://sosovalue.com/developer/dashboard` -> **Apply your Key** -> fill form -> wait for approval (dashboard shows pending/approved). Not instant. |
| Free tier | Docs name no tiers or prices. 100k/month + 20/min are the only published limits; the v3 section says "exact values depend on your plan". |

### Keyless access
None. Every endpoint requires the key. Verified live (2026-11-11): `GET /openapi/v1/indices` with no key returns HTTP 401
`{"code":400101,"message":"API Key is invalid or does not exist"}`. Same 401 for `/market/overview`, `/news/hot`, `/etfs/summary-history`.

### CORS
Live preflight from `Origin: http://localhost:3000` returns `access-control-allow-origin` echoing the origin and `access-control-allow-headers: x-soso-api-key`, so browser calls technically work. Still proxy through a backend so the key is not shipped to clients.

### Response envelope
```json
{ "code": 0, "message": "success", "data": ... }
```
`data` is an object, a bare array (time series), a paginated object `{ "list": [...], "page": 1, "page_size": 20, "total": 542 }`, or `null`.
Errors: `{ "code": 400001, "message": "...", "details": {...} }`.

| code | HTTP | meaning |
|---|---|---|
| 400001 | 400 | Invalid parameter format |
| 400002 | 400 | Missing required parameter |
| 400003 | 400 | Invalid parameter value (enum) |
| 400101 | 401 | Invalid API key |
| 400102 | 401 | API key expired |
| 400301 | 403 | Key has no access to endpoint |
| 400401 | 404 | Resource not found |
| 400402 | 404 | Endpoint not found |
| 402901 | 429 | Too many requests |
| 500001 / 500301 | 500 / 503 | Server error / maintenance |

### Conventions
- Timestamps: UTC **milliseconds**. Money: USD. Field names: snake_case.
- Pagination params (paginated endpoints): `page` (default 1), `page_size` (default 20, max 100).
- Time-window params: `start_time`, `end_time` (ms), `limit`. Ascending order; paginate with last `timestamp + 1`.
- History caps: klines only `1d`, last **3 months**; ETF history last **1 month**; feed time filters last **7 days**.

## 2. Endpoints

### (a) ETF flows

#### GET /etfs/summary-history  (aggregate daily net inflow, all ETFs for one asset)
| param | req | notes |
|---|---|---|
| symbol | yes | `BTC` `ETH` `SOL` `LTC` `HBAR` `XRP` `DOGE` `LINK` `AVAX` `DOT` (case-insensitive) |
| country_code | yes | `US` or `HK` (HK only has `BTC` `ETH` `SOL`) |
| start_date / end_date | no | date string; last 1 month only |
| limit | no | default 50, max 300 |

```json
[
  { "date": "2024-04-12", "total_net_inflow": -55066297.0, "total_value_traded": 4706120449.0,
    "total_net_assets": 56216535367.0, "cum_net_inflow": 13534833596.095 }
]
```
Newest first; non-trading days excluded. `symbol=FOO` -> `400003`; `symbol=LTC&country_code=HK` -> `400001`.

#### GET /etfs  (ETF list for an asset)
Params: `symbol` (req), `country_code` (req), same enums.
```json
[ { "ticker": "IBIT", "name": "iShares Bitcoin Trust", "exchange": "NASDAQ" } ]
```

#### GET /etfs/{ticker}/market-snapshot  (latest settled figures for one ETF)
```json
{ "date": "2024-04-12", "ticker": "IBIT", "sponsor_fee": 0.003, "net_inflow": 3000000, "cum_inflow": 400000000,
  "net_assets": 5000000, "mkt_price": 14.5, "prem_dsc": -0.0001, "value_traded": 4441000000, "volume": 322302 }
```

#### GET /etfs/{ticker}/history  (per-ETF daily history)
Params: `ticker` (path, req), `start_date`, `end_date` (last 1 month).
```json
[ { "date": "2026-08-11", "ticker": "IBIT", "net_inflow": 50195600, "cum_inflow": 61171454223.66,
    "net_assets": 47337319120, "currency_share": 0.005, "prem_dsc": -0.0001, "value_traded": 910925300, "volume": "910925300" } ]
```
Gotchas: today's row exists with `net_inflow` / `cum_inflow` / `net_assets` = `null` (T+1 settlement); skip null rows or start at `data[1]`. `volume` here is a string equal to `value_traded` (known bug); use the snapshot `volume` for shares.

#### Longer ETF history via Analysis charts (see (e))
`/analyses/total_crypto_spot_btc_eth_etf_fund_flow_1d` (keys `bitcoin_daily_total_net_inflow`, `ethereum_daily_total_net_inflow`, `bitcoin_price`, `ethereum_price`), up to 500 rows, not capped at 1 month. Also `total_crypto_spot_etf_fund_flow`, `total_crypto_eth_etf_fund_flow`, `total_crypto_hk_btc_etf_fund_flow`, `total_crypto_hk_eth_etf_fund_flow`.

### (b) News feeds

#### GET /news  (main feed, paginated)
| param | req | notes |
|---|---|---|
| category | no | `1` news, `2` research, `3` institution, `4` insights/KOL, `7` announcement/official, `13` crypto stock news |
| language | no | `en` (default) `zh` `tc` `ja` `vi` `es` `pt` `ru` `tr` `fr` |
| currency_id | no | filter by currency (**ID, not symbol**; resolve via `/currencies`) |
| project_id | no | project filter |
| page / page_size | no | default 1 / 20, max 100 |
| start_time / end_time | no | ms, filters `release_time`, last 7 days only |

```json
{ "page": 1, "page_size": 20, "total": 335, "list": [ {
  "id": "news1", "source_link": "https://sosovalue.xyz/research/...", "original_link": "https://...",
  "release_time": 1677151845000, "title": "...", "content": "<p>HTML...</p>",
  "author": "Author Name", "author_description": "...", "author_avatar_url": "https://...",
  "impression_count": 432, "like_count": 6, "reply_count": 0, "retweet_count": 3,
  "category": 1, "feature_image": "https://...", "nick_name": "...", "is_blue_verified": 1, "verified_type": "Business",
  "matched_currencies": [ { "id": "1673723677362319866", "full_name": "BITCOIN", "name": "BTC" } ],
  "tags": ["ETF", "SEC"],
  "media_info": [ { "soso_url": "https://...", "original_url": "", "short_url": "https://t.co/...", "type": "photo" } ],
  "quote_info": null } ] }
```
Notes: `title` can be `null`; `content` is HTML (sanitize); `matched_currencies` may be empty; max 200 items per request.

#### GET /news/pick  (featured / editorially curated, paginated)
| param | req | notes |
|---|---|---|
| page | **yes** | >= 1 |
| page_size | **yes** | **20-100** |
| language | no | as above |
| category | no | comma-separated ints |

No `currency_id` filter. Items match `/news` minus `original_link` and engagement counts (`impression_count`, `like_count`, `reply_count`, `retweet_count`).

#### GET /news/hot  (hot news clusters, paginated)
Params: `page`, `page_size`, `language`, `start_time`, `end_time` (7 days). Item: `{ "id": 123456, "source_link": "...", "release_time": ..., "title": "...", "content": "<p>...</p>" }`.

#### GET /news/search
Params: `keyword` (**req**; title/content/tags, English fuzzy match only), `page`, `page_size`, `category`, `language`. Items as `/news` plus `type` and `highlight: { "title": "<em>Bitcoin</em> ...", "content": "..." }`.

Filter news by coin: `GET /currencies` -> find `currency_id` for `btc` -> `GET /news?currency_id=...`. Or filter client-side on `matched_currencies[].name`.

### (c) SoSoValue indices (SSI)

#### GET /indices
No params. Bare array of tickers: `["ssimag7", "ssilayer1"]`. MAG7.ssi = `ssimag7` (echoed back as `ssiMAG7`; path is case-insensitive).

#### GET /indices/{index_ticker}/constituents
```json
[ { "currency_id": "1673723677362319867", "symbol": "btc", "weight": 0.31 } ]
```
`weight` is 0-1.

#### GET /indices/{index_ticker}/market-snapshot
```json
{ "price": 20.93, "change_pct_24h": -0.0016, "roi_7d": 0.0056, "roi_1m": 0.062, "roi_3m": 0.275, "roi_1y": 0.15, "ytd": -0.243 }
```
All changes are decimal fractions (`-0.0016` = -0.16%). Missing fields are omitted, not null.

#### GET /indices/{index_ticker}/klines
Params: `interval` (**req**, only `1d`), `start_time`, `end_time`, `limit` (default 100, max 500). Last 3 months only.
```json
[ { "timestamp": 1710000000000, "open": 123, "high": 130, "low": 120, "close": 125 } ]
```

### (d) Currencies

#### GET /currencies
No params, returns all: `[ { "currency_id": "1673723677362319867", "symbol": "eth", "name": "Ethereum" } ]`. Cache it; it is the symbol -> id map every other currency endpoint needs.

#### GET /currencies/{currency_id}
Profile: `currency_id`, `name`, `symbol`, `introduction`, `sector[] {id,name}`, `icon`, `contracts[] {chain,contract}`, `white_paper`, `first_issue_time`, `explorers[]`, `community {twitter,reddit}`, `significant_events[] {time,content}`.

#### GET /currencies/{currency_id}/market-snapshot  (price)
```json
{ "price": 458.0, "change_pct_24h": -0.12, "turnover_24h": 4381082458.0, "turnover_rate": 0.123,
  "high_24h": 208.32, "low_24h": 195.14, "marketcap": 98187284636.4, "fdv": 119634407517.24,
  "max_supply": "593383314", "total_supply": "593383314", "circulating_supply": "487043475",
  "ath": 295.83, "ath_date": "1737244800000", "down_from_ath": "", "cycle_low": 175.89,
  "cycle_low_date": "1738540800000", "up_from_cycle_low": "", "marketcap_rank": 4 }
```
One coin per call (no batch price endpoint in v1). Supplies are strings.

#### GET /currencies/{currency_id}/klines
Params: `interval` (**req**, `1d` only), `start_time`, `end_time`, `limit` (default 100, max 500). Last 3 months.
`[ { "timestamp": 1710000000000, "open": 123, "high": 130, "low": 120, "close": 125, "volume": 100000 } ]`

Others (not detailed): `/currencies/{currency_id}/token-economics`, `/supply`, `/pairs`, `/fundraising`.

### (e) Sector, sentiment, market overview

#### GET /currencies/sector-spotlight
No params.
```json
{ "sector": [ { "name": "btc", "change_pct_24h": -0.0012, "marketcap_dom": 0.58 } ],
  "spotlight": [ { "name": "perpdex", "change_pct_24h": -0.0012 } ] }
```
`change_pct_24h` is a decimal fraction.

#### GET /market/overview
No params.
```json
{ "total_market_cap": "2280614829402.85", "total_market_cap_change_pct": "0.6", "total_volume_24h": "40122576829.22",
  "eth_gas_gwei": "0.126601389", "btc_gas_sat_vb": "6", "as_of": 1785911722870 }
```
All values are strings. `total_market_cap_change_pct` is a **percentage** ("0.6" = 0.6%), unlike other endpoints. Any field except `as_of` may be omitted. Cached 30 s.

#### GET /analyses  and  GET /analyses/{chart_name}  (30 historical charts incl. sentiment)
`/analyses` lists `{ chart_name, time_field, fields[] {name,type} }`.
`/analyses/{chart_name}` params: `limit` (default 100, max 500, silently clamped). **Do not pass `start_time` / `end_time`: they return `[]` (known bug).**
```json
[ { "timestamp": "1785859200000", "crypto_fear_&_greed_index": 27 } ]
```
Newest first; `timestamp` is a string; null series are omitted per row, so the newest row may lack your key (scan for the first row that has it).

Useful `chart_name`s:
- Sentiment: `fgi_indicator` (`crypto_fear_&_greed_index`, 0-100), `ahr_999_indicator` (`ahr999`, `btc_price`)
- Derivatives: `futures_open_interest`, `funding_rate`, `binance_btcusdt_futures_long_short_ratio_1h|4h|12h|1d` (`long/short_ratio`, ...)
- Market: `total_crypto_market_cap`, `altcoin_market_cap_volume`, `usd_inflows_into_cryptocurrency_markets` (`btc_etf_inflows`, `eth_etf_inflows`, ...), `stablecoin_total_market_cap`
- ETF flows: `total_crypto_spot_btc_eth_etf_fund_flow_1d`, `total_crypto_spot_etf_fund_flow`, `total_crypto_eth_etf_fund_flow`

Series keys contain `&`, `/`, parentheses, leading digits: always use bracket access (`row["crypto_fear_&_greed_index"]`).

### Other v1 modules (not detailed)
Crypto stocks `/crypto-stocks...`, BTC treasuries `/btc-treasuries`, `/btc-treasuries/{ticker}/purchase-history`, fundraising `/fundraising/projects`, macro `/macro/events`, `/macro/rates`, `/macro/fomc-probabilities`, podcast `/podcasts/{podcastId}`.

## 3. Gotchas checklist
1. No keyless access; key approval is manual, so apply early.
2. 20 req/min is tight: cache aggressively (snapshots update every 30 s-1 min) and proxy server-side.
3. Rate-limit docs disagree: the v1 page lists `X-RateLimit-*` headers and code `42901`; the error table says `402901`; the v3 section says no rate-limit headers are returned. Handle HTTP 429 generically.
4. ETF history: last 1 month only, newest row unsettled (nulls). Use analysis charts for longer series.
5. Percent formats vary: decimal fraction (index, sector) vs percentage (`/market/overview`). Currency `change_pct_24h` is described as "percentage" with example `-0.12`; verify against live data.
6. News `currency_id` filter takes an internal ID, not a symbol. Doc examples reuse ID `1673723677362319867` for both ETH and BTC, so resolve IDs from `/currencies` live.
7. `/news/pick` requires `page` and `page_size` (min 20).
8. Large numbers come as strings or high-precision decimals; parse with a decimal library where precision matters.
9. Analysis charts: `start_time` / `end_time` silently return `[]`; use `limit` only.

## 4. Quick test
```bash
curl -sS -H 'x-soso-api-key: YOUR_KEY' 'https://openapi.sosovalue.com/openapi/v1/etfs/summary-history?symbol=BTC&country_code=US&limit=30'
curl -sS -H 'x-soso-api-key: YOUR_KEY' 'https://openapi.sosovalue.com/openapi/v1/indices/ssimag7/market-snapshot'
curl -sS -H 'x-soso-api-key: YOUR_KEY' 'https://openapi.sosovalue.com/openapi/v1/news/pick?page=1&page_size=20'
curl -sS -H 'x-soso-api-key: YOUR_KEY' 'https://openapi.sosovalue.com/openapi/v1/analyses/fgi_indicator?limit=30'
```
