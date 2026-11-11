import { CASH } from './types.ts'
import type { Basket, Books, Exchange, Fill, LogEntry, Signal, Symbol, UserRecord, UserView } from './types.ts'
import { BASKETS, basketById, NAMES } from './baskets.ts'
import { getSignals, topNews } from './signals.ts'
import { targetWeights } from './weights.ts'
import { decide, MIN_NOTIONAL, nextHwm, usd, valueOf } from './decide.ts'
import { signEntry } from './journal.ts'
import { addLog, allUsers, getUser, nextLogId, patchUser, type Db } from './db.ts'

export const SYMBOLS: Symbol[] = [...new Set(BASKETS.flatMap(b => Object.keys(b.weights)))].filter(s => s !== CASH)

export interface Ctx { db: Db; exchangeFor: (mode: UserRecord['mode']) => Exchange; state: { lastLoopAt?: string } }

/** Signals and today's target for every basket. */
export async function marketView() {
  const signals = await getSignals().catch(() => [] as Signal[])
  return BASKETS.map(basket => ({
    basket,
    target: targetWeights(basket, signals),
    signals: signals.filter(s => s.symbol in basket.weights),
  }))
}

export async function writeLog(db: Db, e: Omit<LogEntry, 'id' | 'signature' | 'signer' | 'ts'> & { ts?: string }): Promise<LogEntry> {
  const signed = await signEntry({ id: nextLogId(db), ts: e.ts ?? new Date().toISOString(), ...e })
  addLog(db, signed)
  return signed
}

const sourcesFor = async (b: Basket, signals: Signal[]) => {
  const news = (await Promise.all(Object.keys(b.weights).filter(s => s !== CASH).map(s => topNews(s).catch(() => undefined)))).filter(Boolean) as { label: string; url: string }[]
  return [...signals.filter(s => s.tilt !== 0).map(s => s.source), ...news.slice(0, 2)]
}

/** One pass for one user: value, high-water mark, decision, orders, signed log entry. Returns the updated record. */
const inFlight = new Set<string>()

/** Ticks one user unless they are already being ticked; always works from the latest stored record. */
export async function tickUser(ctx: Ctx, user: UserRecord, view: Awaited<ReturnType<typeof marketView>>, books: Books, now = new Date()): Promise<UserRecord> {
  const key = user.address.toLowerCase()
  if (inFlight.has(key)) return user
  inFlight.add(key)
  try {
    const latest = getUser(ctx.db, user.address)
    if (!latest || latest.status !== 'active') return latest ?? user
    return await tickOne(ctx, latest, view, books, now)
  } finally { inFlight.delete(key) }
}

async function tickOne(ctx: Ctx, user: UserRecord, view: Awaited<ReturnType<typeof marketView>>, books: Books, now: Date): Promise<UserRecord> {
  const ex = ctx.exchangeFor(user.mode)
  const [balances, filters] = await Promise.all([ex.balances(user), ex.filters()])
  const valueUsd = valueOf(balances, books)
  const u: UserRecord = { ...user, hwmUsd: nextHwm(user.hwmUsd, valueUsd) }
  const m = view.find(v => v.basket.id === u.basketId)
  if (!m) return u
  const d = decide({ user: u, balances, books, filters, target: m.target, now })
  if (d.kind === 'hold') { patchUser(ctx.db, u.address, { hwmUsd: valueUsd }); return u }

  const fills: Fill[] = await ex.place(u, d.orders)
  const afterBal = await ex.balances(u)
  const after = valueOf(afterBal, books)
  const traded = fills.some(f => f.status === 'filled' || f.status === 'partial')
  if (d.kind === 'exit') {
    // Only stop once (almost) nothing is left in the market; otherwise stay active so the next check keeps selling.
    const leftUsd = after - (afterBal[CASH] ?? 0)
    const done = leftUsd < MIN_NOTIONAL
    if (done) u.status = 'exited'
    const text = done ? d.text : `${d.text} ${usd(leftUsd)} could not be sold yet because the testnet market is thin; Nest keeps selling at every check.`
    await writeLog(ctx.db, { address: u.address, kind: 'exit', text, sources: [], fills, valueUsd: after })
  } else {
    const blocked = fills.filter(f => f.status === 'rejected' || f.status === 'skipped')
    const partial = fills.some(f => f.status === 'partial')
    const buys = [...new Set(d.orders.filter(o => o.side === 'buy').map(o => NAMES[o.symbol] ?? o.symbol))]
    const reason = !u.lastRebalanceAt && buys.length ? `Building your basket: buying ${buys.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : d.reason
    const text = traded ? reason + (partial ? ' The testnet market only had part of that for sale, so Nest will finish over the next few checks.' : '') :`${reason} No trade went through this time: ${blocked.map(f => f.error).filter(Boolean).join('; ') || 'the market had no matching orders'}.`
    await writeLog(ctx.db, { address: u.address, kind: traded ? 'rebalance' : 'skip', text, sources: await sourcesFor(m.basket, m.signals), fills, valueUsd: after })
  }
  if (traded || d.kind === 'exit') u.lastRebalanceAt = now.toISOString()
  // hwm is patched with the observed value, so a hwm reset by "resume" mid-tick is kept.
  patchUser(ctx.db, u.address, { hwmUsd: valueUsd, status: u.status, lastRebalanceAt: u.lastRebalanceAt })
  return u
}

/** One pass over every active user. Errors for one user never stop the others. */
export async function tick(ctx: Ctx) {
  const view = await marketView()
  const users = allUsers(ctx.db).filter(u => u.status === 'active')
  const books = users.length ? await booksFor(ctx, users) : {}
  for (const user of users) {
    try { await tickUser(ctx, user, view, books[user.mode]!) } catch (e) { console.error(`tick ${user.address}:`, (e as Error).message) }
  }
  ctx.state.lastLoopAt = new Date().toISOString()
}

async function booksFor(ctx: Ctx, users: UserRecord[]) {
  const modes = [...new Set(users.map(u => u.mode))]
  const out: Partial<Record<UserRecord['mode'], Books>> = {}
  for (const mode of modes) out[mode] = await ctx.exchangeFor(mode).books(SYMBOLS)
  return out
}

export async function userView(ctx: Ctx, u: UserRecord, view: Awaited<ReturnType<typeof marketView>>): Promise<Omit<UserView, 'apiKey'>> {
  const ex = ctx.exchangeFor(u.mode)
  const [balances, books] = await Promise.all([ex.balances(u), ex.books(SYMBOLS)])
  const valueUsd = valueOf(balances, books)
  const target = view.find(v => v.basket.id === u.basketId)?.target ?? {}
  const symbols = [...new Set([...Object.keys(target), ...Object.keys(balances).filter(s => balances[s] > 0)])]
  const mark = (s: Symbol) => (s === CASH ? 1 : books[s]?.bid || books[s]?.ask || 0)
  const holdings = symbols.map(symbol => {
    const qty = balances[symbol] ?? 0
    const v = qty * mark(symbol)
    return { symbol, qty, valueUsd: v, weight: valueUsd ? (v / valueUsd) * 100 : 0, target: target[symbol] ?? 0 }
  })
  const hwmUsd = Math.max(u.hwmUsd, valueUsd)
  return { ...u, hwmUsd, valueUsd, holdings, floorUsd: hwmUsd * (1 - u.floorPct / 100) }
}

export const basketExists = (id: unknown): id is Basket['id'] => typeof id === 'string' && !!basketById(id)
