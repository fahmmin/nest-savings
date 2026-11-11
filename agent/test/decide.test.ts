import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, nextHwm, stepsDown, toDecimal, valueOf } from '../src/decide.ts'
import type { DecideInput } from '../src/decide.ts'
import { basketById } from '../src/baskets.ts'
import { CASH } from '../src/types.ts'
import type { Balances, Books, Filters, UserRecord } from '../src/types.ts'

const BTC = 'vBTC_vUSDC'
const NVDA = 'vNVDA_vUSDC'
const NOW = new Date('2026-11-11T12:00:00Z')
const DAY = 86_400_000
const books: Books = { [BTC]: { bid: 70000, ask: 70010, bidSz: 1, askSz: 1 }, [NVDA]: { bid: 180, ask: 180.2, bidSz: 100, askSz: 100 } }
const filters: Filters = {
  [BTC]: { symbol: BTC, id: 1, tickSize: 0.1, stepSize: 0.0001, minQuantity: 0.0001, minNotional: 5, pricePrecision: 1, quantityPrecision: 4 },
  [NVDA]: { symbol: NVDA, id: 2, tickSize: 0.01, stepSize: 0.001, minQuantity: 0.001, minNotional: 5, pricePrecision: 2, quantityPrecision: 3 },
}
const target = basketById('steady')!.weights // CASH 60, BTC 25, NVDA 15
const user: UserRecord = {
  address: '0x1111111111111111111111111111111111111111', accountId: 7, mode: 'paper', status: 'active', hwmUsd: 1000,
  apiKeyName: 'nest-11111111', linkedAt: '2026-11-01T00:00:00Z', basketId: 'steady', floorPct: 15,
  lastRebalanceAt: new Date(NOW.getTime() - DAY).toISOString(),
}
const bal = (cash: number, btcUsd: number, nvdaUsd: number): Balances => ({ [CASH]: cash, [BTC]: btcUsd / 70000, [NVDA]: nvdaUsd / 180 })
const run = (over: Partial<DecideInput> = {}, u: Partial<UserRecord> = {}) =>
  decide({ user: { ...user, ...u }, balances: bal(600, 250, 150), books, filters, target, now: NOW, ...over })

test('valueOf uses bids; ask only when nobody bids; hwm only goes up', () => {
  assert.ok(Math.abs(valueOf(bal(600, 250, 150), books) - 1000) < 1e-9)
  assert.equal(valueOf({ [BTC]: 1 }, { [BTC]: { bid: 0, ask: 5, bidSz: 0, askSz: 1 } }), 5)
  assert.equal(nextHwm(1000, 900), 1000)
  assert.equal(nextHwm(1000, 1100), 1100)
})

test('on target and not due: hold', () => {
  const d = run()
  assert.equal(d.kind, 'hold')
  assert.match(d.reason, /on target/)
})

test('drift over 5 points: rebalance with a plain sentence', () => {
  const d = run({ balances: bal(540, 310, 150) })
  assert.equal(d.kind, 'rebalance')
  if (d.kind !== 'rebalance') return
  assert.deepEqual(d.orders, [{ symbol: BTC, side: 'sell', quantity: '0.0008', price: '69650', notional: 56 }])
  assert.equal(d.reason, 'Bitcoin is 31% of your basket, above its 25% target; selling Bitcoin for dollars.')
})

test('sells before buys, limit prices and quantities rounded to tick/step', () => {
  const d = run({ balances: bal(600, 350, 50) })
  assert.equal(d.kind, 'rebalance')
  if (d.kind !== 'rebalance') return
  assert.deepEqual(d.orders.map((o) => [o.side, o.symbol, o.quantity, o.price]), [
    ['sell', BTC, '0.0014', '69650'], // 100/70000 = 0.001428 down to step; 70000*0.995 down to tick
    ['buy', NVDA, '0.554', '181.11'], // 100/180.2 = 0.5549 down to step; 180.2*1.005 = 181.101 up to tick
  ])
  assert.match(d.reason, /selling Bitcoin and buying Nvidia/)
})

test('buys never spend more cash than there is (at the limit price)', () => {
  const d = decide({ user: { ...user, lastRebalanceAt: undefined, basketId: 'growth', hwmUsd: 100 }, balances: { [CASH]: 100 }, books, filters, target: basketById('growth')!.weights, now: NOW })
  assert.equal(d.kind, 'rebalance')
  if (d.kind !== 'rebalance') return
  const spend = d.orders.reduce((s, o) => s + Number(o.quantity) * Number(o.price), 0)
  assert.ok(spend <= 100, String(spend))
})

test('cadence due but every change under $5: hold', () => {
  const d = run({ balances: bal(597, 253, 150) }, { lastRebalanceAt: new Date(NOW.getTime() - 8 * DAY).toISOString() })
  assert.equal(d.kind, 'hold')
  assert.match(d.reason, /under \$5/)
})

test('cadence elapsed with a small but tradeable gap: rebalance', () => {
  const d = run({ balances: bal(580, 270, 150) }, { lastRebalanceAt: new Date(NOW.getTime() - 8 * DAY).toISOString() })
  assert.equal(d.kind, 'rebalance')
  if (d.kind === 'rebalance') assert.match(d.reason, /^Weekly check-up; selling Bitcoin/)
})

test('empty book: that side is skipped and the reason says so', () => {
  const empty: Books = { ...books, [NVDA]: { bid: 180, ask: 0, bidSz: 100, askSz: 0 } }
  const d = run({ balances: bal(600, 350, 50), books: empty })
  assert.equal(d.kind, 'rebalance')
  if (d.kind !== 'rebalance') return
  assert.deepEqual(d.orders.map((o) => o.side), ['sell'])
  assert.match(d.reason, /No one is selling Nvidia right now/)
})

test('floor hit: exit sells every non-cash holding, even when drifted', () => {
  const d = run({ balances: bal(540, 310, 150) }, { hwmUsd: 1200 })
  assert.equal(d.kind, 'exit')
  if (d.kind !== 'exit') return
  assert.equal(d.reason, 'floor')
  assert.deepEqual(d.orders.map((o) => [o.side, o.symbol, o.quantity]), [['sell', BTC, '0.0044'], ['sell', NVDA, '0.833']])
  assert.match(d.text, /safety floor of \$1,020.00/)
})

test('cashOutAt passed: exit', () => {
  const d = run({}, { cashOutAt: '2026-11-11T00:00:00Z' })
  assert.equal(d.kind, 'exit')
  if (d.kind === 'exit') assert.equal(d.reason, 'cashOutDate')
  assert.equal(run({}, { cashOutAt: '2026-12-01T00:00:00Z' }).kind, 'hold')
})

test('exited and paused users: hold, even below the floor', () => {
  assert.equal(run({}, { status: 'exited', hwmUsd: 5000 }).kind, 'hold')
  assert.equal(run({}, { status: 'paused', hwmUsd: 5000 }).kind, 'hold')
})

test('canonical decimal strings', () => {
  assert.equal(toDecimal(1, 0.0001), '0.0001')
  assert.equal(toDecimal(738605, 0.1), '73860.5')
  assert.equal(toDecimal(3, 1), '3')
  assert.equal(toDecimal(stepsDown(0.3, 0.1), 0.1), '0.3')
  assert.equal(toDecimal(1, 1e-8), '0.00000001')
  assert.equal(toDecimal(10, 0.5), '5')
})

test('an empty book on a held asset means "no price yet", never a fake crash', () => {
  const empty = { ...books, [NVDA]: { bid: 0, ask: 0, bidSz: 0, askSz: 0 } }
  const d = run({ books: empty, balances: bal(150, 700, 150) }, { hwmUsd: 2000 })
  assert.equal(d.kind, 'hold')
  assert.match(d.reason, /could not get a price for Nvidia/)
})

test('an exit only sells coins Nest has a price for (coins outside the baskets are left alone)', () => {
  const d = run({ balances: { ...bal(100, 200, 100), vETH_vUSDC: 1 } }, { hwmUsd: 1000 })
  assert.equal(d.kind, 'exit')
  assert.deepEqual(d.kind === 'exit' && d.orders.map(o => o.symbol).sort(), [BTC, NVDA])
})
