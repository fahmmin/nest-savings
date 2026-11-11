// Shared contract between the agent modules and the app (app/src/api.ts mirrors these).
// Amounts in USDC are plain numbers (testnet values are small); quantities sent to SoDEX are decimal strings.

export type Address = `0x${string}`

/** A SoDEX spot symbol, e.g. "vBTC_vUSDC". Cash (vUSDC) is represented by the symbol "vUSDC". */
export type Symbol = string
export const CASH: Symbol = 'vUSDC'

export interface Basket {
  id: 'steady' | 'balanced' | 'growth' | 'crypto'
  name: string
  /** One plain sentence for beginners. */
  blurb: string
  /** Plain-word risk label shown on the card. */
  risk: 'Low' | 'Medium' | 'High'
  /** Base weights in percent, summing to 100. Keys are symbols (CASH allowed). */
  weights: Record<Symbol, number>
  /** Rebalance at least this often even without drift. */
  cadenceHours: number
}

/** One SoSoValue-derived signal and the tilt it implies. */
export interface Signal {
  id: string
  /** Asset the tilt applies to (CASH means risk-off/on). */
  symbol: Symbol
  /** -1..1, positive means hold more of `symbol`. */
  tilt: number
  /** One plain sentence: "Big funds put $412M into Bitcoin ETFs over the last 5 days." */
  text: string
  source: { label: string; url: string }
  asOf: string // ISO date of the data
}

export interface BookTop { bid: number; ask: number; bidSz: number; askSz: number }
export type Books = Record<Symbol, BookTop>

/** Balances by symbol in base units (CASH in USDC). */
export type Balances = Record<Symbol, number>

export interface Order {
  symbol: Symbol // e.g. "vBTC_vUSDC", never CASH
  side: 'buy' | 'sell'
  /** Base quantity as a canonical decimal string, already rounded to stepSize. */
  quantity: string
  /** Limit price (IOC) as a canonical decimal string, already rounded to tickSize. */
  price: string
  /** Estimated notional in USDC, for logs and min-notional checks. */
  notional: number
}

/** Per-symbol trading rules from GET /spot/markets/symbols, numbers parsed. */
export interface SymbolFilter { symbol: Symbol; id: number; tickSize: number; stepSize: number; minQuantity: number; minNotional: number; pricePrecision: number; quantityPrecision: number }
export type Filters = Record<Symbol, SymbolFilter>

/** Implemented by exchange/live.ts (SoDEX testnet) and exchange/paper.ts (sqlite balances, live books). */
export interface Exchange {
  filters(): Promise<Filters>
  books(symbols: Symbol[]): Promise<Books>
  balances(user: Pick<UserRecord, 'address' | 'accountId' | 'mode'>): Promise<Balances>
  /** Places orders in the given sequence (sells before buys is the caller's job). Never throws for a rejected order: returns it as a Fill. */
  place(user: Pick<UserRecord, 'address' | 'accountId' | 'mode' | 'apiKeyName'>, orders: Order[]): Promise<Fill[]>
}

export interface Fill { order: Order; status: 'filled' | 'partial' | 'rejected' | 'skipped'; filledQty: number; avgPrice: number; error?: string; orderId?: string }

export interface UserRules {
  basketId: Basket['id']
  /** Exit to cash if value falls this many percent below its high-water mark. 5..50. */
  floorPct: number
  /** Optional ISO date: cash out everything at this time. */
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
  /** Plain sentence for the user. */
  text: string
  sources: { label: string; url: string }[]
  fills: Fill[]
  valueUsd: number
  /** EIP-191 signature by the journal key over `journalDigest(entry without signature)`. */
  signature: `0x${string}`
  signer: Address
}

export interface Holding { symbol: Symbol; qty: number; valueUsd: number; weight: number; target: number }

export interface UserView extends UserRecord {
  valueUsd: number
  holdings: Holding[]
  /** Value at which the floor triggers. */
  floorUsd: number
  apiKey?: { name: string; publicKey: Address; permissions?: number; canWithdraw: boolean; canTransfer: boolean; source: string }
}

export interface Health {
  ok: true
  network: 'testnet'
  exchange: 'live' | 'paper'
  enclave: boolean
  /** Address that signs every journal entry. */
  journalSigner: Address
  attestationUrl?: string
  sosoData: 'live' | 'fixtures'
  lastLoopAt?: string
}

/** Crash replay: same basket and rules, with and without the floor. */
export interface ReplayPoint { t: number; price: Record<Symbol, number>; withFloor: number; without: number; event?: string }
export interface Replay { basketId: Basket['id']; floorPct: number; startUsd: number; points: ReplayPoint[]; exitedAt?: number; savedUsd: number }
