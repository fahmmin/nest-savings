# Nest: design

A savings app for beginners. Pick a ready-made basket, set a safety floor, and an agent keeps the
basket on target on SoDEX. The agent can buy and sell for you but can never withdraw. Built for the
SoSoValue Buildathon, Wave 3 (deadline 27 Nov 2026, 15:00 UTC). Runs on SoDEX testnet.

## Who and why

People who want to put savings to work and have no idea where to start (user's words). They do not
want to pick coins, read charts or trust a stranger with their money. Today the choices are a
centralised exchange "earn" product (custodial) or a copy-trading bot (holds a withdraw-capable key).

## Goals

1. Pick one of four ready-made baskets in plain words, fund it, done.
2. One safety setting: "if my savings drop X%, move everything to dollars". Optional cash-out date.
3. The agent rebalances to target weights, tilted by SoSoValue data (ETF flows, news), and explains
   every change in one plain sentence that cites its source.
4. Trust without trusting us: funds stay in the user's own SoDEX account; the agent's key is a SoDEX
   *permissioned API key* with WITHDRAW and TRANSFER disabled. The app shows how to verify it.
5. Every agent decision is signed by the agent key and kept in a public log (honest track record).
6. Judges can see everything without a wallet: a public demo account and a crash replay.

## Non-goals

- No leverage, no perps for users. Spot only.
- No pooled fund, no fund token, no smart contract custody.
- No custom basket builder (four baskets only). No mainnet trading.

## Anti-goals (failure even if it works)

- A beginner losing money to liquidation or to an agent that can withdraw.
- Jargon on the main screens ("rebalance drift band", "IOC").
- Claims the demo cannot back (fake numbers presented as real, "TEE secured" when it is not).

## Parts

- `app/`: Vite + React 19 + wagmi/viem. Landing page ported from Cairn (`mumbai/cairn-finance`):
  its sky hero, palette, Manrope/Inter, phone frames, basket cards. App screens ported from Open
  Bucket (`mumbai/monad/open-bucket/app`): its shell, sidebar, stat cards, chips, notices, toasts,
  Discover / My money / Bucket / Crash screens, recoloured to Cairn's palette.
- `agent/`: Node 24, TypeScript run directly, `viem` only, `node:http`, `node:sqlite`, `node --test`.
  Same shape as Open Bucket's agent.
- No contracts.

## How it works

1. **Baskets** (`agent/src/baskets.ts`): four fixed baskets of SoDEX testnet spot symbols with base
   weights, a risk label, and a rebalance cadence. Exact symbols depend on what testnet lists.
2. **Signals** (`agent/src/signals.ts`): from SoSoValue, BTC and ETH spot ETF daily net flows and
   recent news per currency. Output per asset: tilt in [-1, 1] plus the cited source.
3. **Target weights** (`agent/src/weights.ts`): base weight + tilt × max tilt (5 points), clamped,
   renormalised. Pure function, unit tested.
4. **Decide** (`agent/src/decide.ts`): given balances, prices, targets, user rules, high-water mark
   and time, return one of `hold | rebalance(orders) | exit(orders)`. Pure, unit tested. Exit wins
   over rebalance. Rebalance only when an asset drifts more than 5 points or on cadence.
5. **Keys** (`agent/src/keys.ts`): the agent derives one API key per user from a root secret
   (HMAC(root, userAddress)), so no private keys are stored. Root secret comes from env locally, or
   from a TEE key-derivation call when running in an enclave (Phala dstack). The app labels which.
6. **Linking**: the app asks the agent for this user's API public key, the user signs SoDEX's
   `addPermissionedAPIKey` with permissions = WITHDRAW + TRANSFER + CANCEL disabled, the app submits
   it, and the agent can now trade for that account only.
7. **Loop**: every N seconds, for each linked user: read balances and prices, decide, place spot
   orders signed with that user's API key, sign and store a log entry.
8. **API** for the app: baskets, signals, a user's state and log, linking, demo endpoints.

## Decided details (from the research in `docs/research/`)

- **Baskets** (only symbols with two-sided testnet books; MAG7.ssi, ETH and SOL have no sellers):
  - Steady (Low): vUSDC 60, vBTC 25, vNVDA 15. Rebalance weekly.
  - Balanced (Medium): vUSDC 30, vBTC 35, vNVDA 20, vDEFIssi 15. Weekly.
  - Growth (High): vBTC 45, vNVDA 35, vDEFIssi 20. Weekly.
  - Crypto Core (High): vBTC 70, vDEFIssi 30. Weekly.
- **Signals** (SoSoValue OpenAPI, `x-soso-api-key`, cache ≥ 10 min, 20 req/min limit):
  - BTC spot ETF net flow, sum of last 5 settled days (skip the newest unsettled row) → vBTC tilt
    = clamp(sum / $1B, -1, 1).
  - ETH spot ETF net flow, same → vDEFIssi tilt = clamp(sum / $300M, -1, 1).
  - Fear & Greed (`fgi_indicator`): above 75 → CASH tilt +1, below 25 → CASH tilt -0.5, else 0.
  - Top featured news headline per asset is cited in explanations (no sentiment scoring).
  - Without `SOSO_API_KEY`, the agent uses recorded fixtures and `/health` says `sosoData: fixtures`.
- **Target** = base + tilt × 5 points, only for assets in the basket (CASH tilt only if CASH is in
  it), floor at 0, renormalise to 100.
- **Rebalance** when any asset is > 5 points off target or the cadence elapsed. Orders below 5 USDC
  are skipped. Sells first, then buys. IOC limit at best ask × 1.005 (buy) or best bid × 0.995
  (sell), rounded to tick/step; skip a side whose book is empty and log it in plain words.
- **Safety floor**: high-water mark of value in USDC; exit when value ≤ hwm × (1 − floorPct/100) or
  `cashOutAt` passed. Exit sells everything to vUSDC, status → `exited`, no more trades until the
  user resumes in settings (which resets hwm to current value).
- **Exchange adapters**: `live` signs and sends to SoDEX testnet with the user's derived API key;
  `paper` keeps balances in sqlite and fills against the *live* testnet top of book. Both implement
  one interface. The public demo account is paper. Live needs a whitelisted, funded testnet wallet.
- **Keys**: per-user API key = HMAC-SHA256(root, "api:" + lowercase address); journal key =
  HMAC(root, "journal"). Root from `/var/run/dstack.sock` key derivation when present (enclave),
  else `ROOT_SECRET` env (dev). Never logged, never stored.
- **Settings changes** require an EIP-191 signature from the owner (see `docs/api.md`).
- **Storage**: `node:sqlite`, file `agent/data/nest.db`.
- **Contract**: `agent/src/types.ts` and `docs/api.md`.

## What is left to the builder

Endpoint shapes, sqlite schema, polling interval, component structure, exact copy.
