import { useBaskets, useHealth, type BasketView } from '../api'
import { assetName, fmtDate } from '../format'
import { ErrorNotice, ExtLink, RiskChip, Skeleton, Weights } from '../ui'

export const cadence = (h: number) => (h === 24 * 7 ? 'weekly' : h === 24 ? 'daily' : h % 24 === 0 ? `every ${h / 24} days` : `every ${h} hours`)

/** Signals that moved this basket: only assets it holds (the dollars signal only if it holds dollars). */
export const signalsFor = (b: BasketView) => b.signals.filter((s) => s.symbol in b.basket.weights)

export function BasketCard({ view, cta = true }: { view: BasketView; cta?: boolean }) {
  const { basket, target } = view
  const sig = signalsFor(view)
  const id = `bk-${basket.id}`
  return (
    <section className="acard bk-card" aria-labelledby={id}>
      <div className="acard-head" style={{ marginBottom: 0 }}>
        <h2 id={id}>{basket.name}</h2>
        <RiskChip risk={basket.risk} />
      </div>
      <p>{basket.blurb}</p>
      <Weights label={`${basket.name}: today's mix compared with its usual mix`}
        rows={Object.keys(basket.weights).map((s) => ({ symbol: s, now: target[s] ?? basket.weights[s], mark: basket.weights[s], markLabel: 'usual' }))} />
      <p className="hint">Bars show today's mix. The dark tick is the usual mix. Kept on target {cadence(basket.cadenceHours)}, or sooner if it drifts.</p>
      {sig.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <h3 className="muted" style={{ fontSize: 13 }}>Why today's mix differs</h3>
          <ul className="signals">
            {sig.map((s) => (
              <li key={s.id}>
                <span>{s.text} {s.tilt !== 0 && <span className="muted">({s.tilt > 0 ? 'a little more' : 'a little less'} {assetName(s.symbol)})</span>}</span>
                <ExtLink href={s.source.url}>{s.source.label}, {fmtDate(s.asOf)}</ExtLink>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cta && <a className="abtn" href={`#start-${basket.id}`} style={{ justifySelf: 'start' }}>Start with this basket<span className="sr-only">: {basket.name}</span></a>}
    </section>
  )
}

export function Discover() {
  const q = useBaskets()
  const demo = useHealth().data?.demoAddress
  return (
    <>
      <div className="page-head">
        <h1>Pick a ready-made basket</h1>
        <p>Four baskets, from careful to bold. Nest keeps yours on target and leans a little toward or away from an asset when SoSoValue data on big-fund flows and market mood says so. Every lean is explained below with its source.</p>
        {demo && <p><a className="link" href={`#home-${demo}`}>See a live demo account →</a></p>}
      </div>
      {q.isLoading && <div className="baskets">{[0, 1, 2, 3].map((i) => <div className="acard" key={i}><Skeleton lines={5} label="Loading baskets" /></div>)}</div>}
      {q.error && <ErrorNotice error={q.error} what="the baskets" />}
      {q.data && <div className="baskets">{q.data.map((v) => <BasketCard key={v.basket.id} view={v} />)}</div>}
    </>
  )
}
