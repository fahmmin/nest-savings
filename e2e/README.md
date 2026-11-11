# Nest wallet E2E (Synpress + MetaMask)

End-to-end tests that drive the real app with a real MetaMask extension. Playwright starts its own agent
(port 8791, fresh database each run) and app (port 5175), so your dev servers are never touched.

- `@synthetixio/synpress` 4.1.1 (MetaMask 11.9.1) and `@playwright/test` 1.48.2, the versions Synpress pins.
  4.1.2 downloads MetaMask 13, which its helpers cannot drive yet (synpress#1308).
- `npm run cache` uses `scripts/build-cache.ts` because the Synpress cache CLI refuses to run on Windows.

## Practice-money suite (no funds needed)

Wallet: anvil's public test mnemonic only (account #0 `0xf39F…2266`), with ValueChain testnet (chain 138565) added.
Trades are practice money, priced and filled against the live SoDEX testnet order books.

```sh
npm install
npx playwright install chromium   # once
npm run cache                     # once: builds .cache-synpress/<hash>
npm test                          # headed. Headless: HEADLESS=true npm test
```

| Test | What it proves |
|---|---|
| landing and baskets | landing renders live demo cards from the agent; four baskets with SoSoValue reasons |
| crash replay | works with no wallet; the result changes with the crash-size slider |
| demo account | `#home-<demo>` and settings are read-only, with no sign buttons |
| rejecting the signature | MetaMask "Reject" shows an error and the agent has no account for the wallet |
| sign-up | one free signature opens a $1,000 practice account in Growth with a 20% floor, and the agent buys Bitcoin |
| activity | every note shows "Verified" (signature checked in the browser); the log has the link and a rebalance |
| settings | floor 20 → 25, pause and resume, each one MetaMask signature, all recorded in the agent |
| no double sign-up | a wallet that already has an account cannot sign up again |

## Walkthrough video

```sh
HEADLESS=true npm run walkthrough   # → demo/nest-walkthrough.mp4, captioned, fails if it is 3 minutes or longer
```

Records the real app, agent and MetaMask: landing, baskets, crash replay, practice sign-up with one signature,
My money, verified activity, a signed settings change, and the public demo account. Needs ffmpeg on PATH.

## Live SoDEX testnet run (your wallet, real testnet orders)

This registers Nest's trade-only key on **your** SoDEX testnet account and lets the agent place real testnet
orders. Run it yourself; it needs your wallet's seed, which stays in `e2e/.env` on your machine (gitignored).

Before you start:
1. A wallet SoDEX has whitelisted for testnet, with test tokens claimed at testnet.sodex.com.
2. At least 50 vUSDC moved to its **Spot** account (the test checks this first).

```sh
cp .env.example .env    # fill E2E_SEED and E2E_ROOT_SECRET (64 random hex chars); E2E_LIVE=1 is already set
npm run cache:live      # builds a MetaMask profile with your wallet. After changing the seed: npm run cache:live -- --force
npm run test:live
```

The test:
1. checks the wallet has an activated Spot account with ≥ 50 vUSDC,
2. signs the EIP-712 `addPermissionedAPIKey` (permissions 14: cancel, withdraw and transfer off) in MetaMask,
3. reads the key back from the SoDEX gateway (not from Nest) and checks the permissions and public key,
4. waits for the agent's first rebalance to fill and finds that order id in SoDEX's own order history,
5. pauses Nest with one more signature, so nothing keeps trading after the run.

The key stays registered on SoDEX (it expires after 90 days). Keep `E2E_ROOT_SECRET`: the agent can only use that
key while it derives it from the same secret.
