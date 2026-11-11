import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBaskets, useHealth, useLog, useReplay, useUser, type Basket, type HealthView, type LogEntry, type UserView } from '../api'
import { BASKETS } from '../baskets'
import { SODEX_ONBOARDING } from '../config'
import { assetName, fmtPct, fmtUsd, floorExample } from '../format'
import { Logo, Stones, colorOf } from '../ui'
import { ReplayChart } from './Crash'
import '../landing.css'

const Phone = ({ children, cls = '' }: { children: ReactNode; cls?: string }) => (
  <div className={`phone ${cls}`} aria-hidden="true"><div className="scr">{children}</div></div>
)
const MiniBar = ({ w, c }: { w: number; c: string }) => <span className="m-bar"><i style={{ width: `${Math.min(100, w)}%`, background: c }} /></span>
const riskCls = (r: Basket['risk']) => (r === 'Low' ? '' : r === 'Medium' ? 'warn' : 'bad')

function BasketsMini({ baskets }: { baskets: Basket[] }) {
  return (
    <>
      <span className="m-title">Pick a basket</span>
      {baskets.map((b) => (
        <span className="m-card" key={b.id}>
          <span className="m-row"><b>{b.name}</b><span className={`m-chip ${riskCls(b.risk)}`}>{b.risk}</span></span>
          {Object.entries(b.weights).map(([s, w]) => <MiniBar key={s} w={w} c={colorOf(s)} />)}
        </span>
      ))}
    </>
  )
}

function MoneyMini({ u }: { u: UserView }) {
  return (
    <>
      <span className="m-sub">Demo account, practice money</span>
      <span className="m-title">My money</span>
      <span className="m-card">
        <span className="m-big">{fmtUsd(u.valueUsd)}</span>
        <span className="m-sub">Moves to dollars below {fmtUsd(u.floorUsd)}</span>
        <span><span className={`m-chip ${u.status === 'active' ? '' : u.status === 'paused' ? 'warn' : 'bad'}`}>{u.status === 'active' ? 'Active' : u.status === 'paused' ? 'Paused' : 'Moved to dollars'}</span></span>
      </span>
      <span className="m-card">
        <b>In the basket</b>
        {u.holdings.map((h) => (
          <span key={h.symbol} style={{ display: 'grid', gap: 3 }}>
            <span className="m-row"><span>{assetName(h.symbol)}</span><span>{fmtPct(h.weight, 0)}</span></span>
            <MiniBar w={h.weight} c={colorOf(h.symbol)} />
          </span>
        ))}
      </span>
    </>
  )
}

function NotesMini({ log }: { log: LogEntry[] }) {
  return (
    <>
      <span className="m-title">Agent notes</span>
      {log.slice(0, 4).map((e) => (
        <span className="m-card" key={e.id}><span>{e.text}</span><span className="m-sub">Signed by Nest · {new Date(e.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></span>
      ))}
    </>
  )
}

function FloorMini({ pct = 15 }: { pct?: number }) {
  return (
    <>
      <span className="m-sub">Example</span>
      <span className="m-title">Your safety floor</span>
      <span className="m-card">
        <span className="m-big">{pct}%</span>
        <MiniBar w={(pct / 50) * 100} c="#3A61B6" />
        <span>{floorExample(pct)}</span>
      </span>
      <span className="m-card"><b>Cash-out date</b><span className="m-sub">Optional. Move to dollars on a set day.</span></span>
      <span className="m-card"><b>That's it</b><span className="m-sub">No charts, no coin picking. Nest does the rest.</span></span>
    </>
  )
}

function TrustMini() {
  return (
    <>
      <span className="m-title">Nest's key</span>
      <span className="m-card">
        <span className="m-row"><span>Can buy and sell</span><span className="m-chip">Yes</span></span>
        <span className="m-row"><span>Can withdraw</span><span className="m-chip bad">No</span></span>
        <span className="m-row"><span>Can transfer</span><span className="m-chip bad">No</span></span>
      </span>
      <span className="m-sub">Your wallet signs this once. SoDEX enforces it, and anyone can check it on SoDEX's own key list.</span>
    </>
  )
}

const STEPS = [
  { tab: 'Pick', text: 'Pick one of four ready-made baskets, from careful to bold. Each one says in plain words what it holds and how bumpy it can get.' },
  { tab: 'Protect', text: 'Set one safety floor: if your savings drop that much from their best, Nest moves everything to dollars and stops. Add a cash-out date if you need the money on a set day.' },
  { tab: 'Link', text: 'Start with $1,000 of practice money, or link your SoDEX testnet account with one signature. Nest gets a key that can trade but never withdraw.' },
  { tab: 'Relax', text: 'Nest keeps the basket on target and writes a short, signed note each time it acts, with the SoSoValue data behind it.' },
]

function realRows(h: HealthView | undefined, down: boolean): [string, string, 'on' | 'off' | ''][] {
  const u = down ? 'Agent offline' : 'Checking'
  return [
    ['Network', 'SoDEX testnet only', 'on'],
    ['Practice account, priced from live SoDEX testnet books', h ? 'Live prices' : u, h ? 'on' : ''],
    ['Trading in your own SoDEX testnet account', h ? (h.exchange === 'live' ? 'On' : 'Off on this server') : u, h ? (h.exchange === 'live' ? 'on' : '') : ''],
    ['SoSoValue market data', h ? (h.sosoData === 'live' ? 'Live' : 'Sample fixtures') : u, h ? (h.sosoData === 'live' ? 'on' : '') : ''],
    ['Agent in a secure enclave (TEE)', h ? (h.enclave ? 'Yes' : 'Not yet') : u, h ? (h.enclave ? 'on' : 'off') : ''],
    ['Mainnet, real money', 'Not supported', 'off'],
  ]
}

export function Landing() {
  const health = useHealth()
  const live = useBaskets()
  const demoAddr = health.data?.demoAddress
  const demo = useUser(demoAddr)
  const log = useLog(undefined, 4)
  const replay = useReplay('balanced', 15, 40)
  const baskets = live.data?.map((v) => ({ ...v.basket, target: v.target })) ?? BASKETS.map((b) => ({ ...b, target: undefined }))

  const nav = useRef<HTMLElement>(null), frame = useRef<HTMLElement>(null), rail = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  const [tab, setTab] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    let ticking = false
    const on = () => {
      ticking = false
      nav.current?.classList.toggle('solid', scrollY > 24)
      if (!calm) frame.current?.style.setProperty('--p', Math.min(1, scrollY / (innerHeight * 0.5)).toFixed(3))
    }
    const sc = () => { if (!ticking) { ticking = true; requestAnimationFrame(on) } }
    addEventListener('scroll', sc, { passive: true })
    on()
    // Deep link to a landing anchor (#faq): the section exists only after render, so scroll to it once.
    const id = location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView()
    return () => removeEventListener('scroll', sc)
  }, [])

  const pick = (i: number, focus = false) => { setTab(i); if (focus) tabs.current[i]?.focus() }
  const hasFrame = !!live.data || !!demo.data || !!log.data?.length
  const fixtures = health.data?.sosoData === 'fixtures'

  return (
    <div className="lp">
      <a className="skip" href="#main">Skip to content</a>
      <header className={`nav ${menu ? 'open' : ''}`} ref={nav}>
        <div className="nav-in">
          <a className="logo" href="#top" aria-label="Nest, back to top"><Logo />Nest</a>
          <nav className="links" id="menu" aria-label="Main" onClick={() => setMenu(false)}>
            <a href="#features">Features</a>
            <a href="#baskets">Baskets</a>
            <a href="#how">How it works</a>
            <a href="#live">What is real</a>
            <a href="#faq">FAQ</a>
          </nav>
          <a className="btn btn-light" href="#discover">Open the app</a>
          <button className="menu-btn" type="button" aria-expanded={menu} aria-controls="menu" aria-label="Menu" onClick={() => setMenu(!menu)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="sky" aria-hidden="true" />
          <div className="wrap hero-copy">
            <h1><span>Savings that look</span> <span>after themselves.</span></h1>
            <p className="lede">Pick a ready-made basket, set one safety floor, and Nest keeps it on target on SoDEX. It can buy and sell for you, and it can never withdraw.</p>
            <a className="try" href="#start"><span>Practice money. No sign-up.</span><b>Try it free</b></a>
          </div>
          {hasFrame && (
            <div className="wrap">
              <figure className="frame" ref={frame}>
                <div className="glass">
                  <div className="frame-in">
                    {live.data && <Phone><BasketsMini baskets={live.data.map((v) => v.basket)} /></Phone>}
                    {demo.data && <Phone cls="mid"><MoneyMini u={demo.data} /></Phone>}
                    {!!log.data?.length && <Phone cls={demo.data ? '' : 'mid'}><NotesMini log={log.data} /></Phone>}
                  </div>
                </div>
                <figcaption>Live from the Nest agent on SoDEX testnet: the demo account runs on practice money{fixtures ? ', with sample market data' : ''}.</figcaption>
              </figure>
            </div>
          )}
        </section>

        <section className="wrap split" aria-labelledby="what-title">
          <div>
            <h2 id="what-title">Put your savings to work, without becoming a trader.</h2>
            <p>Most people who want their savings to grow have no idea where to start. Nest gives you four ready-made baskets and one setting that matters: how far you're willing to fall before everything goes back to dollars. The money stays in your own SoDEX account the whole time.</p>
            <a className="text-link" href="#how">See how it works</a>
          </div>
          <div className="split-art"><Phone><FloorMini /></Phone></div>
        </section>

        <section className="strip" aria-label="Built on">
          <p className="strip-label">Built on</p>
          <div className="marquee">
            <div className="track">
              {[false, true].map((dup) => ['SoDEX', 'SoSoValue', 'ValueChain', 'USDC', 'EIP-712'].map((n) => (
                <span key={n + dup} aria-hidden={dup || undefined}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /></svg>{n}
                </span>
              )))}
            </div>
          </div>
        </section>

        <section className="sec" id="features" aria-labelledby="features-title">
          <div className="wrap">
            <div className="sec-head">
              <span className="tag">Features</span>
              <h2 id="features-title">Everything a careful saver needs, nothing a trader does.</h2>
              <p>No charts to read, no coins to pick, no stranger holding your money.</p>
            </div>
            <div className="feat-grid">
              {[
                ['Four ready-made baskets', 'From Steady (mostly dollars) to Crypto Core. Each says in one sentence what it holds.', <path key="a" d="M4 9h16l-2 10H6L4 9zM8 9l3-5M16 9l-3-5" />],
                ['One safety floor', "Choose 5% to 50%. If your savings fall that far from their best, Nest moves everything to dollars.", <path key="b" d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" />],
                ['Optional cash-out date', 'Need the money for something? Pick a day and Nest moves you to dollars then.', <><rect key="c1" x="4" y="5" width="16" height="15" rx="2" /><path key="c2" d="M4 10h16M9 3v4M15 3v4" /></>],
                ['Kept on target', 'When prices drift, Nest trades your basket back to its mix, at least once a week.', <path key="d" d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4" />],
                ['Explained in plain words', 'Every change comes with one sentence and the SoSoValue data behind it, like big-fund flows into Bitcoin ETFs.', <path key="e" d="M4 5h16v11H9l-5 4V5z" />],
                ['A key that cannot withdraw', 'Nest trades with a SoDEX key that has withdrawals and transfers switched off. You can check it yourself.', <><circle key="f1" cx="8" cy="12" r="4" /><path key="f2" d="M12 12h9M18 12v3M21 12v2" /></>],
              ].map(([t, p, icon]) => (
                <article className="feat" key={t as string}>
                  <span className="ic"><svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg></span>
                  <h3>{t}</h3>
                  <p>{p}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sec" id="why" aria-labelledby="why-title">
          <div className="wrap">
            <div className="sec-head">
              <span className="tag">Why Nest</span>
              <h2 id="why-title">Simple on top. <span className="nw">Checkable</span> underneath.</h2>
              <p>Trust without trusting us: your money stays in your account, and every move the agent makes is signed and public.</p>
            </div>
            <div className="rows">
              <div className="row">
                <div>
                  <h3>Your money stays in your account.</h3>
                  <p>Nest never holds your funds. Your wallet signs one permission on SoDEX that lets Nest's key buy and sell in your account, with withdraw and transfer turned off. SoDEX enforces that on its side, and the app links to SoDEX's own key list so you can check it.</p>
                </div>
                <figure className="pic pic-navy">
                  <div className="board">
                    <div className="b-row"><span>Buy and sell</span><em className="on">Allowed</em></div>
                    <div className="b-row"><span>Withdraw</span><em className="off">Blocked</em></div>
                    <div className="b-row"><span>Transfer</span><em className="off">Blocked</em></div>
                  </div>
                  <figcaption>What Nest's key can do</figcaption>
                </figure>
              </div>
              <div className="row flip">
                <figure className="pic pic-sky pic-status">
                  <div className="board">
                    {(log.data?.length ? log.data.slice(0, 3).map((e) => e.text) : ['Back on target: sold a little Bitcoin, bought dollars.', 'No change needed today.', 'Started with the Balanced basket.']).map((t, i) => (
                      <div className="b-row" key={i}><span>{t}</span><em className="on">Signed</em></div>
                    ))}
                  </div>
                  <figcaption>{log.data?.length ? 'Latest notes, live' : 'Example notes'}</figcaption>
                </figure>
                <div>
                  <h3>Every decision, signed and public.</h3>
                  <p>Each time Nest checks or trades, it writes one plain sentence, cites its sources and signs the note with its journal key. Your browser checks every signature itself, so the track record can't be quietly edited.</p>
                </div>
              </div>
              <div className="row" id="live">
                <div>
                  <h3>What is real today.</h3>
                  <p>Nest is a buildathon project on SoDEX testnet. There is no real money anywhere. The practice account uses pretend dollars, priced from the live SoDEX testnet order books. This list is read from the agent right now, not written by hand.</p>
                </div>
                <figure className="pic pic-sky pic-status">
                  <div className="board">
                    {realRows(health.data, health.isError).map(([k, v, c]) => <div className="b-row" key={k}><span>{k}</span><em className={c}>{v}</em></div>)}
                  </div>
                  <figcaption>{health.data ? 'Live from the agent' : health.isError ? 'Agent not answering' : 'Checking the agent'}</figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="baskets" aria-labelledby="baskets-title">
          <div className="wrap">
            <div className="sec-head">
              <span className="tag">Baskets</span>
              <h2 id="baskets-title">Four baskets. Pick the one that lets you sleep.</h2>
              <p>Each basket has a usual mix. Nest leans a few points toward or away from an asset when SoSoValue data says so, and tells you why.</p>
            </div>
          </div>
          <div className="rail" ref={rail} tabIndex={0} aria-label="The four baskets, scrolls sideways">
            {baskets.map((b, i) => (
              <article className={`bk ${['bk-sky', 'bk-mist', 'bk-navy', 'bk-mist'][i % 4]}`} key={b.id}>
                <div className="bk-stones"><Stones weights={b.weights} /></div>
                <h3>{b.name}</h3>
                <p className="bk-desc">{b.blurb}</p>
                <ul className="mix" aria-label={`${b.name} mix${b.target ? ' today' : ''}`}>
                  {Object.keys(b.weights).map((s) => {
                    const w = b.target?.[s] ?? b.weights[s]
                    return <li key={s}><span>{assetName(s)}</span><i style={{ ['--w' as string]: w, ['--c' as string]: colorOf(s) }} /><b>{Math.round(w)}%</b></li>
                  })}
                </ul>
                <p className="bk-meta">{b.risk} risk. Kept on target weekly. <a href={`#start-${b.id}`}>Start with {b.name}<span className="sr-only"> basket</span></a></p>
              </article>
            ))}
          </div>
          <div className="wrap rail-foot">
            <p className="note">{live.data ? "Today's mix, live from the agent." : 'Usual mix shown while the agent is not answering.'} Assets are SoDEX testnet tokens: vBTC, vNVDA, the vDEFIssi crypto-apps index and vUSDC dollars.</p>
            <div className="rail-btns">
              {[-1, 1].map((d) => (
                <button key={d} type="button" aria-label={d < 0 ? 'Previous baskets' : 'Next baskets'} onClick={() => rail.current?.scrollBy({ left: d * 372, behavior: 'smooth' })}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} /></svg>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="band" aria-labelledby="demo-title">
          <div className="wrap band-in">
            <div>
              <h2 id="demo-title">Watch a crash, safely.</h2>
              <p>Replay a market crash on any basket and see what your safety floor would have done, through the same decision code the agent runs for real. No wallet needed.</p>
              <div className="btn-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <a className="btn btn-light" href="#crash">Open the crash replay</a>
                {demoAddr && <a className="btn btn-ink" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.4)' }} href={`#home-${demoAddr}`}>See a live demo account</a>}
              </div>
            </div>
            {replay.data && (
              <Phone cls="live">
                <span className="m-title">Crash replay</span>
                <span className="m-sub">Balanced basket, 40% crash, 15% floor</span>
                <span className="m-card"><ReplayChart r={replay.data} compact /></span>
                <span className="m-card"><b>{replay.data.savedUsd >= 0 ? `The floor saved ${fmtUsd(replay.data.savedUsd)}` : `The floor cost ${fmtUsd(-replay.data.savedUsd)} this time`}</b><span className="m-sub">Blue: with the floor. Red: without.</span></span>
              </Phone>
            )}
          </div>
        </section>

        <section className="sec" id="how" aria-labelledby="how-title">
          <div className="wrap">
            <div className="sec-head">
              <span className="tag">How it works</span>
              <h2 id="how-title">Four steps, about a minute.</h2>
              <p>You sign twice at most, and signing costs nothing. There are no transactions to pay for.</p>
            </div>
            <div className="tabs" role="tablist" aria-label="Steps">
              {STEPS.map((s, i) => (
                <button key={s.tab} ref={(el) => { tabs.current[i] = el }} type="button" role="tab" id={`tab-${i}`} aria-controls={`panel-${i}`} aria-selected={tab === i} tabIndex={tab === i ? 0 : -1}
                  onClick={() => pick(i)}
                  onKeyDown={(e) => {
                    const d = ({ ArrowRight: 1, ArrowLeft: -1, Home: -i, End: STEPS.length - 1 - i } as Record<string, number>)[e.key]
                    if (d !== undefined) { e.preventDefault(); pick((i + d + STEPS.length) % STEPS.length, true) }
                  }}>{s.tab}</button>
              ))}
            </div>
            {STEPS.map((s, i) => (
              <div className="panel" role="tabpanel" id={`panel-${i}`} aria-labelledby={`tab-${i}`} hidden={tab !== i} key={s.tab}>
                <div className="stage">
                  {i === 0 && <Phone><BasketsMini baskets={baskets} /></Phone>}
                  {i === 1 && <Phone><FloorMini /></Phone>}
                  {i === 2 && <Phone><TrustMini /></Phone>}
                  {i === 3 && <Phone>{log.data?.length ? <NotesMini log={log.data} /> : <><span className="m-title">Agent notes</span><span className="m-card">Notes appear here once the agent is running.</span></>}</Phone>}
                </div>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="sec" id="faq" aria-labelledby="faq-title" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="sec-head"><span className="tag">FAQ</span><h2 id="faq-title">Questions people ask first.</h2></div>
            <div className="faq">
              <details><summary>Is this real money?</summary><p>No. Nest runs on SoDEX testnet only. The practice account is $1,000 of pretend dollars. If you link your own SoDEX testnet account, it trades test tokens with no cash value. Mainnet is not supported.</p></details>
              <details><summary>Can Nest take my money?</summary><p>No. Nest's key is a SoDEX permissioned API key with withdraw and transfer switched off, so it can only buy and sell inside your own account. My money links to SoDEX's public key list so you can check it.</p></details>
              <details><summary>What does the safety floor do exactly?</summary><p>Nest remembers the highest value your savings reached. If they fall your chosen percentage below that, it sells everything into dollars (vUSDC) and stops trading until you resume in Settings. {floorExample(15)}</p></details>
              <details><summary>Where do the "why" sentences come from?</summary><p>From SoSoValue data: daily net flows into US Bitcoin and Ether spot ETFs, the crypto fear and greed index, and top news. Each lean is at most 5 points and every note links its source. {fixtures ? 'Right now the agent uses recorded sample data.' : ''}</p></details>
              <details><summary>What do I need to use my own SoDEX testnet account?</summary><p>A wallet that SoDEX has let into its testnet, with test tokens claimed and moved to your Spot account. <a href={SODEX_ONBOARDING} target="_blank" rel="noreferrer">SoDEX's testnet steps</a>. Without that, use practice money: no setup at all.</p></details>
              <details><summary>Does the agent run in a secure enclave?</summary><p>{health.data ? (health.data.enclave ? 'Yes. The agent reports that it runs in a TEE and derives its keys there.' : 'Not at the moment. Its keys come from a server secret. The app shows this status live and will never claim an enclave that is not there.') :'The app reads this from the agent and shows it in the sidebar. It will never claim an enclave that is not there.'}</p></details>
            </div>
          </div>
        </section>

        <section className="wrap cta" aria-labelledby="cta-title">
          <div className="cta-card">
            <div className="cta-top">
              <h2 id="cta-title">Start with practice money. Decide later.</h2>
              <div>
                <p>$1,000 of pretend dollars, priced from the live SoDEX testnet. No sign-up, just a wallet signature.</p>
                <a className="btn btn-light" href="#start">Try it free</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">
          <div className="foot-in">
            <div className="foot-brand">
              <a className="logo" href="#top"><Logo />Nest</a>
              <p>Ready-made savings baskets with one safety floor, on SoDEX testnet.</p>
              <a className="btn btn-ink" href="#discover">Open the app</a>
            </div>
            <nav className="foot-col" aria-label="On this page">
              <h3>On this page</h3>
              <a href="#features">Features</a><a href="#why">Why Nest</a><a href="#baskets">Baskets</a><a href="#how">How it works</a><a href="#faq">FAQ</a>
            </nav>
            <nav className="foot-col" aria-label="App">
              <h3>App</h3>
              <a href="#discover">Baskets</a><a href="#crash">Crash replay</a><a href="#activity">Public record</a>{demoAddr && <a href={`#home-${demoAddr}`}>Demo account</a>}
            </nav>
          </div>
          <div className="legal">
            <p>© 2026 Nest. Built for the SoSoValue Buildathon.</p>
            <p>Nest is in development and runs on SoDEX testnet with test tokens that have no value. Nothing on this site is an offer to sell or a solicitation to buy any asset, or financial advice. Market data comes from SoSoValue, or from recorded sample data when the agent says so.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
