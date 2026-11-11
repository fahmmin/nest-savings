import { createContext, useContext, type ReactNode } from 'react'
import { AgentError, type Basket, type Symbol } from './api'
import { AGENT_URL } from './config'
import { assetName, explain, fmtPct } from './format'
import type { Address } from './types.ts'

/** The Nest mark: a woven nest holding three eggs. */
export const Logo = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="22" cy="30" rx="8" ry="10" fill="currentColor" opacity=".62" />
    <ellipse cx="42" cy="30" rx="8" ry="10" fill="currentColor" opacity=".62" />
    <ellipse cx="32" cy="27" rx="8.5" ry="11" fill="currentColor" opacity=".85" />
    <path d="M6 34h52c-2 13-12 21-26 21S8 47 6 34z" fill="currentColor" />
  </svg>
)

/** Read-only view of another address (#home-<address>). While set, screens hide every write action. */
export const ViewAsContext = createContext<Address | undefined>(undefined)
export const useViewAs = () => useContext(ViewAsContext)

export type Tone = 'ok' | 'warn' | 'bad' | 'acc' | 'plain'
export const Chip = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`chip ${tone}`}>{children}</span>

export const riskTone = (r: Basket['risk']): Tone => (r === 'Low' ? 'ok' : r === 'Medium' ? 'warn' : 'bad')
export const RiskChip = ({ risk }: { risk: Basket['risk'] }) => <Chip tone={riskTone(risk)}>{risk} risk</Chip>

/** Open Bucket stat card: label, big value, one line under it; a skeleton while loading. */
export function Stat({ label, value, unit, sub }: { label: string; value?: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      {value === undefined ? <span className="skel" style={{ width: '60%', height: 30 }} /> : <strong className="stat-value">{value}{unit && <small>{unit}</small>}</strong>}
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

export const Notice = ({ tone, children }: { tone?: 'bad' | 'warn' | 'ok'; children: ReactNode }) => (
  <div className={`notice ${tone ?? ''}`} role={tone === 'bad' ? 'alert' : undefined}>{children}</div>
)

/** One error notice for every failed fetch; an unreachable agent gets its own plain explanation. */
export function ErrorNotice({ error, what }: { error: unknown; what: string }) {
  if (error instanceof AgentError && error.offline)
    return (
      <Notice tone="bad">
        <p><b>The Nest agent is not answering, so {what} can't load right now.</b></p>
        <p>Nothing is lost: your money stays in your own account. Try again in a minute. (Looked for it at <code>{AGENT_URL}</code>.)</p>
      </Notice>
    )
  return <Notice tone="bad">Could not load {what}: {explain(error)}</Notice>
}

export const Skeleton = ({ lines = 3, label }: { lines?: number; label: string }) => (
  <div className="skel-card" role="status" aria-label={label}>
    {Array.from({ length: lines }, (_, i) => <span key={i} className="skel" style={{ width: `${90 - i * 18}%` }} />)}
  </div>
)

/** Cairn's series colours, one per asset in a basket (fills only, never text). */
export const SERIES = ['#E2C47D', '#5FD49A', '#93A8FF', '#B9A3E3', '#E39A9A']
const ORDER = ['vUSDC', 'vBTC', 'vNVDA', 'vDEFIssi']
export const colorOf = (s: Symbol) => {
  const i = ORDER.indexOf(s.split('_')[0])
  return SERIES[(i < 0 ? ORDER.length : i) % SERIES.length]
}

/** Weight bars: each asset's share, with an optional marker for a second weight (base or target). */
export function Weights({ rows, label }: { rows: { symbol: Symbol; now: number; mark?: number; markLabel?: string }[]; label: string }) {
  return (
    <ul className="weights" aria-label={label}>
      {rows.map((r) => (
        <li key={r.symbol}>
          <span><i className="sw" style={{ ['--c' as string]: colorOf(r.symbol) }} aria-hidden="true" />{assetName(r.symbol)}</span>
          <span className="wbar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, r.now)}%`, ['--c' as string]: colorOf(r.symbol) }} />
            {r.mark !== undefined && <s style={{ left: `calc(${Math.min(100, r.mark)}% - 1px)` }} />}
          </span>
          <b>{fmtPct(r.now, 0)}{r.mark !== undefined && <small> {r.markLabel ?? 'vs'} {fmtPct(r.mark, 0)}</small>}</b>
        </li>
      ))}
    </ul>
  )
}

/** Cairn's basket drawing: one stone per asset, sized by weight, biggest at the base. */
const JX = [0, -3, 2.5, -2, 3], JR = [0, -4, 3, -3, 4]
export function Stones({ weights }: { weights: Record<Symbol, number> }) {
  const st = Object.entries(weights).map(([s, w]) => ({ w, c: colorOf(s), rx: 0, ry: 0, cx: 0, cy: 0, rot: 0 })).sort((a, b) => b.w - a.w)
  if (!st.length) return null
  const max = st[0].w
  let y = 97
  st.forEach((s, i) => { s.rx = (10 + 36 * Math.pow(s.w / max, 0.75)) * (1 - 0.06 * i); s.ry = s.rx * 0.42 })
  st.forEach((s, i) => { y -= i ? (st[i - 1].ry + s.ry) * 0.78 : s.ry; s.cx = 50 + (JX[i % 5] * s.rx) / 30; s.cy = y; s.rot = JR[i % 5] })
  const top = y - st[st.length - 1].ry, k = top < 3 ? 94 / (97 - top) : 1
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><radialGradient id="gloss" cx=".36" cy=".3" r=".78"><stop offset="0" stopColor="#fff" stopOpacity=".32" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".3" /></radialGradient></defs>
      <ellipse cx="50" cy="97" rx="38" ry="3" fill="rgba(16,22,58,.22)" />
      <g transform={`translate(50 97) scale(${k.toFixed(3)}) translate(-50 -97)`}>
        {st.map((s, i) => {
          const e = { cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry, transform: `rotate(${s.rot} ${s.cx} ${s.cy})` }
          return <g key={i}><ellipse {...e} fill={s.c} stroke="rgba(0,0,0,.3)" strokeWidth=".6" /><ellipse {...e} fill="url(#gloss)" /></g>
        })}
      </g>
    </svg>
  )
}

export const ExtLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">{children}<span className="sr-only"> (opens in a new tab)</span></a>
)
