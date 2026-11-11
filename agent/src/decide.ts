import { CASH } from './types.ts'
import type { Balances, Books, Decision, Filters, Order, Symbol, UserRecord } from './types.ts'
import { basketById, NAMES } from './baskets.ts'

export const DRIFT_POINTS = 5
export const MIN_NOTIONAL = 5
const BUY_SLIP = 1.005
const SELL_SLIP = 0.995
const EPS = 1e-9

export interface DecideInput { user: UserRecord; balances: Balances; books: Books; filters: Filters; target: Record<Symbol, number>; now: Date }

const nameOf = (s: Symbol) => NAMES[s] ?? s.split('_')[0]
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const pct = (x: number) => `${+x.toFixed(1)}%`
export const usd = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Conservative mark: best bid (what we could sell for); falls back to ask only when nobody bids, so an empty book does not fake a crash. */
const markOf = (s: Symbol, books: Books) => (s === CASH ? 1 : books[s]?.bid || books[s]?.ask || 0)

export function valueOf(balances: Balances, books: Books): number {
  return Object.entries(balances).reduce((v, [s, q]) => v + q * markOf(s, books), 0)
}

/** High-water mark after seeing `valueUsd`. */
export const nextHwm = (hwmUsd: number, valueUsd: number) => Math.max(hwmUsd, valueUsd)

function decimals(step: number): number {
  let d = 0
  while (d < 18 && Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) > EPS) d++
  return d
}

/** n·step as a canonical decimal string: no exponent, no trailing zeros ("0.0001", "73860.5", "3"). */
export function toDecimal(n: number, step: number): string {
  const s = (n * step).toFixed(decimals(step))
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
export const stepsDown = (x: number, step: number) => Math.floor(x / step + EPS)
export const stepsUp = (x: number, step: number) => Math.ceil(x / step - EPS)

/** An IOC order, a plain-words skip reason, or null when it is too small to bother (silent). */
function makeOrder(side: 'buy' | 'sell', s: Symbol, qty: number, books: Books, filters: Filters, budget = Infinity): Order | string | null {
  const f = filters[s]
  if (!f) return `Nest has no trading rules for ${nameOf(s)} yet, so it skipped that ${side === 'buy' ? 'buy' : 'sale'}.`
  const ref = side === 'buy' ? books[s]?.ask : books[s]?.bid
  if (!ref) return side === 'buy' ? `No one is selling ${nameOf(s)} right now, so Nest skipped that buy.` : `No one is buying ${nameOf(s)} right now, so Nest skipped that sale.`
  const pN = side === 'buy' ? stepsUp(ref * BUY_SLIP, f.tickSize) : stepsDown(ref * SELL_SLIP, f.tickSize)
  const price = pN * f.tickSize
  if (price <= 0) return null
  const qN = stepsDown(Math.min(qty, budget / price), f.stepSize)
  const q = qN * f.stepSize
  const notional = q * ref
  if (qN <= 0 || q < f.minQuantity - EPS || notional < Math.max(MIN_NOTIONAL, f.minNotional)) return null
  return { symbol: s, side, quantity: toDecimal(qN, f.stepSize), price: toDecimal(pN, f.tickSize), notional: Math.round(notional * 100) / 100 }
}

const hold = (reason: string): Decision => ({ kind: 'hold', reason })

export function decide({ user, balances, books, filters, target, now }: DecideInput): Decision {
  if (user.status === 'exited') return hold('Your savings are in dollars. Nest will not trade until you resume in settings.')
  if (user.status === 'paused') return hold('You paused Nest, so it is not trading.')

  const value = valueOf(balances, books)
  const hwm = nextHwm(user.hwmUsd, value)
  const floorUsd = hwm * (1 - user.floorPct / 100)
  const floorHit = hwm > 0 && value <= floorUsd
  const cashOut = !!user.cashOutAt && now.getTime() >= Date.parse(user.cashOutAt)

  if (floorHit || cashOut) {
    const orders: Order[] = []
    const notes: string[] = []
    for (const [s, q] of Object.entries(balances)) {
      if (s === CASH || !(q > 0)) continue
      const o = makeOrder('sell', s, q, books, filters)
      if (typeof o === 'string') notes.push(o)
      else if (o) orders.push(o)
    }
    const lead = floorHit
      ? `Your savings fell to ${usd(value)}, at or below your safety floor of ${usd(floorUsd)} (${user.floorPct}% under the high of ${usd(hwm)}), so Nest is moving everything to dollars.`
      : 'Your cash-out date has arrived, so Nest is moving everything to dollars.'
    return { kind: 'exit', reason: floorHit ? 'floor' : 'cashOutDate', text: [lead, ...notes].join(' '), orders }
  }

  if (value < MIN_NOTIONAL) return hold('There is not enough money in the basket to trade yet.')

  const gaps = [...new Set([...Object.keys(target), ...Object.keys(balances)])].map((s) => {
    const cur = (((balances[s] ?? 0) * markOf(s, books)) / value) * 100
    return { s, cur, tgt: target[s] ?? 0, gap: cur - (target[s] ?? 0) }
  })
  // Biggest gap; on a tie, name the asset rather than dollars.
  const worst = gaps.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) + 1e-6 || (a.s === CASH && Math.abs(b.gap) > Math.abs(a.gap) - 1e-6) ? b : a))
  const cadenceMs = (basketById(user.basketId)?.cadenceHours ?? 168) * 3_600_000
  const due = !user.lastRebalanceAt || now.getTime() - Date.parse(user.lastRebalanceAt) >= cadenceMs
  const drifted = Math.abs(worst.gap) > DRIFT_POINTS
  if (!drifted && !due) return hold(`Your basket is on target (nothing is more than ${pct(Math.abs(worst.gap))} off), so Nest made no trades.`)

  const sells: Order[] = []
  const buys: Order[] = []
  const notes: string[] = []
  const take = (o: Order | string | null, into: Order[]) => (typeof o === 'string' ? notes.push(o) : o && into.push(o))

  let budget = balances[CASH] ?? 0
  for (const g of gaps) {
    if (g.s === CASH || g.gap <= 0) continue
    const held = balances[g.s] ?? 0
    const qty = g.tgt === 0 ? held : Math.min(held, (g.gap / 100) * value / markOf(g.s, books))
    take(makeOrder('sell', g.s, qty, books, filters), sells)
  }
  // Worst case the sells fill at their limit price.
  for (const o of sells) budget += Number(o.quantity) * Number(o.price)
  for (const g of gaps.filter((g) => g.s !== CASH && g.gap < 0).sort((a, b) => a.gap - b.gap)) {
    const ask = books[g.s]?.ask || 0
    const o = makeOrder('buy', g.s, ask ? (-g.gap / 100) * value / ask : 0, books, filters, budget)
    take(o, buys)
    if (o && typeof o !== 'string') budget -= Number(o.quantity) * Number(o.price)
  }

  if (!sells.length && !buys.length) {
    return hold(notes.length ? `Nest wanted to rebalance, but: ${notes.join(' ')}` : 'Your basket is close enough to target; every change would be under $5, so Nest made no trades.')
  }
  const lead = drifted ? `${cap(nameOf(worst.s))} ${worst.gap > 0 ? 'grew' : 'fell'} to ${pct(worst.cur)} of your basket (target ${pct(worst.tgt)})` : 'Weekly check-up'
  const sold = sells.map((o) => nameOf(o.symbol))
  const bought = buys.map((o) => nameOf(o.symbol))
  const what = sold.length ? `selling ${list(sold)}${bought.length ? ` and buying ${list(bought)}` : ' for dollars'}` : `buying ${list(bought)} with dollars`
  return { kind: 'rebalance', reason: [`${lead}; ${what}.`, ...notes].join(' '), orders: [...sells, ...buys] }
}
