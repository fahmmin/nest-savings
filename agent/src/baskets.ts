import { CASH } from './types.ts'
import type { Basket } from './types.ts'

export const BTC = 'vBTC_vUSDC'
export const NVDA = 'vNVDA_vUSDC'
export const DEFI = 'vDEFIssi_vUSDC'

const WEEK = 24 * 7

export const BASKETS: Basket[] = [
  {
    id: 'steady',
    name: 'Steady',
    blurb: 'Mostly dollars, with a small slice of Bitcoin and Nvidia for growth.',
    risk: 'Low',
    weights: { [CASH]: 60, [BTC]: 25, [NVDA]: 15 },
    cadenceHours: WEEK,
  },
  {
    id: 'balanced',
    name: 'Balanced',
    blurb: 'A mix of dollars, Bitcoin, Nvidia and a basket of crypto apps, so no single bet decides your result.',
    risk: 'Medium',
    weights: { [CASH]: 30, [BTC]: 35, [NVDA]: 20, [DEFI]: 15 },
    cadenceHours: WEEK,
  },
  {
    id: 'growth',
    name: 'Growth',
    blurb: 'All in on growth: Bitcoin, Nvidia and crypto apps. Bigger swings, up and down.',
    risk: 'High',
    weights: { [BTC]: 45, [NVDA]: 35, [DEFI]: 20 },
    cadenceHours: WEEK,
  },
  {
    id: 'crypto',
    name: 'Crypto Core',
    blurb: 'Mostly Bitcoin plus a basket of crypto apps. For people who want crypto and can stomach big drops.',
    risk: 'High',
    weights: { [BTC]: 70, [DEFI]: 30 },
    cadenceHours: WEEK,
  },
]

export function basketById(id: string): Basket | undefined {
  return BASKETS.find((b) => b.id === id)
}

/** Plain name for a symbol, for sentences. */
export const NAMES: Record<string, string> = { [CASH]: 'dollars', [BTC]: 'Bitcoin', [NVDA]: 'Nvidia', [DEFI]: 'crypto apps' }
