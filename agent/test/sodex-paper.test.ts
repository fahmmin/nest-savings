import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db-node.ts'
import { paperExchange, creditPaper, PAPER_TAKER_FEE } from '../src/exchange/paper.ts'
import type { Books, Order } from '../src/types.ts'

const A = '0xAbC0000000000000000000000000000000000001' as const
const USER = { address: A, accountId: 0, mode: 'paper' as const, apiKeyName: 'paper' }
const BOOK: Books = {
  vBTC_vUSDC: { bid: 73762, ask: 73763, bidSz: 0.00134, askSz: 0.00155 },
  vMAG7ssi_vUSDC: { bid: 0.45, ask: 0, bidSz: 3076.56, askSz: 0 },
}
const setup = (usdc = 1000) => {
  const db = openDb(':memory:')
  const ex = paperExchange(db, { books: async () => structuredClone(BOOK), filters: async () => ({}) })
  creditPaper(db, A, usdc)
  return { db, ex }
}
const order = (o: Partial<Order>): Order => ({ symbol: 'vBTC_vUSDC', side: 'buy', quantity: '0.0001', price: '74132', notional: 7.4, ...o })
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

test('buy fills at the ask (not the limit) and the fee comes out of what you receive', async () => {
  const { ex } = setup()
  const [f] = await ex.place(USER, [order({})])
  assert.equal(f.status, 'filled'); close(f.filledQty, 0.0001); assert.equal(f.avgPrice, 73763)
  const b = await ex.balances(USER)
  close(b.vUSDC, 1000 - 0.0001 * 73763)
  close(b.vBTC_vUSDC, 0.0001 * (1 - PAPER_TAKER_FEE))
})

test('partial fill limited by askSz; size is consumed across orders in one call', async () => {
  const { ex } = setup()
  const [f1, f2] = await ex.place(USER, [order({ quantity: '0.001' }), order({ quantity: '0.001' })])
  assert.equal(f1.status, 'filled')
  assert.equal(f2.status, 'partial'); close(f2.filledQty, 0.00055)
})

test('rejects: empty ask side, limit below ask, insufficient funds', async () => {
  const { ex } = setup(5)
  const [empty, low, poor] = await ex.place(USER, [
    order({ symbol: 'vMAG7ssi_vUSDC', price: '0.5', quantity: '20' }),
    order({ price: '73000' }),
    order({ quantity: '0.001' }),
  ])
  for (const f of [empty, low, poor]) { assert.equal(f.status, 'rejected'); assert.equal(f.filledQty, 0) }
  assert.match(poor.error!, /balance/)
  assert.deepEqual(await ex.balances(USER), { vUSDC: 5 })
})

test('sell fills at the bid, fee in USDC; selling more than you hold is rejected', async () => {
  const { ex } = setup()
  await ex.place(USER, [order({ quantity: '0.001' })])
  const held = (await ex.balances(USER)).vBTC_vUSDC
  const [tooMuch] = await ex.place(USER, [order({ side: 'sell', quantity: '0.002', price: '73000' })])
  assert.equal(tooMuch.status, 'rejected')
  const cash0 = (await ex.balances(USER)).vUSDC
  const [f] = await ex.place(USER, [order({ side: 'sell', quantity: '0.0005', price: '73000' })])
  assert.equal(f.status, 'filled'); assert.equal(f.avgPrice, 73762)
  const b = await ex.balances(USER)
  close(b.vBTC_vUSDC, held - 0.0005)
  close(b.vUSDC, cash0 + 0.0005 * 73762 * (1 - PAPER_TAKER_FEE))
  const [above] = await ex.place(USER, [order({ side: 'sell', quantity: '0.0001', price: '74000' })])
  assert.equal(above.status, 'rejected')
})

test('balances are per address (case-insensitive) and credits add up', async () => {
  const { db, ex } = setup()
  creditPaper(db, A.toLowerCase() as typeof A, 500)
  assert.deepEqual(await ex.balances(USER), { vUSDC: 1500 })
  assert.deepEqual(await ex.balances({ ...USER, address: '0x0000000000000000000000000000000000000009' }), { vUSDC: 0 })
})
