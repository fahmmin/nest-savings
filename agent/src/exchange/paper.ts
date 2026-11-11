// Paper exchange: balances in sqlite, IOC fills against the LIVE testnet top of book.
import type { DatabaseSync } from 'node:sqlite'
import { CASH } from '../types.ts'
import type { Address, Balances, Books, Exchange, Fill, Filters, Symbol } from '../types.ts'
import * as sodex from '../sodex/client.ts'

export const PAPER_TAKER_FEE = 0.00065
const EPS = 1e-9

function ensure(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS paper_balances(address TEXT, symbol TEXT, qty REAL, PRIMARY KEY(address,symbol))')
}

function add(db: DatabaseSync, address: string, symbol: Symbol, delta: number) {
  db.prepare('INSERT INTO paper_balances(address,symbol,qty) VALUES(?,?,?) ON CONFLICT(address,symbol) DO UPDATE SET qty = qty + excluded.qty')
    .run(address.toLowerCase(), symbol, delta)
}

export function creditPaper(db: DatabaseSync, address: Address, usdc: number) {
  ensure(db)
  add(db, address, CASH, usdc)
}

function read(db: DatabaseSync, address: Address): Balances {
  const out: Balances = { [CASH]: 0 }
  for (const r of db.prepare('SELECT symbol, qty FROM paper_balances WHERE address = ?').all(address.toLowerCase()) as { symbol: string; qty: number }[])
    out[r.symbol] = r.qty
  return out
}

export function paperExchange(
  db: DatabaseSync,
  src: { books?: (symbols: Symbol[]) => Promise<Books>; filters?: () => Promise<Filters> } = {},
): Exchange {
  ensure(db)
  const books = src.books ?? sodex.books
  return {
    filters: src.filters ?? sodex.filters,
    books,
    balances: async user => read(db, user.address),
    async place(user, orders) {
      const book = structuredClone(await books([...new Set(orders.map(o => o.symbol))]))
      const fills: Fill[] = []
      for (const [i, o] of orders.entries()) {
        const reject = (error: string): Fill => ({ order: o, status: 'rejected', filledQty: 0, avgPrice: 0, error })
        const t = book[o.symbol], qty = +o.quantity, limit = +o.price
        const bal = read(db, user.address)
        if (!t || !(qty > 0)) { fills.push(reject('bad order')); continue }
        const buy = o.side === 'buy'
        const px = buy ? t.ask : t.bid, size = buy ? t.askSz : t.bidSz
        if (!(px > 0) || !(size > 0)) { fills.push(reject(buy ? 'nobody is selling right now' : 'nobody is buying right now')); continue }
        if (buy ? limit < px : limit > px) { fills.push(reject('the price moved past our limit')); continue }
        const fillQty = Math.min(qty, size)
        const cost = fillQty * px
        if (buy ? (bal[CASH] ?? 0) + EPS < cost : (bal[o.symbol] ?? 0) + EPS < qty) { fills.push(reject('not enough balance')); continue }
        // Fee is taken from what you receive (base on a buy, USDC on a sell).
        db.exec('BEGIN')
        try {
          if (buy) { add(db, user.address, CASH, -cost); add(db, user.address, o.symbol, fillQty * (1 - PAPER_TAKER_FEE)) }
          else { add(db, user.address, o.symbol, -fillQty); add(db, user.address, CASH, cost * (1 - PAPER_TAKER_FEE)) }
          db.exec('COMMIT')
        } catch (e) { db.exec('ROLLBACK'); throw e }
        // Later orders in this call see the size we already took.
        if (buy) t.askSz -= fillQty; else t.bidSz -= fillQty
        fills.push({ order: o, status: fillQty + EPS >= qty ? 'filled' : 'partial', filledQty: fillQty, avgPrice: px, orderId: `paper-${Date.now()}-${i}` })
      }
      return fills
    },
  }
}
