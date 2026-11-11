// Minimal SoDEX testnet REST client. Endpoints and rules: docs/research/sodex-testnet.md §2-§4.
import type { Hex, LocalAccount } from 'viem'
import { CASH } from '../types.ts'
import type { Address, Balances, Books, Fill, Filters, Order, SymbolFilter } from '../types.ts'
import {
  SODEX_CHAIN_ID, batchNewOrderParams, permissionedKeyBody, signExchangeAction, toTypedSignature,
  type PermissionedKeyArgs,
} from './sign.ts'

export const SODEX_BASE = 'https://testnet-gw.sodex.dev/api/v1'

export class SodexError extends Error {
  code: number
  constructor(message: string, code: number) { super(message); this.code = code }
}

async function call<T>(method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(SODEX_BASE + path, {
    method, body, signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
  })
  const text = await res.text()
  let json: { code: number; error?: string; data: T }
  // uint64 order/trade IDs can exceed 2^53: keep them as strings.
  try { json = JSON.parse(text.replace(/"(orderID|tradeID)":(\d+)/g, '"$1":"$2"')) } catch {
    throw new SodexError(`SoDEX ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`, res.status)
  }
  // Errors come back as HTTP 200 with a negative code.
  if (!res.ok || json.code !== 0) throw new SodexError(`SoDEX ${method} ${path}: ${json.error ?? `code ${json.code}`}`, json.code ?? res.status)
  return json.data
}

const lastNonce = new Map<string, number>()
/** Strictly increasing ms nonce per signer address (the engine tracks nonces per signer). */
export function nextNonce(signer: string): number {
  const k = signer.toLowerCase()
  const n = Math.max(Date.now(), (lastNonce.get(k) ?? 0) + 1)
  lastNonce.set(k, n)
  return n
}

// ---------- market data ----------

export interface RawSymbol { id: number; name: string; baseCoin: string; tickSize: string; stepSize: string; minQuantity: string; minNotional: string; pricePrecision: number; quantityPrecision: number; status: string }

export function parseFilters(data: RawSymbol[]): Filters {
  const out: Filters = {}
  for (const s of data) {
    if (s.status !== 'TRADING') continue
    out[s.name] = {
      symbol: s.name, id: s.id, tickSize: +s.tickSize, stepSize: +s.stepSize, minQuantity: +s.minQuantity,
      minNotional: +s.minNotional, pricePrecision: s.pricePrecision, quantityPrecision: s.quantityPrecision,
    }
  }
  return out
}

/** Balance coin name → our symbol. Coin names differ from symbol names ("vDEFI.ssi" → "vDEFIssi_vUSDC"). */
export function coinSymbols(data: RawSymbol[]): Record<string, string> {
  return Object.fromEntries([['vUSDC', CASH], ...data.map(s => [s.baseCoin, s.name])])
}

let symbolsCache: { at: number; data: Promise<RawSymbol[]> } | undefined
function symbols(): Promise<RawSymbol[]> {
  if (!symbolsCache || Date.now() - symbolsCache.at > 3_600_000) {
    const data = call<RawSymbol[]>('GET', '/spot/markets/symbols')
    symbolsCache = { at: Date.now(), data }
    data.catch(() => { symbolsCache = undefined })
  }
  return symbolsCache.data
}

export const filters = async (): Promise<Filters> => parseFilters(await symbols())

export interface RawBookTicker { symbol: string; bidPx: string; bidSz: string; askPx: string; askSz: string }

/** "0" price means that side is empty; a symbol missing from bookTickers has an empty book. */
export function parseBooks(data: RawBookTicker[], wanted: string[]): Books {
  const by = new Map(data.map(t => [t.symbol, t]))
  const out: Books = {}
  for (const s of wanted) {
    const t = by.get(s)
    const bid = +(t?.bidPx ?? 0), ask = +(t?.askPx ?? 0)
    out[s] = { bid, ask, bidSz: bid > 0 ? +t!.bidSz : 0, askSz: ask > 0 ? +t!.askSz : 0 }
  }
  return out
}

export const books = async (wanted: string[]): Promise<Books> =>
  parseBooks(await call<RawBookTicker[]>('GET', '/spot/markets/bookTickers'), wanted.filter(s => s !== CASH))

// ---------- account reads (public by address) ----------

export interface RawBalance { id: number; coin: string; total: string; locked: string }

/** Available (total − locked) by symbol; CASH always present. Coins without a spot symbol are dropped. */
export function parseBalances(data: { balances: RawBalance[] }, coinToSymbol: Record<string, string>): Balances {
  const out: Balances = { [CASH]: 0 }
  for (const b of data.balances ?? []) {
    const sym = coinToSymbol[b.coin]
    if (sym) out[sym] = (out[sym] ?? 0) + Math.max(0, +b.total - +b.locked)
  }
  return out
}

export async function balances(address: Address, accountId: number): Promise<Balances> {
  const [data, syms] = await Promise.all([
    call<{ balances: RawBalance[] }>('GET', `/spot/accounts/${address}/balances?accountID=${accountId}`), symbols()])
  return parseBalances(data, coinSymbols(syms))
}

/** SoDEX accountID of the address, or null when the account is not activated (aid == 0). */
export async function accountIdOf(address: Address): Promise<number | null> {
  const s = await call<{ aid: number }>('GET', `/spot/accounts/${address}/state`)
  return s.aid ? s.aid : null
}

export interface ApiKeyInfo { name: string; type: string; publicKey: string; expiresAt: number; permissions?: number }

/** Registered API keys on both engines. A key is usable only when present in both. */
export function apiKeysOf(address: Address, opts: { accountId?: number; name?: string } = {}) {
  const q = new URLSearchParams({
    ...(opts.accountId ? { accountID: String(opts.accountId) } : {}), ...(opts.name ? { name: opts.name } : {}),
  }).toString()
  return call<{ spot: ApiKeyInfo[]; perps: ApiKeyInfo[] }>('GET', `/user/${address}/api-keys${q ? `?${q}` : ''}`)
}

export interface RawOrder { symbol: string; orderID: string; clOrdID: string; side: string; price?: string; origQty?: string; status: string; executedQty: string; executedValue: string }

export const orderHistory = (address: Address, accountId: number, symbol: string, limit = 50) =>
  call<RawOrder[]>('GET', `/spot/accounts/${address}/orders/history?symbol=${symbol}&accountID=${accountId}&limit=${limit}`)

// ---------- signed actions ----------

/**
 * Submits a master-wallet signature over `permissionedKeyTypedData(args)`. `signature` is the
 * wallet's 65-byte signature (v 27/28 is fine) or an already-prefixed 0x02 wire signature.
 */
export async function registerPermissionedKey(master: Address, args: PermissionedKeyArgs, signature: Hex): Promise<void> {
  const sig = signature.length === 132 ? toTypedSignature(signature, '0x02') : signature
  if (!/^0x02[0-9a-fA-F]{130}$/.test(sig)) throw new Error('expected a 65-byte wallet signature')
  await call('POST', `/user/${master}/api-keys`, JSON.stringify(permissionedKeyBody(args)), {
    'X-API-Chain': String(args.chainId ?? SODEX_CHAIN_ID), 'X-API-Nonce': String(args.nonce), 'X-API-Sign': sig,
  })
}

export interface BatchResult { code: number; clOrdID: string; orderID?: string; error?: string }

let seq = 0
const newClOrdID = () => `nest${Date.now().toString(36)}${(seq++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Read the finished IOC order back by clOrdID. Undefined if it is not in history yet. */
async function settled(user: { address: Address; accountId: number }, symbol: string, clOrdID: string, waitMs: number[]) {
  for (const ms of waitMs) {
    await sleep(ms)
    const hit = (await orderHistory(user.address, user.accountId, symbol).catch(() => [])).find(o => o.clOrdID === clOrdID)
    if (hit) return hit
  }
}

/**
 * Places IOC limit orders signed by the user's API key and maps each to a Fill.
 * Acceptance is not a fill: filledQty/avgPrice come from order history (executedQty/executedValue).
 */
export async function batchNewOrder(
  user: { address: Address; accountId: number }, orders: Order[], apiKeyAccount: LocalAccount, apiKeyName: string,
  opts: { pollMs?: number[] } = {},
): Promise<Fill[]> {
  const f = await filters()
  const items = orders.map(o => ({ o, f: f[o.symbol] as SymbolFilter | undefined, clOrdID: newClOrdID() }))
  const fills: (Fill | undefined)[] = items.map(({ o, f }) =>
    f ? undefined : { order: o, status: 'rejected', filledQty: 0, avgPrice: 0, error: `unknown symbol ${o.symbol}` })
  const send = items.filter((_, i) => !fills[i])
  if (!send.length) return fills as Fill[]

  const params = batchNewOrderParams(user.accountId, send.map(({ o, f, clOrdID }) => ({
    symbolID: f!.id, clOrdID, side: o.side === 'buy' ? 1 : 2, type: 1, timeInForce: 3, price: o.price, quantity: o.quantity,
  })))
  const nonce = nextNonce(apiKeyAccount.address)
  const { body, signature } = await signExchangeAction(apiKeyAccount, 'batchNewOrder', params, nonce)
  let results: BatchResult[]
  try {
    results = (await call<BatchResult[] | null>('POST', '/spot/trade/orders/batch', body, {
      'X-API-Key': apiKeyName, 'X-API-Sign': signature, 'X-API-Nonce': String(nonce), 'X-API-Chain': String(SODEX_CHAIN_ID),
    })) ?? []
  } catch (e) {
    // Whole-batch failure. shortcut: a timeout here is reported as rejected; the next loop re-reads balances, so it self-corrects.
    const error = (e as Error).message
    for (const [i] of fills.entries()) fills[i] ??= { order: orders[i], status: 'rejected', filledQty: 0, avgPrice: 0, error }
    return fills as Fill[]
  }

  const byId = new Map(results.map(r => [r.clOrdID, r]))
  for (const [i, it] of items.entries()) {
    if (fills[i]) continue
    // A payload-level error returns one entry for the whole batch, so fall back to the first result.
    const r = byId.get(it.clOrdID) ?? (results.length === 1 && results[0].code !== 0 ? results[0] : undefined)
    if (!r || r.code !== 0) {
      fills[i] = { order: it.o, status: 'rejected', filledQty: 0, avgPrice: 0, error: r?.error ?? 'no result for order', orderId: r?.orderID }
      continue
    }
    const h = await settled(user, it.o.symbol, it.clOrdID, opts.pollMs ?? [400, 800, 1600, 3200])
    if (!h) {
      fills[i] = { order: it.o, status: 'rejected', filledQty: 0, avgPrice: 0, orderId: r.orderID, error: `accepted, fill not confirmed yet (clOrdID ${it.clOrdID})` }
      continue
    }
    const qty = +h.executedQty, value = +h.executedValue
    const want = +(h.origQty ?? it.o.quantity)
    fills[i] = {
      order: it.o, filledQty: qty, avgPrice: qty > 0 ? value / qty : 0, orderId: h.orderID ?? r.orderID,
      status: qty <= 0 ? 'rejected' : qty + 1e-12 >= want ? 'filled' : 'partial',
      ...(qty <= 0 ? { error: 'nobody traded at that price' } : {}),
    }
  }
  return fills as Fill[]
}
