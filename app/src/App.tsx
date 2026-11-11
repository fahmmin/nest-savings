import { useEffect, useRef, useState } from 'react'
import { getAddress, isAddress } from 'viem'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { useHealth, type Address } from './api'
import { EXPLORER } from './config'
import { explain, short } from './format'
import { icons } from './icons'
import { ToastProvider } from './toast'
import { Logo, ViewAsContext } from './ui'
import { Landing } from './screens/Landing'
import { Discover } from './screens/Discover'
import { Start } from './screens/Start'
import { Home } from './screens/Home'
import { Activity } from './screens/Activity'
import { Settings } from './screens/Settings'
import { Crash } from './screens/Crash'

const viewTarget = (h: string) => {
  const m = /^#home-(.+)$/.exec(h)
  return m && isAddress(m[1], { strict: false }) ? getAddress(m[1]) : undefined
}

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

/** In-page anchors of the landing page; they must not switch to an app screen. */
export const LANDING = ['', '#', '#top', '#main', '#features', '#why', '#baskets', '#how', '#live', '#faq']

const TITLES = { discover: 'Baskets', start: 'Get started', home: 'My money', activity: 'Activity', settings: 'Settings', crash: 'Crash replay' } as const
type Screen = keyof typeof TITLES

const avatar = (a: string) => ({ background: `hsl(${parseInt(a.slice(2, 6), 16) % 360} 55% 62%)` })

function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [])
  if (isConnected && address)
    return (
      <div className="wallet" ref={box}>
        <button className="acct-btn" type="button" title={address} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
          <i className="avatar" style={avatar(address)} aria-hidden="true" />
          <span><span className="sr-only">Wallet </span>{short(address)}</span>
        </button>
        {open && (
          <div className="acct-menu">
            <button type="button" onClick={() => navigator.clipboard?.writeText(address).catch(() => {})}>{icons.copy}Copy address</button>
            <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">{icons.external}View on explorer</a>
            <button type="button" onClick={() => { setOpen(false); disconnect() }}>{icons.logout}Disconnect</button>
          </div>
        )}
      </div>
    )
  return (
    <div className="wallet">
      <button className="abtn small" type="button" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>
        {isPending ? 'Check your wallet' : 'Connect wallet'}
      </button>
      {error && <span className="reason" role="alert">{explain(error)}</span>}
    </div>
  )
}

/** Sidebar network card: which network, whether the agent answers, where market data comes from, and the enclave. */
function NetCard() {
  const h = useHealth()
  const d = h.data
  return (
    <div className="net-card" aria-label="Network status">
      <div className="net-row"><strong>SoDEX testnet</strong><i className={`dot ${d ? 'ok' : h.isError ? 'bad' : ''}`} aria-hidden="true" /></div>
      <span className="net-line"><span>Agent</span><b>{d ? 'Online' : h.isError ? 'Not answering' : 'Checking'}</b></span>
      <span className="net-line"><span>Market data</span><b>{d ? (d.sosoData === 'live' ? 'Live SoSoValue' : 'Sample fixtures') : h.isError ? 'Unknown' : '…'}</b></span>
      <span className="net-line"><span>Trades</span><b>{d ? (d.exchange === 'live' ? 'Testnet orders' : 'Practice') : h.isError ? 'Unknown' : '…'}</b></span>
      <span className="net-line"><span>Secure enclave</span><b>{d ? (d.enclave ? 'Yes' : 'No') : h.isError ? 'Unknown' : '…'}</b></span>
    </div>
  )
}

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>
}

function Shell() {
  const hash = useHash()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)
  const landing = LANDING.includes(hash)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (landing) return // the browser scrolls to the landing anchor
    main.current?.focus() // move focus to the new screen for keyboard and screen reader users
    window.scrollTo(0, 0)
  }, [hash]) // eslint-disable-line react-hooks/exhaustive-deps

  const health = useHealth()
  // #home-<address> starts a read-only view of that address; it lasts across screens until #home ("Stop viewing").
  const [viewAs, setViewAs] = useState<Address | undefined>(() => viewTarget(window.location.hash))
  const target = viewTarget(hash)
  if (target && target !== viewAs) setViewAs(target)
  if (hash === '#home' && viewAs) setViewAs(undefined)
  const homeMatch = /^#home-(.+)$/.exec(hash)
  const startMatch = /^#start(?:-(\w+))?$/.exec(hash)
  const screen: Screen = hash === '#crash' ? 'crash' : startMatch ? 'start' : hash === '#activity' ? 'activity' : hash === '#settings' ? 'settings'
    : hash === '#home' || homeMatch ? 'home' : 'discover'
  useEffect(() => { document.title = landing ? 'Nest: savings that look after themselves' : `${TITLES[screen]} · Nest` }, [landing, screen])

  if (landing) return <Landing />

  const nav = [
    { href: '#discover', name: 'Baskets', short: 'Baskets', icon: icons.baskets, on: screen === 'discover' || screen === 'start' },
    { href: viewAs ? `#home-${viewAs}` : '#home', name: 'My money', short: 'My money', icon: icons.money, on: screen === 'home' },
    { href: '#activity', name: 'Activity', short: 'Activity', icon: icons.activity, on: screen === 'activity' },
    { href: '#settings', name: 'Settings', short: 'Settings', icon: icons.settings, on: screen === 'settings' },
    { href: '#crash', name: 'Crash replay', short: 'Crash', icon: icons.crash, on: screen === 'crash' },
  ]
  const sample = (health.data as { sample?: boolean } | undefined)?.sample // set only by scripts/mock-agent.ts

  return (
    <div className="shell">
      <aside className="side">
        <a className="logo" href="#top"><Logo /><span>Nest</span></a>
        <span className="side-tag">Savings that look after themselves</span>
        <nav aria-label="App">
          {nav.map((n) => <a key={n.name} href={n.href} className={n.on ? 'active' : ''} aria-current={n.on ? 'page' : undefined}>{n.icon}<span>{n.name}</span></a>)}
        </nav>
        <div className="side-foot">
          <NetCard />
          <a href="#top" className="side-link">About Nest</a>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <a className="logo" href="#top" aria-label="Nest, about"><Logo /><span>Nest</span></a>
            <div>
              <span className="crumb">Nest · SoDEX testnet</span>
              <h1>{TITLES[screen]}</h1>
            </div>
          </div>
          <div className="topbar-right"><WalletButton /></div>
        </header>
        {sample && <div className="banner sample" role="note">Sample data from the dev mock agent. Nothing on this page is real.</div>}
        {viewAs && <div className="banner info" role="note"><span>Viewing {short(viewAs)}, read only.</span><a href="#home">Stop viewing</a></div>}

        <ViewAsContext.Provider value={viewAs}>
          <main className="page" ref={main} tabIndex={-1} key={screen} id="main-app">
            {screen === 'discover' && <Discover />}
            {screen === 'start' && <Start key={hash} initial={startMatch?.[1]} />}
            {screen === 'home' && (homeMatch && !target
              ? <div className="notice bad" role="alert">That link does not contain a valid address. <a href="#home">Back to My money</a></div>
              : <Home />)}
            {screen === 'activity' && <Activity />}
            {screen === 'settings' && <Settings />}
            {screen === 'crash' && <Crash />}
            <p className="hint">SoDEX testnet only, no real money. The agent can trade for you but can never withdraw or transfer.</p>
          </main>
        </ViewAsContext.Provider>
      </div>

      <nav className="tabbar" aria-label="App, bottom" style={{ ['--tabs' as string]: nav.length }}>
        {nav.map((n) => <a key={n.name} href={n.href} className={n.on ? 'active' : ''} aria-current={n.on ? 'page' : undefined}>{n.icon}<span>{n.short}</span></a>)}
      </nav>
    </div>
  )
}
