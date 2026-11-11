// A floor exit on a thin book must keep selling on later checks instead of stopping half way.
process.env.NODE_ENV = 'test'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb, getUser, putUser, getLog } from '../src/db.ts'
import { creditPaper, paperExchange } from '../src/exchange/paper.ts'
import { tickUser, marketView } from '../src/loop.ts'
import type { Books, Filters, UserRecord } from '../src/types.ts'

const BTC = 'vBTC_vUSDC'
const filters: Filters = { [BTC]: { symbol: BTC, id: 1, tickSize: 0.1, stepSize: 0.0001, minQuantity: 0.0001, minNotional: 5, pricePrecision: 1, quantityPrecision: 4 } }

test('partial floor exit stays active and finishes on the next check', async () => {
  const db = openDb(':memory:')
  // Only 0.002 BTC (~$120) bid per check, and the user holds 0.01 BTC.
  let book: Books = { [BTC]: { bid: 60000, ask: 60010, bidSz: 0.002, askSz: 1 } }
  const ex = paperExchange(db, { books: async () => book, filters: async () => filters })
  const a = '0x2222222222222222222222222222222222222222'
  creditPaper(db, a, 0)
  db.prepare('INSERT INTO paper_balances (address, symbol, qty) VALUES (?, ?, ?)').run(a, BTC, 0.01)
  const user: UserRecord = { address: a, accountId: 0, mode: 'paper', status: 'active', hwmUsd: 1000, apiKeyName: 'n', linkedAt: '', basketId: 'crypto', floorPct: 15 }
  putUser(db, user)
  const ctx = { db, exchangeFor: () => ex, state: {} }
  const view = await marketView()

  await tickUser(ctx, user, view, book)
  assert.equal(getUser(db, a)!.status, 'active', 'still active while BTC is left')
  assert.match(getLog(db, { address: a })[0].text, /could not be sold yet/)

  book = { [BTC]: { bid: 60000, ask: 60010, bidSz: 1, askSz: 1 } }
  await tickUser(ctx, getUser(db, a)!, view, book)
  assert.equal(getUser(db, a)!.status, 'exited')
  assert.equal(getLog(db, { address: a })[0].kind, 'exit')
})

test('a paused user is not traded even if the loop holds a stale active record', async () => {
  const db = openDb(':memory:')
  const book: Books = { [BTC]: { bid: 60000, ask: 60010, bidSz: 1, askSz: 1 } }
  const ex = paperExchange(db, { books: async () => book, filters: async () => filters })
  const a = '0x3333333333333333333333333333333333333333'
  creditPaper(db, a, 1000)
  const stale: UserRecord = { address: a, accountId: 0, mode: 'paper', status: 'active', hwmUsd: 0, apiKeyName: 'n', linkedAt: '', basketId: 'crypto', floorPct: 15 }
  putUser(db, { ...stale, status: 'paused' })
  await tickUser({ db, exchangeFor: () => ex, state: {} }, stale, await marketView(), book)
  assert.equal(getLog(db, { address: a }).length, 0)
})
