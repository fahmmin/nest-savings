import { useEffect, useState } from 'react'
import { useBaskets, useReplay, type Basket, type Replay } from '../api'
import { fmtPct, fmtUsd } from '../format'
import { ErrorNotice, Skeleton } from '../ui'

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

const W = 640, H = 260, L = 52, R = 12, T = 14, B = 28

/** Two value lines over time, with and without the floor, plus the floor line and the exit day. Plain SVG. */
export function ReplayChart({ r, compact = false }: { r: Replay; compact?: boolean }) {
  const pts = r.points
  if (pts.length < 2) return null
  const vals = pts.flatMap((p) => [p.withFloor, p.without])
  const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.02
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const path = (k: 'withFloor' | 'without') => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join('')
  const exitI = r.exitedAt !== undefined ? pts.findIndex((p) => p.t === r.exitedAt) : -1
  const floor = r.startUsd * (1 - r.floorPct / 100)
  const last = pts[pts.length - 1]
  const label = `Chart over ${pts.length} days. Without the floor the basket ends at ${fmtUsd(last.without)}; with the floor it ends at ${fmtUsd(last.withFloor)}.${exitI >= 0 ? ` The floor moved everything to dollars on day ${exitI}.` : ' The floor never triggered.'}`
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="rgba(35,42,84,.1)" /><text x={L - 6} y={y(v) + 4} textAnchor="end">{fmtUsd(v, 0)}</text></g>
      ))}
      {floor > lo && <g><line x1={L} x2={W - R} y1={y(floor)} y2={y(floor)} stroke="#8A5300" strokeDasharray="4 4" />{!compact && <text x={W - R} y={y(floor) - 5} textAnchor="end" style={{ fill: '#8A5300' }}>first floor {fmtUsd(floor, 0)}</text>}</g>}
      {exitI >= 0 && <line x1={x(exitI)} x2={x(exitI)} y1={T} y2={H - B} stroke="#232A54" strokeDasharray="2 3" />}
      <path d={path('without')} fill="none" stroke="#B42343" strokeWidth="2.5" strokeLinejoin="round" />
      <path d={path('withFloor')} fill="none" stroke="#3A61B6" strokeWidth="3" strokeLinejoin="round" />
      {!compact && <><text x={L} y={H - 8}>Day 0</text><text x={W - R} y={H - 8} textAnchor="end">Day {pts.length - 1}</text></>}
    </svg>
  )
}

export function Crash() {
  const baskets = useBaskets()
  const [basketId, setBasketId] = useState<Basket['id']>('growth')
  const [floorPct, setFloor] = useState(15)
  const [drop, setDrop] = useState(40)
  const q = useReplay(basketId, useDebounced(floorPct), useDebounced(drop))
  const r = q.data
  const events = r?.points.filter((p) => p.event) ?? []
  return (
    <>
      <div className="page-head">
        <h1>What happens in a crash?</h1>
        <p>A made-up price path, run through the same decision code the agent uses for real money: prices fall, then win back part of the fall. Change the crash size and your floor, and see both endings. No wallet needed.</p>
      </div>
      <section className="acard stack">
        <div className="controls">
          <div className="field">
            <label htmlFor="cr-basket">Basket</label>
            <select id="cr-basket" value={basketId} onChange={(e) => setBasketId(e.target.value as Basket['id'])}>
              {(baskets.data?.map((b) => b.basket) ?? [{ id: 'growth', name: 'Growth' } as Basket]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cr-drop">Crash size: prices fall <b>{fmtPct(drop, 0)}</b></label>
            <input id="cr-drop" type="range" min={5} max={90} value={drop} aria-valuetext={`${drop} percent`} onChange={(e) => setDrop(Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="cr-floor">Safety floor: <b>{fmtPct(floorPct, 0)}</b></label>
            <input id="cr-floor" type="range" min={5} max={50} value={floorPct} aria-valuetext={`${floorPct} percent`} onChange={(e) => setFloor(Number(e.target.value))} />
          </div>
        </div>
        {q.error && <ErrorNotice error={q.error} what="the crash replay" />}
        {q.isLoading && <Skeleton lines={6} label="Running the replay" />}
        {r && (
          <>
            <div className="legend" aria-hidden="true">
              <span><i style={{ background: '#3A61B6' }} />With your floor</span>
              <span><i style={{ background: '#B42343' }} />Without a floor</span>
              <span><i style={{ background: '#8A5300' }} />Floor line</span>
            </div>
            <div style={{ opacity: q.isFetching ? 0.6 : 1, transition: 'opacity .2s' }}><ReplayChart r={r} /></div>
            <div className="verdict" aria-live="polite">
              {r.exitedAt === undefined
                ? <span>The floor never triggered: the fall stayed above {fmtPct(r.floorPct, 0)}. Both end at {fmtUsd(r.points[r.points.length - 1].withFloor)}.</span>
                : r.savedUsd >= 0
                  ? <span>The floor saved you {fmtUsd(r.savedUsd)}.</span>
                  : <span>This time the floor cost {fmtUsd(-r.savedUsd)}: prices came back after Nest moved you to dollars.</span>}
              <span className="muted">Starting from {fmtUsd(r.startUsd, 0)}. With the floor you end at {fmtUsd(r.points[r.points.length - 1].withFloor)}, without it at {fmtUsd(r.points[r.points.length - 1].without)}. A floor trades some of the bounce-back for a limit on how much you can lose.</span>
            </div>
            {events.length > 0 && (
              <ol className="signals" aria-label="What happened">
                {events.map((p) => <li key={p.t}><b>Day {p.t}</b> {p.event}</li>)}
              </ol>
            )}
          </>
        )}
      </section>
    </>
  )
}
