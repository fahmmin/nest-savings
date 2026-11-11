// SoDEX signing. Rules and vectors: docs/research/sodex-testnet.md §2, Go/Python SDK golden vectors.
import { concatHex, keccak256, toHex, type Hex, type LocalAccount } from 'viem'

export const SODEX_CHAIN_ID = 138565
const ZERO = '0x0000000000000000000000000000000000000000' as const

/** A SET bit DISABLES the permission. */
export const PERM = { TRADE: 1, CANCEL: 2, WITHDRAW: 4, TRANSFER: 8 } as const
/** Trade-only agent key: CANCEL, WITHDRAW and TRANSFER disabled (TRADE and CANCEL cannot both stay on). */
export const AGENT_PERMISSIONS = PERM.CANCEL | PERM.WITHDRAW | PERM.TRANSFER // 14

const NAME_RE = /^[0-9a-zA-Z_-]{1,36}$/

export interface PermissionedKeyArgs {
  accountId: number
  name: string
  /** The API key's EVM address. */
  publicKey: Hex
  /** ms timestamp. */
  expiresAt: number
  permissions: number
  nonce: number
  chainId?: number
}

/**
 * EIP-712 typed data for `UserSignedAddPermissionedAPIKeyAction`, signed by the master wallet
 * (wagmi/viem signTypedData). Numbers stay plain JS numbers (all < 2^53) so it survives JSON.
 */
export function permissionedKeyTypedData(a: PermissionedKeyArgs) {
  if (!NAME_RE.test(a.name) || a.name === 'default') throw new Error(`bad API key name: ${a.name}`)
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.publicKey)) throw new Error('publicKey must be a 20-byte address')
  const chainId = a.chainId ?? SODEX_CHAIN_ID
  return {
    domain: { name: 'universal', version: '1', chainId, verifyingContract: ZERO },
    types: {
      UserSignedAddPermissionedAPIKeyAction: [
        { name: 'chainID', type: 'uint64' },
        { name: 'nonce', type: 'uint64' },
        { name: 'accountID', type: 'uint64' },
        { name: 'name', type: 'string' },
        { name: 'keyType', type: 'uint8' },
        { name: 'publicKey', type: 'bytes' },
        { name: 'expiresAt', type: 'uint64' },
        { name: 'permissions', type: 'uint64' },
      ],
    },
    primaryType: 'UserSignedAddPermissionedAPIKeyAction',
    message: {
      chainID: chainId, nonce: a.nonce, accountID: a.accountId, name: a.name, keyType: 1,
      publicKey: a.publicKey.toLowerCase() as Hex, expiresAt: a.expiresAt, permissions: a.permissions,
    },
  } as const
}

/** Body of POST /user/{addr}/api-keys in Go struct order. The nonce goes only in the header. */
export function permissionedKeyBody(a: PermissionedKeyArgs) {
  return { accountID: a.accountId, name: a.name, type: 1, publicKey: a.publicKey.toLowerCase(), expiresAt: a.expiresAt, permissions: a.permissions }
}

/** 65-byte r‖s‖v (v 27/28 or 0/1) → 66-byte SoDEX wire signature `prefix‖r‖s‖v` with v 0/1. */
export function toTypedSignature(sig: Hex, prefix: '0x01' | '0x02'): Hex {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error('expected a 65-byte signature')
  const v = parseInt(sig.slice(-2), 16)
  const v01 = v >= 27 ? v - 27 : v
  if (v01 !== 0 && v01 !== 1) throw new Error(`bad recovery byte ${v}`)
  return concatHex([prefix, `${sig.slice(0, -2)}0${v01}` as Hex])
}

/**
 * Canonical decimal string as Go shopspring/decimal marshals it: no exponent, no trailing
 * fractional zeros, no leading integer zeros, "0" for zero. "0.50"→"0.5", "1e-5"→"0.00001".
 */
export function canonicalDecimal(x: string | number): string {
  const s = typeof x === 'number' ? (Number.isFinite(x) ? String(x) : '') : x.trim()
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s)
  if (!m || (!m[2] && !m[3])) throw new Error(`not a decimal: ${x}`)
  let digits = (m[2] || '') + (m[3] || '')
  let point = (m[2] || '').length + Number(m[4] || 0) // position of the decimal point in `digits`
  if (point < 0) { digits = '0'.repeat(-point) + digits; point = 0 }
  if (point > digits.length) digits += '0'.repeat(point - digits.length)
  const int = digits.slice(0, point).replace(/^0+/, '') || '0'
  const frac = digits.slice(point).replace(/0+$/, '')
  const out = frac ? `${int}.${frac}` : int
  return m[1] === '-' && out !== '0' ? `-${out}` : out
}

/** One spot order item. Decimals are canonicalised; unset optionals are omitted. */
export interface SpotOrderItem {
  symbolID: number
  clOrdID: string
  side: 1 | 2 // BUY | SELL
  type: 1 | 2 // LIMIT | MARKET
  timeInForce: 1 | 3 | 4 // GTC | IOC | GTX
  price?: string
  quantity?: string
  funds?: string
}

/** `batchNewOrder` params in Go struct field order (BatchNewOrderRequest / BatchNewOrderItem). */
export function batchNewOrderParams(accountId: number, orders: SpotOrderItem[]) {
  if (orders.length < 1 || orders.length > 100) throw new Error('1..100 orders per batch')
  return {
    accountID: accountId,
    orders: orders.map(o => {
      // The regex also keeps JSON.stringify byte-identical to Go's json.Marshal (no <>& escaping).
      if (!NAME_RE.test(o.clOrdID)) throw new Error(`bad clOrdID: ${o.clOrdID}`)
      return {
        symbolID: o.symbolID, clOrdID: o.clOrdID, side: o.side, type: o.type, timeInForce: o.timeInForce,
        ...(o.price !== undefined ? { price: canonicalDecimal(o.price) } : {}),
        ...(o.quantity !== undefined ? { quantity: canonicalDecimal(o.quantity) } : {}),
        ...(o.funds !== undefined ? { funds: canonicalDecimal(o.funds) } : {}),
      }
    }),
  }
}

/** keccak256 of compact `{"type":…,"params":…}`; `params` must already be in Go struct order. */
export function payloadHash(type: string, paramsJson: string): Hex {
  return keccak256(toHex(`{"type":${JSON.stringify(type)},"params":${paramsJson}}`))
}

/**
 * Signs an `ExchangeAction{payloadHash, nonce}` (domain "spot" by default, prefix 0x01).
 * Returns the exact HTTP body to send, which is byte-identical to what was hashed.
 */
export async function signExchangeAction(
  account: LocalAccount, type: string, params: object, nonce: bigint | number,
  opts: { chainId?: number; domain?: 'spot' | 'futures' } = {},
): Promise<{ body: string; payloadHash: Hex; signature: Hex }> {
  const body = JSON.stringify(params)
  const hash = payloadHash(type, body)
  const sig = await account.signTypedData({
    domain: { name: opts.domain ?? 'spot', version: '1', chainId: opts.chainId ?? SODEX_CHAIN_ID, verifyingContract: ZERO },
    types: { ExchangeAction: [{ name: 'payloadHash', type: 'bytes32' }, { name: 'nonce', type: 'uint64' }] },
    primaryType: 'ExchangeAction',
    message: { payloadHash: hash, nonce: BigInt(nonce) },
  })
  return { body, payloadHash: hash, signature: toTypedSignature(sig, '0x01') }
}
