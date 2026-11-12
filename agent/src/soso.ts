// Tiny SoSoValue OpenAPI client. Without SOSO_API_KEY it serves recorded fixtures from agent/fixtures/soso.
// Imported (not read from disk) so they are bundled when the agent runs on Cloudflare Workers.
import etfBtc from '../fixtures/soso/etf-btc.json' with { type: 'json' }
import etfEth from '../fixtures/soso/etf-eth.json' with { type: 'json' }
import fgi from '../fixtures/soso/fgi.json' with { type: 'json' }
import news from '../fixtures/soso/news.json' with { type: 'json' }

const FIXTURES: Record<string, { data: unknown }> = { 'etf-btc': etfBtc, 'etf-eth': etfEth, fgi, news }

const BASE = 'https://openapi.sosovalue.com/openapi/v1'
const TTL_MS = 10 * 60_000
const cache = new Map<string, { at: number; data: unknown }>()

export interface EtfDay { date: string; total_net_inflow: number | null; total_value_traded: number | null; total_net_assets: number | null; cum_net_inflow: number | null }
export type FgiRow = { timestamp: string; 'crypto_fear_&_greed_index'?: number }
export interface NewsItem { id: string; title: string | null; source_link: string; release_time: number; matched_currencies?: { name: string }[]; tags?: string[] }

export const sosoMode = (): 'live' | 'fixtures' => (process.env.SOSO_API_KEY ? 'live' : 'fixtures')

/** GET `path` (with query) and return the envelope's `data`. On error or 429, falls back to the last cached value. */
export async function soso<T>(path: string, fixture: string): Promise<T> {
  const key = process.env.SOSO_API_KEY
  if (!key) return structuredClone(FIXTURES[fixture].data) as T
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T
  try {
    const res = await fetch(BASE + path, { headers: { 'x-soso-api-key': key }, signal: AbortSignal.timeout(10_000) })
    const body = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: T } | null
    if (!res.ok || body?.code !== 0) throw new Error(`SoSoValue ${path.split('?')[0]}: HTTP ${res.status} ${body?.message ?? ''}`.trim())
    cache.set(path, { at: Date.now(), data: body.data })
    return body.data as T
  } catch (e) {
    if (hit) return hit.data as T
    throw e
  }
}

export const etfHistory = (asset: 'BTC' | 'ETH') =>
  soso<EtfDay[]>(`/etfs/summary-history?symbol=${asset}&country_code=US&limit=10`, `etf-${asset.toLowerCase()}`)
export const fearGreed = () => soso<FgiRow[]>('/analyses/fgi_indicator?limit=10', 'fgi')
export const featuredNews = async () => (await soso<{ list: NewsItem[] }>('/news/pick?page=1&page_size=50&language=en', 'news')).list
