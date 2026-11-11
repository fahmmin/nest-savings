// Pure formatting helpers (no React, no Vite): unit tested in test/helpers.test.ts.
import { CASH, type Symbol } from './types.ts'

const nf = (frac: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: frac, maximumFractionDigits: frac })

/** "$1,234.56". Whole dollars above $10,000. */
export function fmtUsd(n: number, frac = Math.abs(n) >= 10_000 ? 0 : 2): string {
  return (n < 0 ? '-$' : '$') + nf(frac).format(Math.abs(n))
}

/** "+$12.30" / "-$4.00". */
export const fmtSignedUsd = (n: number) => (n >= 0 ? '+' : '') + fmtUsd(n)

export const fmtPct = (n: number, frac = 1) => `${nf(frac).format(n)}%`
export const fmtSignedPct = (n: number, frac = 1) => (n >= 0 ? '+' : '') + fmtPct(n, frac)

export const short = (s: string, head = 6, tail = 4) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s)

export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

/** "vBTC_vUSDC" -> "vBTC". */
export const baseOf = (s: Symbol) => s.split('_')[0]

const NAMES: Record<string, string> = {
  [CASH]: 'Dollars',
  vBTC: 'Bitcoin',
  vNVDA: 'Nvidia',
  vDEFIssi: 'Crypto apps',
  vETH: 'Ether',
  vSOL: 'Solana',
}

/** Plain name for a SoDEX symbol: "vBTC_vUSDC" -> "Bitcoin". Unknown symbols keep their ticker. */
export const assetName = (s: Symbol) => NAMES[baseOf(s)] ?? baseOf(s)

/** Value at which the floor triggers for a given start value. */
export const floorValue = (startUsd: number, floorPct: number) => startUsd * (1 - floorPct / 100)

/** "If $1,000 falls to $850, Nest moves you to dollars." */
export const floorExample = (floorPct: number, startUsd = 1000) =>
  `If ${fmtUsd(startUsd, 0)} falls to ${fmtUsd(floorValue(startUsd, floorPct), 0)}, Nest moves you to dollars.`

/** Turns wallet, network and agent errors into one plain sentence. */
export function explain(e: unknown): string {
  const any = e as { name?: string; shortMessage?: string; message?: string; code?: number } | undefined
  if (!any) return 'Something went wrong.'
  if (any.name === 'UserRejectedRequestError' || any.code === 4001 || /reject|denied/i.test(any.message ?? '')) return 'You cancelled the request in your wallet.'
  if (any.name === 'ProviderNotFoundError') return 'No browser wallet found. Install one, such as MetaMask or Rabby, and reload.'
  return any.shortMessage ?? any.message ?? String(e)
}
