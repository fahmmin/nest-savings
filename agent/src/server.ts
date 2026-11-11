import http from 'node:http'
import { getAddress, isAddress, verifyMessage, verifyTypedData, type Hex } from 'viem'
import type { Address, Exchange, Health, UserRecord, UserRules, UserView } from './types.ts'
import { openDb, getLog, getUser, putUser, useSettingsNonce, type Db } from './db.ts'
import { apiKeyFor, inEnclave, journalAccount } from './keys.ts'
import { sosoMode } from './soso.ts'
import { replay } from './replay.ts'
import { basketExists, marketView, tick, tickUser, userView, writeLog, SYMBOLS, type Ctx } from './loop.ts'
import { AGENT_PERMISSIONS, permissionedKeyTypedData, PERM } from './sodex/sign.ts'
import { accountIdOf, apiKeysOf, registerPermissionedKey } from './sodex/client.ts'
import { liveExchange } from './exchange/live.ts'
import { creditPaper, paperExchange } from './exchange/paper.ts'

const PORT = Number(process.env.PORT ?? 8787)
const LOOP_MS = Number(process.env.LOOP_MS ?? 60_000)
const EXCHANGE: 'live' | 'paper' = process.env.EXCHANGE === 'live' ? 'live' : 'paper'
const PAPER_START_USD = 1000
const KEY_TTL_MS = 90 * 24 * 3600_000
/** Public practice account judges can open without a wallet (#home-<this>). */
export const DEMO_ADDRESS = getAddress('0x5afe000000000000000000000000000000000001')

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status } }

export function createApp(db: Db, exchanges: Record<UserRecord['mode'], Exchange>) {
  const ctx: Ctx = { db, exchangeFor: m => exchanges[m], state: {} }
  /** Link requests waiting for the wallet's signature, by address. */
  const pending = new Map<string, { rules: UserRules; mode: UserRecord['mode']; nonce: number; accountId: number; typedData?: ReturnType<typeof permissionedKeyTypedData>; message?: string }>()

  const addr = (s: string): Address => { if (!isAddress(s, { strict: false })) throw new HttpError(400, 'invalid address'); return getAddress(s) }

  function rulesFrom(b: any, partial = false): Partial<UserRules> {
    const r: Partial<UserRules> = {}
    if (b.basketId !== undefined || !partial) { if (!basketExists(b.basketId)) throw new HttpError(400, 'unknown basket'); r.basketId = b.basketId }
    if (b.floorPct !== undefined || !partial) {
      const f = Number(b.floorPct)
      if (!Number.isFinite(f) || f < 5 || f > 50) throw new HttpError(400, 'floorPct must be 5 to 50')
      r.floorPct = Math.round(f)
    }
    if (b.cashOutAt) {
      const t = Date.parse(b.cashOutAt)
      if (!Number.isFinite(t) || t < Date.now()) throw new HttpError(400, 'cashOutAt must be a future date')
      r.cashOutAt = new Date(t).toISOString()
    } else if (b.cashOutAt === null || b.cashOutAt === '') r.cashOutAt = undefined
    return r
  }

  async function view(u: UserRecord): Promise<UserView> {
    const v = await userView(ctx, u, await marketView())
    if (u.mode === 'paper') return { ...v, apiKey: undefined }
    const key = apiKeyFor(u.address)
    const keys = await apiKeysOf(u.address).catch(() => undefined)
    const found = keys?.spot.find(k => k.name === u.apiKeyName)
    const p = found?.permissions ?? 0
    return { ...v, apiKey: { name: u.apiKeyName, publicKey: key.publicKey, permissions: found?.permissions, canWithdraw: !found || !(p & PERM.WITHDRAW), canTransfer: !found || !(p & PERM.TRANSFER), source: `https://testnet-gw.sodex.dev/api/v1/user/${u.address}/api-keys` } }
  }

  const routes: Record<string, (p: string[], body: any, q: URLSearchParams) => Promise<unknown>> = {
    'GET /health': async () => ({ ok: true, network: 'testnet', exchange: EXCHANGE, enclave: inEnclave(), journalSigner: journalAccount().address, sosoData: sosoMode(), lastLoopAt: ctx.state.lastLoopAt, demoAddress: DEMO_ADDRESS } satisfies Health & { demoAddress: Address }),
    'GET /baskets': () => marketView(),
    'GET /signals': async () => (await marketView()).flatMap(v => v.signals).filter((s, i, a) => a.findIndex(x => x.id === s.id) === i),
    'GET /prices': () => exchanges.paper.books(SYMBOLS),
    'GET /log': async (_p, _b, q) => getLog(db, { limit: Number(q.get('limit') ?? 50) }),
    'GET /replay/:id': async ([id], _b, q) => {
      if (!basketExists(id)) throw new HttpError(400, 'unknown basket')
      const floor = Number(q.get('floorPct') ?? 15), drop = Number(q.get('drop') ?? 40)
      if (!(floor >= 5 && floor <= 50 && drop >= 5 && drop <= 90)) throw new HttpError(400, 'floorPct 5-50, drop 5-90')
      return replay(id, floor, drop)
    },
    'GET /users/:a': async ([a]) => { const u = getUser(db, addr(a)); if (!u) throw new HttpError(404, 'not linked'); return view(u) },
    'GET /users/:a/log': async ([a], _b, q) => getLog(db, { address: addr(a), limit: Number(q.get('limit') ?? 50) }),

    'POST /users/:a/link-request': async ([a], b) => {
      const address = addr(a)
      const rules = rulesFrom(b) as UserRules
      const mode: UserRecord['mode'] = b.mode === 'live' ? 'live' : 'paper'
      if (mode === 'live' && EXCHANGE !== 'live') throw new HttpError(400, 'Live testnet trading is switched off on this server. Use practice money.')
      const nonce = Date.now()
      const key = apiKeyFor(address)
      if (mode === 'paper') {
        const message = `Nest practice account\naddress:${address}\nnonce:${nonce}\nbasket:${rules.basketId}\nfloor:${rules.floorPct}%`
        pending.set(address, { rules, mode, nonce, accountId: 0, message })
        return { apiKeyName: key.name, publicKey: key.publicKey, accountId: 0, message, nonce }
      }
      const accountId = await accountIdOf(address)
      if (!accountId) throw new HttpError(409, 'This wallet has no active SoDEX testnet account yet. Claim test funds at testnet.sodex.com and move them to Spot first.')
      const typedData = permissionedKeyTypedData({ accountId, name: key.name, publicKey: key.publicKey, expiresAt: nonce + KEY_TTL_MS, permissions: AGENT_PERMISSIONS, nonce })
      pending.set(address, { rules, mode, nonce, accountId, typedData })
      return { apiKeyName: key.name, publicKey: key.publicKey, accountId, typedData, nonce }
    },

    'POST /users/:a/link': async ([a], b) => {
      const address = addr(a)
      const p = pending.get(address)
      if (!p || p.nonce !== Number(b.nonce) || Date.now() - p.nonce > 10 * 60_000) throw new HttpError(400, 'link request expired, start again')
      const signature = String(b.signature) as Hex
      const ok = p.mode === 'paper'
        ? await verifyMessage({ address, message: p.message!, signature }).catch(() => false)
        : await verifyTypedData({ address, ...(p.typedData as any), signature }).catch(() => false)
      if (!ok) throw new HttpError(401, 'signature does not match this wallet')
      pending.delete(address)
      const key = apiKeyFor(address)
      if (p.mode === 'live') {
        await registerPermissionedKey(address, { accountId: p.accountId, name: key.name, publicKey: key.publicKey, expiresAt: p.nonce + KEY_TTL_MS, permissions: AGENT_PERMISSIONS, nonce: p.nonce }, signature)
        const keys = await apiKeysOf(address)
        const k = keys.spot.find(x => x.name === key.name)
        if (!k || ((k.permissions ?? 0) & AGENT_PERMISSIONS) !== AGENT_PERMISSIONS) throw new HttpError(502, 'SoDEX did not confirm the trade-only key; nothing was changed')
      } else if (!getUser(db, address)) creditPaper(db, address, PAPER_START_USD)
      const existing = getUser(db, address)
      const u: UserRecord = { ...p.rules, address, accountId: p.accountId, mode: p.mode, status: 'active', hwmUsd: existing?.hwmUsd ?? 0, apiKeyName: key.name, linkedAt: new Date().toISOString(), lastRebalanceAt: undefined }
      putUser(db, u)
      await writeLog(db, { address, kind: 'link', text: p.mode === 'paper' ? `Practice account opened with $${PAPER_START_USD.toLocaleString('en-US')}. Nest will build your basket now.` : 'Your SoDEX account is linked with a trade-only key. Nest can buy and sell for you but cannot withdraw or move your money.', sources: [], fills: [], valueUsd: 0 })
      await tickNow(u)
      return view(getUser(db, address)!)
    },

    'POST /users/:a/settings': async ([a], b) => {
      const address = addr(a)
      const cur = getUser(db, address)
      if (!cur) throw new HttpError(404, 'not linked')
      const message = String(b.message ?? ''), signature = String(b.signature ?? '') as Hex
      const m = /^Nest settings\naddress:(0x[0-9a-fA-F]{40})\nnonce:(\d+)\n([\s\S]+)$/.exec(message)
      if (!m || getAddress(m[1]) !== address) throw new HttpError(400, 'bad settings message')
      const nonce = Number(m[2])
      if (Math.abs(Date.now() - nonce) > 10 * 60_000) throw new HttpError(400, 'settings message too old')
      if (!(await verifyMessage({ address, message, signature }).catch(() => false))) throw new HttpError(401, 'signature does not match this wallet')
      if (!useSettingsNonce(db, address, nonce)) throw new HttpError(400, 'settings message already used')
      let parsed: any
      try { parsed = JSON.parse(m[3]) } catch { throw new HttpError(400, 'bad settings json') }
      const rules = rulesFrom(parsed.rules ?? {}, true)
      const u: UserRecord = { ...cur, ...rules }
      if ('cashOutAt' in rules && !rules.cashOutAt) delete u.cashOutAt
      const status = parsed.status
      if (status !== undefined && status !== 'active' && status !== 'paused') throw new HttpError(400, 'status must be active or paused')
      let text = 'Settings updated.'
      if (status === 'paused') { u.status = 'paused'; text = 'Paused. Nest will not trade until you resume.' }
      if (status === 'active' && cur.status !== 'active') {
        u.status = 'active'
        u.hwmUsd = (await userView(ctx, u, await marketView())).valueUsd // floor restarts from today's value
        text = 'Resumed. Your safety floor now counts from today\'s value.'
      }
      putUser(db, u)
      await writeLog(db, { address, kind: status === 'active' && cur.status !== 'active' ? 'resume' : 'settings', text: `${text} Basket: ${u.basketId}, floor: ${u.floorPct}%${u.cashOutAt ? `, cash out by ${u.cashOutAt.slice(0, 10)}` : ''}.`, sources: [], fills: [], valueUsd: 0 })
      if (u.status === 'active') await tickNow(u)
      return view(getUser(db, address)!)
    },
  }

  async function tickNow(u: UserRecord) {
    const books = await exchanges[u.mode].books(SYMBOLS)
    await tickUser(ctx, u, await marketView(), books).catch(e => console.error('tickNow:', (e as Error).message))
  }

  async function ensureDemo() {
    if (getUser(db, DEMO_ADDRESS)) return
    creditPaper(db, DEMO_ADDRESS, PAPER_START_USD)
    const u: UserRecord = { address: DEMO_ADDRESS, accountId: 0, mode: 'paper', status: 'active', basketId: 'balanced', floorPct: 15, hwmUsd: 0, apiKeyName: apiKeyFor(DEMO_ADDRESS).name, linkedAt: new Date().toISOString() }
    putUser(db, u)
    await writeLog(db, { address: DEMO_ADDRESS, kind: 'link', text: `Public demo account opened with $${PAPER_START_USD} of practice money in the Balanced basket, with a 15% safety floor.`, sources: [], fills: [], valueUsd: PAPER_START_USD })
    await tickNow(u)
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
    const url = new URL(req.url ?? '/', 'http://x')
    const parts = url.pathname.split('/').filter(Boolean)
    try {
      const match = Object.keys(routes).find(k => {
        const [method, path] = k.split(' ')
        const segs = path.split('/').filter(Boolean)
        return method === req.method && segs.length === parts.length && segs.every((s, i) => s.startsWith(':') || s === parts[i])
      })
      if (!match) throw new HttpError(404, 'not found')
      const params = match.split(' ')[1].split('/').filter(Boolean).flatMap((s, i) => (s.startsWith(':') ? [decodeURIComponent(parts[i])] : []))
      let body: any = {}
      if (req.method === 'POST') {
        let raw = ''
        for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) throw new HttpError(413, 'body too large') }
        try { body = raw ? JSON.parse(raw) : {} } catch { throw new HttpError(400, 'invalid json') }
      }
      const out = await routes[match](params, body, url.searchParams)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out))
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502
      if (status >= 500) console.error(req.method, url.pathname, (e as Error).message)
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }))
    }
  })

  return { server, ctx, ensureDemo }
}

if (import.meta.main) {
  const db = openDb()
  const exchanges = { paper: paperExchange(db), live: liveExchange(a => apiKeyFor(a)) }
  const { server, ctx, ensureDemo } = createApp(db, exchanges)
  server.listen(PORT, async () => {
    console.log(`nest agent on :${PORT} · exchange ${EXCHANGE} · data ${sosoMode()} · enclave ${inEnclave()} · journal ${journalAccount().address}`)
    await ensureDemo().catch(e => console.error('demo:', (e as Error).message))
    const loop = () => tick(ctx).catch(e => console.error('tick:', (e as Error).message)).finally(() => setTimeout(loop, LOOP_MS))
    loop()
  })
}

