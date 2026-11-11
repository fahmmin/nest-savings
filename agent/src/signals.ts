import { CASH } from './types.ts'
import type { Signal, Symbol } from './types.ts'
import { BTC, DEFI, NVDA } from './baskets.ts'
import { etfHistory, fearGreed, featuredNews } from './soso.ts'
import type { EtfDay, FgiRow, NewsItem } from './soso.ts'

export interface RawSignals { btc: EtfDay[]; eth: EtfDay[]; fgi: FgiRow[] }

const FGI_KEY = 'crypto_fear_&_greed_index'
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const round2 = (x: number) => Math.round(x * 100) / 100

/** $412M, $1.2B. */
export function usdShort(x: number): string {
  const a = Math.abs(x)
  return a >= 1e9 ? `$${+(a / 1e9).toFixed(1)}B` : `$${Math.round(a / 1e6)}M`
}

/** Sum of the newest 5 settled days (rows with a null flow are the unsettled newest day). */
function settledSum(rows: EtfDay[]): { sum: number; days: number; asOf: string } {
  const settled = rows.filter((r) => typeof r.total_net_inflow === 'number').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
  return { sum: settled.reduce((s, r) => s + (r.total_net_inflow as number), 0), days: settled.length, asOf: settled[0]?.date ?? '' }
}

function etfSignal(id: string, symbol: Symbol, rows: EtfDay[], scale: number, fund: string, url: string, extra = ''): Signal {
  const { sum, days, asOf } = settledSum(rows)
  const moved = sum >= 0 ? `put ${usdShort(sum)} into` : `pulled ${usdShort(sum)} out of`
  return {
    id,
    symbol,
    tilt: round2(clamp(sum / scale, -1, 1)),
    text: `Big funds ${moved} ${fund} ETFs over the last ${days} days${extra}.`,
    source: { label: `SoSoValue: US ${fund} spot ETF flows`, url },
    asOf,
  }
}

/** Pure: raw SoSoValue rows -> the three design signals. */
export function signalsFrom(raw: RawSignals): Signal[] {
  const out = [
    etfSignal('btc-etf-flow', BTC, raw.btc, 1e9, 'Bitcoin', 'https://sosovalue.com/assets/etf/us-btc-spot'),
    etfSignal('eth-etf-flow', DEFI, raw.eth, 3e8, 'Ethereum', 'https://sosovalue.com/assets/etf/us-eth-spot', ', which tends to move crypto apps'),
  ]
  const row = raw.fgi.find((r) => typeof r[FGI_KEY] === 'number')
  if (row) {
    const v = row[FGI_KEY] as number
    const [tilt, mood] = v > 75 ? [1, `People are very greedy right now (mood score ${v} of 100), so Nest keeps a little more in dollars.`]
      : v < 25 ? [-0.5, `People are very fearful right now (mood score ${v} of 100), so Nest keeps a little less in dollars.`]
      : [0, `Market mood is calm (score ${v} of 100), so Nest makes no change for it.`]
    out.push({
      id: 'fear-greed',
      symbol: CASH,
      tilt: tilt as number,
      text: mood as string,
      source: { label: 'SoSoValue: Crypto Fear & Greed Index', url: 'https://sosovalue.com/dashboard/fgi-indicator' },
      asOf: new Date(Number(row.timestamp)).toISOString().slice(0, 10),
    })
  }
  return out
}

export async function getSignals(): Promise<Signal[]> {
  const [btc, eth, fgi] = await Promise.all([etfHistory('BTC'), etfHistory('ETH'), fearGreed()])
  return signalsFrom({ btc, eth, fgi })
}

const NEWS_MATCH: Record<Symbol, { coins: string[]; words: RegExp }> = {
  [BTC]: { coins: ['BTC'], words: /bitcoin|\bbtc\b/i },
  [NVDA]: { coins: ['NVDA'], words: /nvidia|\bnvda\b/i },
  [DEFI]: { coins: ['ETH', 'UNI', 'AAVE'], words: /ethereum|\beth\b|defi/i },
}

/** Pure: newest titled featured item about `symbol`. */
export function newsFor(symbol: Symbol, list: NewsItem[]): { label: string; url: string } | undefined {
  const m = NEWS_MATCH[symbol]
  if (!m) return undefined
  const hit = [...list]
    .sort((a, b) => b.release_time - a.release_time)
    .find((n) => n.title && (n.matched_currencies?.some((c) => m.coins.includes(c.name.toUpperCase())) || m.words.test(n.title) || n.tags?.some((t) => m.coins.includes(t.toUpperCase()))))
  return hit ? { label: hit.title as string, url: hit.source_link } : undefined
}

export async function topNews(symbol: Symbol): Promise<{ label: string; url: string } | undefined> {
  return newsFor(symbol, await featuredNews())
}
