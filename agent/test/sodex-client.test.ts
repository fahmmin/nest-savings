import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recoverTypedDataAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as sodex from '../src/sodex/client.ts'
import { liveExchange } from '../src/exchange/live.ts'
import { payloadHash } from '../src/sodex/sign.ts'
import type { Order } from '../src/types.ts'

// Recorded from https://testnet-gw.sodex.dev on 2026-11-11 (trimmed).
const fx = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/sodex/${n}`, import.meta.url), 'utf8'))
const SYMBOLS = fx('symbols.json'), BOOKS = fx('bookTickers.json')

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
type Call = { url: string; method: string; headers: Record<string, string>; body?: string }
function stubFetch(route: (c: Call) => unknown) {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body as string | undefined }
    calls.push(c)
    const r = route(c)
    return new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200 })
  }) as typeof fetch
  return calls
}
const ok = (data: unknown) => ({ code: 0, timestamp: 1, data })

test('parseFilters reads live symbols', () => {
  const f = sodex.parseFilters(SYMBOLS.data)
  assert.deepEqual(f.vBTC_vUSDC, { symbol: 'vBTC_vUSDC', id: 1, tickSize: 1, stepSize: 0.00001, minQuantity: 0.00001, minNotional: 5, pricePrecision: 0, quantityPrecision: 5 })
  assert.equal(f.vNVDA_vUSDC.tickSize, 0.01)
  assert.equal(f.vDEFIssi_vUSDC.id, 22)
})

test('coin names map to our symbols', () => {
  const m = sodex.coinSymbols(SYMBOLS.data)
  assert.equal(m.vBTC, 'vBTC_vUSDC')
  assert.equal(m['vDEFI.ssi'], 'vDEFIssi_vUSDC')
  assert.equal(m['vMAG7.ssi'], 'vMAG7ssi_vUSDC')
  assert.equal(m.vUSDC, 'vUSDC')
})

test('parseBooks: "0" is an empty side, missing symbol is an empty book', () => {
  const b = sodex.parseBooks(BOOKS.data, ['vBTC_vUSDC', 'vMAG7ssi_vUSDC', 'vSOL_vUSDC'])
  assert.deepEqual(b.vBTC_vUSDC, { bid: 73762, ask: 73763, bidSz: 0.00134, askSz: 0.00155 })
  assert.deepEqual(b.vMAG7ssi_vUSDC, { bid: 0.45, ask: 0, bidSz: 3076.56, askSz: 0 })
  assert.deepEqual(b.vSOL_vUSDC, { bid: 0, ask: 0, bidSz: 0, askSz: 0 })
})

test('parseBalances: available = total − locked, CASH always present', () => {
  // Shape from the Go SDK SpotAccountBalances (no funded account was available to record).
  const data = { blockTime: 1, blockHeight: 2, balances: [
    { id: 0, coin: 'vUSDC', total: '1400', locked: '100.5' },
    { id: 1, coin: 'vBTC', total: '0.002', locked: '0' },
    { id: 22, coin: 'vDEFI.ssi', total: '50', locked: '10' },
    { id: 99, coin: 'UNKNOWN', total: '1', locked: '0' },
  ] }
  assert.deepEqual(sodex.parseBalances(data, sodex.coinSymbols(SYMBOLS.data)), { vUSDC: 1299.5, vBTC_vUSDC: 0.002, vDEFIssi_vUSDC: 40 })
  assert.deepEqual(sodex.parseBalances({ balances: [] }, {}), { vUSDC: 0 })
})

test('accountIdOf: aid 0 means not activated; apiKeysOf reads both engines', async () => {
  const calls = stubFetch(c => c.url.includes('/state') ? fx('state-unknown.json') : fx('api-keys-empty.json'))
  assert.equal(await sodex.accountIdOf('0x3d4595c8742d0a58173a9963c05755b59a8f8256'), null)
  assert.deepEqual(await sodex.apiKeysOf('0x3d4595c8742d0a58173a9963c05755b59a8f8256', { accountId: 5, name: 'nest-1' }), { spot: [], perps: [] })
  assert.equal(calls[1].url, `${sodex.SODEX_BASE}/user/0x3d4595c8742d0a58173a9963c05755b59a8f8256/api-keys?accountID=5&name=nest-1`)
})

test('HTTP 200 with negative code throws', async () => {
  stubFetch(() => ({ code: -1, timestamp: 1, error: 'symbol not found' }))
  await assert.rejects(sodex.accountIdOf('0x0000000000000000000000000000000000000001'), /symbol not found/)
})

test('nextNonce is strictly increasing per signer', () => {
  const a = sodex.nextNonce('0xAA'), b = sodex.nextNonce('0xaa'), c = sodex.nextNonce('0xaa')
  assert.ok(b > a && c > b)
  assert.ok(sodex.nextNonce('0xbb') >= Date.now() - 5)
})

test('registerPermissionedKey sends Go-order body and 0x02 header with v 0/1', async () => {
  const calls = stubFetch(() => ok(null))
  const rs = 'ab'.repeat(64)
  const args = { accountId: 46032, name: 'nest-1', publicKey: '0x3D4595c8742d0a58173a9963c05755b59a8f8256' as Hex, expiresAt: 1800000000000, permissions: 14, nonce: 1760373925000 }
  await sodex.registerPermissionedKey('0x1111111111111111111111111111111111111111', args, `0x${rs}1c`)
  const c = calls[0]
  assert.equal(c.method, 'POST')
  assert.equal(c.url, `${sodex.SODEX_BASE}/user/0x1111111111111111111111111111111111111111/api-keys`)
  assert.equal(c.body, '{"accountID":46032,"name":"nest-1","type":1,"publicKey":"0x3d4595c8742d0a58173a9963c05755b59a8f8256","expiresAt":1800000000000,"permissions":14}')
  assert.equal(c.headers['X-API-Sign'], `0x02${rs}01`)
  assert.equal(c.headers['X-API-Nonce'], '1760373925000')
  assert.equal(c.headers['X-API-Chain'], '138565')
  assert.equal(c.headers['X-API-Key'], undefined)
})

const KEY = privateKeyToAccount(`0x${'0'.repeat(63)}2`)
const USER = { address: '0x1111111111111111111111111111111111111111' as const, accountId: 46032 }
const buy: Order = { symbol: 'vBTC_vUSDC', side: 'buy', quantity: '0.0001', price: '74132', notional: 7.4 }

/** Routes symbols, the batch POST and order history; `onBatch` builds the per-order results. */
function exchangeStub(onBatch: (orders: { clOrdID: string }[]) => unknown, history: (clOrdIDs: string[]) => unknown[]) {
  const ids: string[] = []
  const calls = stubFetch(c => {
    if (c.url.endsWith('/spot/markets/symbols')) return SYMBOLS
    if (c.url.endsWith('/spot/trade/orders/batch')) {
      const orders = JSON.parse(c.body!).orders
      ids.push(...orders.map((o: { clOrdID: string }) => o.clOrdID))
      return onBatch(orders)
    }
    if (c.url.includes('/orders/history')) return ok(history(ids))
    throw new Error(`unexpected ${c.url}`)
  })
  return calls
}

test('batchNewOrder: signed IOC limit, exact headers, fill read back by clOrdID', async () => {
  const calls = exchangeStub(
    os => `{"code":0,"timestamp":1,"data":[{"code":0,"clOrdID":"${os[0].clOrdID}","orderID":18446744073709551615}]}`,
    ids => [{ symbol: 'vBTC_vUSDC', clOrdID: ids[0], side: 'BUY', origQty: '0.0001', status: 'FILLED', executedQty: '0.0001', executedValue: '7.3763' }],
  )
  const [fill] = await sodex.batchNewOrder(USER, [buy], KEY, 'nest-1', { pollMs: [0] })
  assert.equal(fill.status, 'filled')
  assert.equal(fill.filledQty, 0.0001)
  assert.ok(Math.abs(fill.avgPrice - 73763) < 1e-6)
  assert.equal(fill.orderId, '18446744073709551615')

  const post = calls.find(c => c.method === 'POST')!
  const body = JSON.parse(post.body!)
  assert.deepEqual(body.orders[0], { symbolID: 1, clOrdID: body.orders[0].clOrdID, side: 1, type: 1, timeInForce: 3, price: '74132', quantity: '0.0001' })
  assert.match(body.orders[0].clOrdID, /^[0-9a-zA-Z_-]{1,36}$/)
  assert.equal(body.accountID, 46032)
  assert.equal(post.headers['X-API-Key'], 'nest-1')
  assert.equal(post.headers['X-API-Chain'], '138565')
  const sig = post.headers['X-API-Sign'] as Hex
  assert.match(sig, /^0x01[0-9a-f]{128}0[01]$/)
  const signer = await recoverTypedDataAddress({
    domain: { name: 'spot', version: '1', chainId: 138565, verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: { ExchangeAction: [{ name: 'payloadHash', type: 'bytes32' }, { name: 'nonce', type: 'uint64' }] },
    primaryType: 'ExchangeAction',
    message: { payloadHash: payloadHash('batchNewOrder', post.body!), nonce: BigInt(post.headers['X-API-Nonce']) },
    signature: `0x${sig.slice(4, -2)}${sig.endsWith('00') ? '1b' : '1c'}`,
  })
  assert.equal(signer, KEY.address)
  const hist = calls.find(c => c.url.includes('/orders/history'))!
  assert.match(hist.url, /accounts\/0x1111111111111111111111111111111111111111\/orders\/history\?symbol=vBTC_vUSDC&accountID=46032/)
})

test('batchNewOrder: partial, unfilled IOC, per-item error, whole-batch error, unknown symbol', async () => {
  exchangeStub(os => ok(os.map(o => ({ code: 0, clOrdID: o.clOrdID }))),
    ids => [{ clOrdID: ids[0], origQty: '0.0001', executedQty: '0.00004', executedValue: '2.95052' }])
  let [f] = await sodex.batchNewOrder(USER, [buy], KEY, 'k', { pollMs: [0] })
  assert.equal(f.status, 'partial'); assert.equal(f.filledQty, 0.00004)

  exchangeStub(os => ok(os.map(o => ({ code: 0, clOrdID: o.clOrdID }))), ids => [{ clOrdID: ids[0], origQty: '0.0001', executedQty: '0', executedValue: '0' }]);
  [f] = await sodex.batchNewOrder(USER, [buy], KEY, 'k', { pollMs: [0] })
  assert.equal(f.status, 'rejected'); assert.equal(f.filledQty, 0)

  exchangeStub(os => ok(os.map(o => ({ code: -1, clOrdID: o.clOrdID, error: 'insufficient balance' }))), () => []);
  [f] = await sodex.batchNewOrder(USER, [buy], KEY, 'k', { pollMs: [0] })
  assert.equal(f.status, 'rejected'); assert.equal(f.error, 'insufficient balance')

  exchangeStub(() => ({ code: -1, timestamp: 1, error: 'nonce is invalid' }), () => []);
  [f] = await sodex.batchNewOrder(USER, [buy], KEY, 'k', { pollMs: [0] })
  assert.equal(f.status, 'rejected'); assert.match(f.error!, /nonce is invalid/)

  exchangeStub(os => ok(os.map(o => ({ code: 0, clOrdID: o.clOrdID }))), () => []);
  [f] = await sodex.batchNewOrder(USER, [buy], KEY, 'k', { pollMs: [0] })
  assert.equal(f.status, 'rejected'); assert.match(f.error!, /not confirmed/)

  const fills = await sodex.batchNewOrder(USER, [{ ...buy, symbol: 'vNOPE_vUSDC' }], KEY, 'k')
  assert.equal(fills[0].status, 'rejected'); assert.match(fills[0].error!, /unknown symbol/)
})

test('liveExchange.place sends one order per request in sequence and uses the provided key', async () => {
  const seen: string[] = []
  const calls = exchangeStub(os => ok(os.map(o => ({ code: 0, clOrdID: o.clOrdID }))),
    ids => ids.map(id => ({ clOrdID: id, origQty: '1', executedQty: '1', executedValue: '180' })))
  const ex = liveExchange(a => { seen.push(a); return { name: 'nest-1', account: KEY } })
  const sell: Order = { symbol: 'vNVDA_vUSDC', side: 'sell', quantity: '0.05', price: '181.3', notional: 9 }
  const fills = await ex.place({ ...USER, mode: 'live', apiKeyName: 'nest-1' }, [sell, buy])
  assert.deepEqual(seen, [USER.address])
  const posts = calls.filter(c => c.method === 'POST').map(c => JSON.parse(c.body!).orders)
  assert.equal(posts.length, 2)
  assert.equal(posts[0][0].side, 2); assert.equal(posts[0][0].symbolID, 27)
  assert.equal(posts[1][0].side, 1)
  assert.equal(fills.length, 2)
})
