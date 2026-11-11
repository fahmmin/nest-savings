// DEV ONLY: a fake Nest agent that serves SAMPLE data shaped like docs/api.md, so the app can be built and screenshotted
// before the real agent is running. Run with `npm run dev:mock` (plain `node`, port 8790). Set MOCK_LIVE=1 to switch
// the "My SoDEX testnet account" option on. Nothing here talks to SoDEX or SoSoValue; every number is made up.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { getAddress, isAddress, keccak256, stringToBytes, verifyMessage, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { BASKETS } from '../src/baskets.ts'
import { journalDigest } from '../src/journal.ts'
import type { Address, Balances, Basket, Fill, Health, LogEntry, Replay, ReplayPoint, Signal, UserRecord, UserRules, UserView } from '../src/types.ts'

const PORT = Number(process.env.PORT ?? 8790)
const LIVE = process.env.MOCK_LIVE === '1'
const CASH = 'vUSDC'
const DAY = 86_400_000
const journal = privateKeyToAccount(keccak256(stringToBytes('nest-mock-journal-SAMPLE-ONLY')))
const DEMO = getAddress('0x5afe000000000000000000000000000000000001')
const EXITED = getAddress('0x5afe000000000000000000000000000000000002')

const PRICES: Record<string, number> = { vBTC_vUSDC: 70250.5, vNVDA_vUSDC: 181.4, vDEFIssi_vUSDC: 1.193, [CASH]: 1 }
const SOURCE = { label: 'SoSoValue (sample fixture)', url: 'https://sosovalue.com/assets/etf/us-btc-spot' }
const SIGNALS: Signal[] = [
  { id: 'btc-etf', symbol: 'vBTC_vUSDC', tilt: 0.41, text: 'Sample data: big funds put $412M into Bitcoin ETFs over the last 5 days.', source: SOURCE, asOf: '2026-11-10' },
  { id: 'eth-etf', symbol: 'vDEFIssi_vUSDC', tilt: -0.27, text: 'Sample data: big funds took $81M out of Ether ETFs over the last 5 days.', source: { ...SOURCE, url: 'https://sosovalue.com/assets/etf/us-eth-spot' }, asOf: '2026-11-10' },
  { id: 'fgi', symbol: CASH, tilt: 0, text: 'Sample data: market mood is neutral (fear and greed index 54).', source: { ...SOURCE, url: 'https://sosovalue.com' }, asOf: '2026-11-11' },
]

function target(b: Basket): Record<string, number> {
  const raw: Record<string, number> = {}
  for (const [s, w] of Object.entries(b.weights)) raw[s] = Math.max(0, w + (SIGNALS.find((x) => x.symbol === s)?.tilt ?? 0) * 5)
  const sum = Object.values(raw).reduce((a, b) => a + b, 0)
  return Object.fromEntries(Object.entries(raw).map(([s, w]) => [s, Math.round((w / sum) * 1000) / 10]))
}
const basket = (id: string) => BASKETS.find((b) => b.id === id)

type Rec = UserRecord & { balances: Balances }
const users = new Map<string, Rec>()
const log: LogEntry[] = []
let nextId = 1

async function write(address: Address, kind: LogEntry['kind'], text: string, ts: number, fills: Fill[] = [], valueUsd = 0, sources = [] as LogEntry['sources']) {
  const unsigned = { id: nextId++, ts: new Date(ts).toISOString(), address, kind, text, sources, fills, valueUsd, signer: journal.address }
  log.unshift({ ...unsigned, signature: await journal.signMessage({ message: { raw: journalDigest(unsigned) } }) })
  log.sort((a, b) => b.ts.localeCompare(a.ts)) // newest first, like the agent
}

const value = (bal: Balances) => Object.entries(bal).reduce((s, [k, q]) => s + q * (PRICES[k] ?? 0), 0)
const r2 = (x: number) => Math.round(x * 100) / 100

/** Trades balances to the basket target and returns the fills (all "filled" at the sample price). */
function rebalance(u: Rec): Fill[] {
  const total = value(u.balances), t = target(basket(u.basketId)!), fills: Fill[] = []
  const syms = Object.keys(PRICES).filter((s) => s !== CASH)
  const orders = syms.map((s) => ({ s, delta: ((t[s] ?? 0) / 100) * total - (u.balances[s] ?? 0) * PRICES[s] })).filter((o) => Math.abs(o.delta) >= 5)
  for (const o of orders.sort((a, b) => a.delta - b.delta)) {
    const qty = Math.abs(o.delta) / PRICES[o.s]
    u.balances[o.s] = (u.balances[o.s] ?? 0) + Math.sign(o.delta) * qty
    u.balances[CASH] -= o.delta
    fills.push({ order: { symbol: o.s, side: o.delta > 0 ? 'buy' : 'sell', quantity: qty.toFixed(6), price: String(PRICES[o.s]), notional: r2(Math.abs(o.delta)) }, status: 'filled', filledQty: qty, avgPrice: PRICES[o.s] })
  }
  return fills
}

function view(u: Rec): UserView {
  const { balances, ...rec } = u
  const total = value(balances), t = target(basket(u.basketId)!)
  const holdings = Object.entries(balances).filter(([, q]) => q > 1e-9).map(([s, q]) => ({ symbol: s, qty: q, valueUsd: r2(q * PRICES[s]), weight: r2(((q * PRICES[s]) / total) * 100), target: t[s] ?? 0 }))
  for (const s of Object.keys(t)) if (!holdings.some((h) => h.symbol === s)) holdings.push({ symbol: s, qty: 0, valueUsd: 0, weight: 0, target: t[s] })
  return {
    ...rec, valueUsd: r2(total), holdings, floorUsd: r2(u.hwmUsd * (1 - u.floorPct / 100)),
    ...(u.mode === 'live' ? { apiKey: { name: u.apiKeyName, publicKey: '0x00000000000000000000000000000000000a9e17', permissions: 14, canWithdraw: false, canTransfer: false, source: 'sample fixture (not SoDEX)' } } : {}),
  }
}

async function seed() {
  const now = Date.now()
  const demo: Rec = { address: DEMO, accountId: 0, mode: 'paper', status: 'active', hwmUsd: 1046.2, apiKeyName: 'nest-demo', linkedAt: new Date(now - 9 * DAY).toISOString(), basketId: 'balanced', floorPct: 15, balances: { [CASH]: 1000 } }
  users.set(DEMO.toLowerCase(), demo)
  await write(DEMO, 'link', 'Started the Balanced basket with $1,000 of practice money. Safety floor: 15%.', now - 9 * DAY, [], 1000)
  await write(DEMO, 'rebalance', 'Bought the Balanced mix: mostly Bitcoin and dollars, some Nvidia and crypto apps.', now - 9 * DAY + 60_000, rebalance(demo), 1000, [SIGNALS[0].source])
  await write(DEMO, 'hold', 'No change needed: every asset is within 5 points of its target.', now - 5 * DAY, [], 1012.4)
  await write(DEMO, 'skip', 'Wanted to buy a little Nvidia, but nobody was selling on SoDEX testnet, so Nest skipped it.', now - 3 * DAY, [{ order: { symbol: 'vNVDA_vUSDC', side: 'buy', quantity: '0.04', price: '182.3', notional: 7.29 }, status: 'skipped', filledQty: 0, avgPrice: 0, error: 'empty book' }], 1031.8)
  demo.balances.vBTC_vUSDC *= 1.03
  await write(DEMO, 'rebalance', 'Sample: big funds put $412M into Bitcoin ETFs this week, so Nest holds a little more Bitcoin (37% instead of 35%).', now - 2 * 3600_000, rebalance(demo), r2(value(demo.balances)), [SIGNALS[0].source])

  const ex: Rec = { address: EXITED, accountId: 0, mode: 'paper', status: 'exited', hwmUsd: 1088, apiKeyName: 'nest-sample-2', linkedAt: new Date(now - 20 * DAY).toISOString(), basketId: 'crypto', floorPct: 10, balances: { [CASH]: 979.2 } }
  users.set(EXITED.toLowerCase(), ex)
  await write(EXITED, 'link', 'Started the Crypto Core basket with $1,000 of practice money. Safety floor: 10%.', now - 20 * DAY, [], 1000)
  await write(EXITED, 'exit', 'Your savings fell 10% from their best ($1,088 to $979), so Nest moved everything to dollars.', now - 1 * DAY, [
    { order: { symbol: 'vBTC_vUSDC', side: 'sell', quantity: '0.0098', price: '69900', notional: 685 }, status: 'filled', filledQty: 0.0098, avgPrice: 69_950 },
    { order: { symbol: 'vDEFIssi_vUSDC', side: 'sell', quantity: '246', price: '1.19', notional: 292.7 }, status: 'filled', filledQty: 246, avgPrice: 1.19 },
  ], 979.2)
}

/** Crash replay: same shape as the agent's (60 days, crash from day 15 to 35, recovers 40% of the fall). */
function replay(b: Basket, floorPct: number, dropPct: number): Replay {
  const drop = dropPct / 100, risky = Object.keys(b.weights).filter((s) => s !== CASH)
  const mult = (t: number, i: number) => {
    const w = 1 + 0.01 * Math.sin(t * 0.9 + i)
    return t < 15 ? w : t <= 35 ? w * (1 - (drop * (t - 15)) / 20) : w * (1 - drop + 0.4 * drop * ((t - 35) / 24))
  }
  const cash = 10 * (b.weights[CASH] ?? 0)
  const qty = Object.fromEntries(risky.map((s, i) => [s, (10 * b.weights[s]) / (PRICES[s] * mult(0, i))]))
  const points: ReplayPoint[] = []
  let hwm = 1000, exitedAt: number | undefined, held = 0
  for (let t = 0; t < 60; t++) {
    const price = Object.fromEntries(risky.map((s, i) => [s, PRICES[s] * mult(t, i)]))
    const without = cash + risky.reduce((s, k) => s + qty[k] * price[k], 0)
    let withFloor = exitedAt === undefined ? without : held
    let event = t === 0 ? `Start: ${b.name} basket with $1,000` : t === 15 ? 'Prices start falling' : t === 36 ? 'Prices start to recover' : undefined
    if (exitedAt === undefined && withFloor <= hwm * (1 - floorPct / 100)) { exitedAt = t; held = withFloor; event = 'Safety floor hit: Nest moved everything to dollars' }
    hwm = Math.max(hwm, withFloor)
    if (exitedAt !== undefined) withFloor = held
    points.push({ t, price, withFloor: r2(withFloor), without: r2(without), ...(event ? { event } : {}) })
  }
  const last = points[points.length - 1]
  return { basketId: b.id, floorPct, startUsd: 1000, points, ...(exitedAt !== undefined ? { exitedAt } : {}), savedUsd: r2(last.withFloor - last.without) }
}

class HttpError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s } }
const pending = new Map<string, { rules: UserRules; mode: 'live' | 'paper'; nonce: number; message?: string }>()

function rules(b: Record<string, unknown>, partial = false): Partial<UserRules> {
  const r: Partial<UserRules> = {}
  if (b.basketId !== undefined || !partial) { if (!basket(String(b.basketId))) throw new HttpError(400, 'unknown basket'); r.basketId = b.basketId as Basket['id'] }
  if (b.floorPct !== undefined || !partial) { const f = Number(b.floorPct); if (!(f >= 5 && f <= 50)) throw new HttpError(400, 'floorPct must be 5 to 50'); r.floorPct = Math.round(f) }
  if (b.cashOutAt) r.cashOutAt = new Date(String(b.cashOutAt)).toISOString()
  else if (b.cashOutAt === '' || b.cashOutAt === null) r.cashOutAt = undefined
  return r
}

async function route(method: string, path: string, q: URLSearchParams, body: Record<string, unknown>): Promise<unknown> {
  const p = path.split('/').filter(Boolean)
  const addrOf = (a: string) => { if (!isAddress(a, { strict: false })) throw new HttpError(400, 'bad address'); return getAddress(a) }
  const userOf = (a: Address) => { const u = users.get(a.toLowerCase()); if (!u) throw new HttpError(404, 'not linked'); return u }
  if (method === 'GET') {
    if (path === '/health') return { ok: true, network: 'testnet', exchange: LIVE ? 'live' : 'paper', enclave: false, journalSigner: journal.address, sosoData: 'fixtures', lastLoopAt: new Date().toISOString(), demoAddress: DEMO, sample: true } satisfies Health & object
    if (path === '/baskets') return BASKETS.map((b) => ({ basket: b, target: target(b), signals: SIGNALS }))
    if (path === '/signals') return SIGNALS
    if (path === '/prices') return Object.fromEntries(Object.entries(PRICES).filter(([s]) => s !== CASH).map(([s, px]) => [s, { bid: px * 0.999, ask: px * 1.001, bidSz: 1, askSz: 1 }]))
    if (path === '/log') return log.slice(0, Number(q.get('limit') ?? 50))
    if (p[0] === 'replay' && p[1]) {
      const b = basket(p[1]); if (!b) throw new HttpError(400, 'unknown basket')
      const f = Number(q.get('floorPct') ?? 15), d = Number(q.get('drop') ?? 40)
      if (!(f >= 5 && f <= 50 && d >= 5 && d <= 90)) throw new HttpError(400, 'floorPct 5-50, drop 5-90')
      return replay(b, f, d)
    }
    if (p[0] === 'users' && p[1] && !p[2]) return view(userOf(addrOf(p[1])))
    if (p[0] === 'users' && p[1] && p[2] === 'log') { const a = addrOf(p[1]); return log.filter((e) => e.address === a).slice(0, Number(q.get('limit') ?? 50)) }
  }
  if (method === 'POST' && p[0] === 'users' && p[1]) {
    const address = addrOf(p[1])
    if (p[2] === 'link-request') {
      const mode = body.mode === 'live' ? 'live' : 'paper'
      if (mode === 'live' && !LIVE) throw new HttpError(400, 'live trading is switched off on this server')
      const r = rules(body) as UserRules, nonce = Date.now(), name = `nest-${address.slice(2, 10).toLowerCase()}`
      if (mode === 'paper') {
        const message = `Nest practice account\naddress:${address}\nnonce:${nonce}\nbasket:${r.basketId}\nfloor:${r.floorPct}%\ncash out:${r.cashOutAt ?? 'none'}`
        pending.set(address, { rules: r, mode, nonce, message })
        return { apiKeyName: name, publicKey: '0x00000000000000000000000000000000000a9e17', accountId: 0, message, nonce }
      }
      pending.set(address, { rules: r, mode, nonce })
      const typedData = {
        domain: { name: 'universal', version: '1', chainId: 138565, verifyingContract: '0x0000000000000000000000000000000000000000' },
        types: { UserSignedAddPermissionedAPIKeyAction: [
          { name: 'chainID', type: 'uint64' }, { name: 'nonce', type: 'uint64' }, { name: 'accountID', type: 'uint64' }, { name: 'name', type: 'string' },
          { name: 'keyType', type: 'uint8' }, { name: 'publicKey', type: 'bytes' }, { name: 'expiresAt', type: 'uint64' }, { name: 'permissions', type: 'uint64' }] },
        primaryType: 'UserSignedAddPermissionedAPIKeyAction',
        message: { chainID: 138565, nonce, accountID: 4242, name, keyType: 1, publicKey: '0x00000000000000000000000000000000000a9e17', expiresAt: nonce + 30 * DAY, permissions: 14 },
      }
      return { apiKeyName: name, publicKey: '0x00000000000000000000000000000000000a9e17', accountId: 4242, typedData, nonce }
    }
    if (p[2] === 'link') {
      const pend = pending.get(address)
      if (!pend || pend.nonce !== Number(body.nonce)) throw new HttpError(400, 'link request expired, start again')
      if (pend.mode === 'paper' && !(await verifyMessage({ address, message: pend.message!, signature: body.signature as Hex }).catch(() => false))) throw new HttpError(401, 'signature does not match this wallet')
      // shortcut: the mock accepts any live (EIP-712) signature; the real agent submits it to SoDEX.
      pending.delete(address)
      const u: Rec = { ...pend.rules, address, accountId: pend.mode === 'live' ? 4242 : 0, mode: pend.mode, status: 'active', hwmUsd: 1000, apiKeyName: `nest-${address.slice(2, 10).toLowerCase()}`, linkedAt: new Date().toISOString(), balances: { [CASH]: 1000 } }
      users.set(address.toLowerCase(), u)
      await write(address, 'link', `Started the ${basket(u.basketId)!.name} basket with $1,000 of ${u.mode === 'paper' ? 'practice money' : 'sample test tokens'}. Safety floor: ${u.floorPct}%.`, Date.now(), [], 1000)
      await write(address, 'rebalance', `Bought the ${basket(u.basketId)!.name} mix.`, Date.now() + 1, rebalance(u), r2(value(u.balances)), [SIGNALS[0].source])
      return view(u)
    }
    if (p[2] === 'settings') {
      const u = userOf(address)
      const message = String(body.message ?? ''), m = /^Nest settings\naddress:(0x[0-9a-fA-F]{40})\nnonce:(\d+)\n([\s\S]+)$/.exec(message)
      if (!m || getAddress(m[1]) !== address) throw new HttpError(400, 'bad settings message')
      if (Math.abs(Date.now() - Number(m[2])) > 10 * 60_000) throw new HttpError(400, 'settings message too old')
      if (!(await verifyMessage({ address, message, signature: body.signature as Hex }).catch(() => false))) throw new HttpError(401, 'signature does not match this wallet')
      const parsed = JSON.parse(m[3]) as { rules?: Record<string, unknown>; status?: string }
      const r = rules(parsed.rules ?? {}, true)
      Object.assign(u, r)
      if ('cashOutAt' in r && !r.cashOutAt) delete u.cashOutAt
      const was = u.status
      if (parsed.status === 'paused') u.status = 'paused'
      if (parsed.status === 'active' && was !== 'active') { u.status = 'active'; u.hwmUsd = r2(value(u.balances)) }
      await write(address, parsed.status === 'active' && was !== 'active' ? 'resume' : 'settings', `${parsed.status === 'paused' ? 'Paused.' : parsed.status === 'active' && was !== 'active' ? 'Resumed.' : 'Settings updated.'} Basket: ${u.basketId}, floor: ${u.floorPct}%.`, Date.now())
      return view(u)
    }
  }
  throw new HttpError(404, 'not found')
}

const send = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }).end(body === null ? undefined : JSON.stringify(body))

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = ''
  for await (const c of req) s += c
  try { return s ? JSON.parse(s) : {} } catch { throw new HttpError(400, 'bad json') }
}

await seed()
createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, null)
  const url = new URL(req.url ?? '/', 'http://x')
  try {
    send(res, 200, await route(req.method ?? 'GET', url.pathname, url.searchParams, req.method === 'POST' ? await readBody(req) : {}))
  } catch (e) {
    send(res, e instanceof HttpError ? e.status : 500, { error: (e as Error).message })
  }
}).listen(PORT, () => console.log(`Nest MOCK agent (sample data only) on http://localhost:${PORT}, journal signer ${journal.address}, live=${LIVE}`))
