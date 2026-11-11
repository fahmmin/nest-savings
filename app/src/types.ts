// Mirror of agent/src/types.ts (the contract with the agent). Keep in sync by hand; do not add app-only fields here.
// The agent-internal Exchange interface is left out because the app never implements it.

export type Address = `0x${string}`

/** A SoDEX spot symbol, e.g. "vBTC_vUSDC". Cash (vUSDC) is represented by the symbol "vUSDC". */
export type Symbol = string
export const CASH: Symbol = 'vUSDC'

export interface Basket {
  id: 'steady' | 'balanced' | 'growth' | 'crypto'
  name: string
  blurb: string
  risk: 'Low' | 'Medium' | 'High'
  weights: Record<Symbol, number>
  cadenceHours: number
}

export interface Signal {
  id: string
  symbol: Symbol
  tilt: number
  text: string
  source: { label: string; url: string }
  asOf: string
}

export interface BookTop { bid: number; ask: number; bidSz: number; askSz: number }
export type Books = Record<Symbol, BookTop>
export type Balances = Record<Symbol, number>

export interface Order { symbol: Symbol; side: 'buy' | 'sell'; quantity: string; price: string; notional: number }

export interface SymbolFilter { symbol: Symbol; id: number; tickSize: number; stepSize: number; minQuantity: number; minNotional: number; pricePrecision: number; quantityPrecision: number }
export type Filters = Record<Symbol, SymbolFilter>

export interface Fill { order: Order; status: 'filled' | 'partial' | 'rejected' | 'skipped'; filledQty: number; avgPrice: number; error?: string; orderId?: string }

export interface UserRules {
  basketId: Basket['id']
  floorPct: number
  cashOutAt?: string
}

export type UserStatus = 'active' | 'exited' | 'paused'

export interface UserRecord extends UserRules {
  address: Address
  accountId: number
  mode: 'live' | 'paper'
  status: UserStatus
  hwmUsd: number
  apiKeyName: string
  linkedAt: string
  lastRebalanceAt?: string
}

export type Decision =
  | { kind: 'hold'; reason: string }
  | { kind: 'rebalance'; reason: string; orders: Order[] }
  | { kind: 'exit'; reason: 'floor' | 'cashOutDate'; text: string; orders: Order[] }

export interface LogEntry {
  id: number
  ts: string
  address: Address
  kind: 'link' | 'rebalance' | 'exit' | 'hold' | 'skip' | 'settings' | 'resume'
  text: string
  sources: { label: string; url: string }[]
  fills: Fill[]
  valueUsd: number
  signature: `0x${string}`
  signer: Address
}

export interface Holding { symbol: Symbol; qty: number; valueUsd: number; weight: number; target: number }

export interface UserView extends UserRecord {
  valueUsd: number
  holdings: Holding[]
  floorUsd: number
  apiKey?: { name: string; publicKey: Address; permissions?: number; canWithdraw: boolean; canTransfer: boolean; source: string }
}

export interface Health {
  ok: true
  network: 'testnet'
  exchange: 'live' | 'paper'
  enclave: boolean
  journalSigner: Address
  attestationUrl?: string
  sosoData: 'live' | 'fixtures'
  lastLoopAt?: string
}

export interface ReplayPoint { t: number; price: Record<Symbol, number>; withFloor: number; without: number; event?: string }
export interface Replay { basketId: Basket['id']; floorPct: number; startUsd: number; points: ReplayPoint[]; exitedAt?: number; savedUsd: number }
