// The four baskets as defined in docs/design.md and agent/src/baskets.ts (base weights, no live tilt).
// Used by the landing page when the agent is down and by scripts/mock-agent.ts. Live data always wins over this.
import type { Basket } from './types.ts'

const BTC = 'vBTC_vUSDC', NVDA = 'vNVDA_vUSDC', DEFI = 'vDEFIssi_vUSDC', CASH = 'vUSDC'
const WEEK = 24 * 7

export const BASKETS: Basket[] = [
  { id: 'steady', name: 'Steady', risk: 'Low', cadenceHours: WEEK, weights: { [CASH]: 60, [BTC]: 25, [NVDA]: 15 },
    blurb: 'Mostly dollars, with a small slice of Bitcoin and Nvidia for growth.' },
  { id: 'balanced', name: 'Balanced', risk: 'Medium', cadenceHours: WEEK, weights: { [CASH]: 30, [BTC]: 35, [NVDA]: 20, [DEFI]: 15 },
    blurb: 'A mix of dollars, Bitcoin, Nvidia and a basket of crypto apps, so no single bet decides your result.' },
  { id: 'growth', name: 'Growth', risk: 'High', cadenceHours: WEEK, weights: { [BTC]: 45, [NVDA]: 35, [DEFI]: 20 },
    blurb: 'All in on growth: Bitcoin, Nvidia and crypto apps. Bigger swings, up and down.' },
  { id: 'crypto', name: 'Crypto Core', risk: 'High', cadenceHours: WEEK, weights: { [BTC]: 70, [DEFI]: 30 },
    blurb: 'Mostly Bitcoin plus a basket of crypto apps. For people who want crypto and can stomach big drops.' },
]
