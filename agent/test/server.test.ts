// End-to-end through the HTTP API with a paper exchange priced from recorded testnet books. No network.
process.env.NODE_ENV = 'test'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { privateKeyToAccount } from 'viem/accounts'
import { openDb } from '../src/db.ts'
import { paperExchange } from '../src/exchange/paper.ts'
import { parseBooks, parseFilters } from '../src/sodex/client.ts'
import { createApp, DEMO_ADDRESS } from '../src/server.ts'
import { verifyEntry } from '../src/journal.ts'
import type { Exchange, LogEntry, UserView } from '../src/types.ts'

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/sodex/${n}`, import.meta.url), 'utf8')).data
const books = async (s: string[]) => parseBooks(fx('bookTickers.json'), s)
const filters = async () => parseFilters(fx('symbols.json'))
// Local throwaway test wallet, never funded anywhere.
const wallet = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const other = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')

let base = ''
let close = () => {}
before(async () => {
  const db = openDb(':memory:')
  const paper = paperExchange(db, { books, filters })
  const live: Exchange = { ...paper, place: async () => { throw new Error('live must not be used in tests') } }
  const { server, ensureDemo } = createApp(db, { paper, live })
  await new Promise<void>(r => server.listen(0, r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
  await ensureDemo()
})
after(() => close())

const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() } }
const post = async (p: string, body: unknown) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}

test('health, baskets and replay', async () => {
  const h = await get('/health')
  assert.equal(h.body.network, 'testnet')
  assert.equal(h.body.sosoData, 'fixtures')
  assert.equal(h.body.enclave, false)
  assert.equal((await get('/baskets')).body.length, 4)
  const r = await get('/replay/growth?floorPct=15&drop=40')
  assert.ok(r.body.savedUsd > 0)
  assert.equal((await get('/replay/nope')).status, 400)
  assert.equal((await get('/replay/growth?floorPct=99')).status, 400)
})

test('the public demo account exists and has bought its basket', async () => {
  const u = (await get(`/users/${DEMO_ADDRESS}`)).body as UserView
  assert.equal(u.mode, 'paper')
  assert.ok(u.holdings.some(h => h.symbol === 'vBTC_vUSDC' && h.qty > 0), 'demo bought bitcoin')
  assert.ok(u.valueUsd > 990 && u.valueUsd <= 1000, `value ${u.valueUsd}`)
})

test('paper sign-up: wrong signer is refused, right signer opens and fills the basket', async () => {
  const req = await post(`/users/${wallet.address}/link-request`, { basketId: 'growth', floorPct: 20, mode: 'paper' })
  assert.equal(req.status, 200)
  const bad = await post(`/users/${wallet.address}/link`, { nonce: req.body.nonce, signature: await other.signMessage({ message: req.body.message }) })
  assert.equal(bad.status, 401)
  const ok = await post(`/users/${wallet.address}/link`, { nonce: req.body.nonce, signature: await wallet.signMessage({ message: req.body.message }) })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  const u = ok.body as UserView
  assert.equal(u.status, 'active')
  assert.equal(u.basketId, 'growth')
  // Testnet books are thin: the first tick buys what the best ask holds, later ticks continue.
  for (const s of ['vBTC_vUSDC', 'vNVDA_vUSDC', 'vDEFIssi_vUSDC']) assert.ok(u.holdings.find(h => h.symbol === s)!.qty > 0, `bought ${s}`)
  assert.equal(u.floorUsd.toFixed(2), (u.hwmUsd * 0.8).toFixed(2))
  const log = (await get(`/users/${wallet.address}/log`)).body as LogEntry[]
  assert.deepEqual(log.map(e => e.kind), ['rebalance', 'link'])
  for (const e of log) assert.ok(await verifyEntry(e), `entry ${e.id} verifies`)
  assert.equal(log[0].signer, (await get('/health')).body.journalSigner)
})

test('settings need the owner signature and a fresh nonce', async () => {
  const msg = (nonce: number, json: unknown) => `Nest settings\naddress:${wallet.address}\nnonce:${nonce}\n${JSON.stringify(json)}`
  const message = msg(Date.now(), { rules: { floorPct: 30 }, status: 'paused' })
  const forged = await post(`/users/${wallet.address}/settings`, { message, signature: await other.signMessage({ message }) })
  assert.equal(forged.status, 401)
  const signature = await wallet.signMessage({ message })
  const ok = await post(`/users/${wallet.address}/settings`, { message, signature })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(ok.body.floorPct, 30)
  assert.equal(ok.body.status, 'paused')
  assert.equal((await post(`/users/${wallet.address}/settings`, { message, signature })).status, 400, 'replayed signature refused')
  const bad = msg(Date.now() + 1, { rules: { floorPct: 80 } })
  assert.equal((await post(`/users/${wallet.address}/settings`, { message: bad, signature: await wallet.signMessage({ message: bad }) })).status, 400)
  const resume = msg(Date.now() + 2, { status: 'active' })
  const r = await post(`/users/${wallet.address}/settings`, { message: resume, signature: await wallet.signMessage({ message: resume }) })
  assert.equal(r.body.status, 'active')
})

test('input validation', async () => {
  assert.equal((await get('/users/not-an-address')).status, 400)
  assert.equal((await get(`/users/${other.address}`)).status, 404)
  assert.equal((await post(`/users/${wallet.address}/link-request`, { basketId: 'x', floorPct: 15 })).status, 400)
  assert.equal((await post(`/users/${wallet.address}/link-request`, { basketId: 'steady', floorPct: 2 })).status, 400)
  assert.equal((await post(`/users/${wallet.address}/link-request`, { basketId: 'steady', floorPct: 15, mode: 'live' })).status, 400, 'live is off by default')
  assert.equal((await post(`/users/${wallet.address}/link`, { nonce: 1, signature: '0x00' })).status, 400)
})
