// Crash replay: a synthetic, deterministic price path run through the real decide(), with and without the floor.
import { CASH } from './types.ts'
import type { Balances, Basket, Books, Filters, Replay, ReplayPoint, Symbol, UserRecord } from './types.ts'
import { basketById } from './baskets.ts'
import { decide, nextHwm, valueOf } from './decide.ts'
import { targetWeights } from './weights.ts'

const STEPS = 60
const CRASH_FROM = 15
const CRASH_TO = 35
const START_USD = 1000
const DAY_MS = 86_400_000
const START_PRICE: Record<Symbol, number> = { vBTC_vUSDC: 70000, vNVDA_vUSDC: 180, vDEFIssi_vUSDC: 1.2 }

/** Price multiplier at step t: gentle wobble, a linear crash of dropPct over 20 steps, then recovery of 40% of the fall. */
function multiplier(t: number, drop: number, phase: number): number {
  const wobble = 1 + 0.01 * Math.sin(t * 0.9 + phase)
  if (t < CRASH_FROM) return wobble
  if (t <= CRASH_TO) return wobble * (1 - (drop * (t - CRASH_FROM)) / (CRASH_TO - CRASH_FROM))
  return wobble * (1 - drop + 0.4 * drop * ((t - CRASH_TO) / (STEPS - 1 - CRASH_TO)))
}

export function replay(basketId: Basket['id'], floorPct: number, dropPct: number): Replay {
  const basket = basketById(basketId)
  if (!basket) throw new Error(`unknown basket ${basketId}`)
  const drop = Math.min(95, Math.max(0, dropPct)) / 100
  const risky = Object.keys(basket.weights).filter((s) => s !== CASH)
  const target = targetWeights(basket, [])
  const filters: Filters = Object.fromEntries(
    risky.map((s, i) => [s, { symbol: s, id: i + 1, tickSize: 0.0001, stepSize: 0.000001, minQuantity: 0, minNotional: 5, pricePrecision: 4, quantityPrecision: 6 }]),
  )
  const priceAt = (t: number) => Object.fromEntries(risky.map((s, i) => [s, +(START_PRICE[s] * multiplier(t, drop, i)).toFixed(4)]))

  const p0 = priceAt(0)
  const hodl: Balances = { [CASH]: START_USD * ((basket.weights[CASH] ?? 0) / 100) }
  for (const s of risky) hodl[s] = (START_USD * basket.weights[s]) / 100 / p0[s]

  const balances: Balances = { [CASH]: START_USD }
  const user: UserRecord = {
    address: '0x0000000000000000000000000000000000000000', accountId: 0, mode: 'paper', status: 'active',
    hwmUsd: START_USD, apiKeyName: 'replay', linkedAt: new Date(0).toISOString(), basketId, floorPct,
  }
  const points: ReplayPoint[] = []
  let exitedAt: number | undefined

  for (let t = 0; t < STEPS; t++) {
    const price = priceAt(t)
    const books: Books = Object.fromEntries(risky.map((s) => [s, { bid: price[s], ask: price[s], bidSz: 1e12, askSz: 1e12 }]))
    const now = new Date(t * DAY_MS)
    const d = decide({ user, balances, books, filters, target, now })
    let event = t === 0 ? `Start: ${basket.name} basket with $1,000` : t === CRASH_FROM ? 'Prices start falling' : t === CRASH_TO + 1 ? 'Prices start to recover' : undefined
    if (d.kind !== 'hold') {
      for (const o of d.orders) {
        const q = Number(o.quantity)
        const px = price[o.symbol]
        balances[o.symbol] = (balances[o.symbol] ?? 0) + (o.side === 'buy' ? q : -q)
        balances[CASH] += o.side === 'buy' ? -q * px : q * px
      }
      if (d.kind === 'exit') {
        user.status = 'exited'
        exitedAt = t
        event = 'Safety floor hit: Nest moved everything to dollars'
      } else user.lastRebalanceAt = now.toISOString()
    }
    const withFloor = valueOf(balances, books)
    user.hwmUsd = nextHwm(user.hwmUsd, withFloor)
    points.push({ t, price, withFloor: round2(withFloor), without: round2(valueOf(hodl, books)), ...(event ? { event } : {}) })
  }
  const last = points[points.length - 1]
  return { basketId, floorPct, startUsd: START_USD, points, ...(exitedAt !== undefined ? { exitedAt } : {}), savedUsd: round2(last.withFloor - last.without) }
}

const round2 = (x: number) => Math.round(x * 100) / 100
