import type { Basket, Signal, Symbol } from './types.ts'

/** Max shift of one asset's weight, in percentage points, at tilt ±1. */
export const MAX_TILT = 5

/** Base weights tilted by signals (assets in the basket only), floored at 0, renormalised to 100, rounded to 0.1. */
export function targetWeights(basket: Basket, signals: Signal[]): Record<Symbol, number> {
  const w: Record<Symbol, number> = { ...basket.weights }
  for (const s of signals) {
    if (s.symbol in w) w[s.symbol] = Math.max(0, w[s.symbol] + Math.min(1, Math.max(-1, s.tilt)) * MAX_TILT)
  }
  const total = Object.values(w).reduce((a, b) => a + b, 0)
  if (total <= 0) return { ...basket.weights }
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round((v / total) * 1000) / 10]))
}
