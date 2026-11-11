import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useConnect, useSignMessage, useSignTypedData, useSwitchChain } from 'wagmi'
import { AgentError, api, reviveTypedData, useBaskets, useHealth, useUser, type Basket, type Mode, type UserRules } from '../api'
import { SODEX_APP, SODEX_ONBOARDING, valuechainTestnet } from '../config'
import { explain, floorExample, fmtPct } from '../format'
import { useToast } from '../toast'
import { ErrorNotice, ExtLink, Notice, RiskChip, Skeleton } from '../ui'

/** A date input value (local midnight) as an ISO string. */
export const dateToIso = (d: string) => new Date(`${d}T00:00:00`).toISOString()
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

export function FloorSlider({ value, onChange, id = 'floor' }: { value: number; onChange: (n: number) => void; id?: string }) {
  return (
    <div className="field" style={{ gap: 10 }}>
      <label htmlFor={id}>Move everything to dollars if my savings drop by</label>
      <span className="big-num" aria-hidden="true">{fmtPct(value, 0)}</span>
      <input id={id} type="range" min={5} max={50} step={1} value={value} aria-valuetext={`${value} percent`} aria-describedby={`${id}-ex`}
        onChange={(e) => onChange(Number(e.target.value))} />
      <p id={`${id}-ex`} aria-live="polite"><b>{floorExample(value)}</b></p>
      <p className="hint">Counted from your highest value so far, so the floor rises as your savings grow. After it triggers, Nest stops trading until you say go again.</p>
    </div>
  )
}

export function Start({ initial }: { initial?: string }) {
  const baskets = useBaskets()
  const liveOn = useHealth().data?.exchange === 'live'
  const { address, chainId, isConnected } = useAccount()
  const existing = useUser(address)
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect()
  const { signMessageAsync } = useSignMessage()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()
  const qc = useQueryClient()
  const toast = useToast()

  const [basketId, setBasketId] = useState<Basket['id'] | undefined>(initial as Basket['id'] | undefined)
  const [floorPct, setFloor] = useState(15)
  const [cashOut, setCashOut] = useState('')
  const [mode, setMode] = useState<Mode>('paper')
  const [busy, setBusy] = useState<'request' | 'sign' | 'link'>()
  const [err, setErr] = useState<string>()

  const valid = !!baskets.data?.some((b) => b.basket.id === basketId) && (mode === 'paper' || liveOn)

  async function go() {
    if (!address || !basketId) return
    setErr(undefined)
    const t = toast({ kind: 'pending', title: 'Asking Nest for your key', body: 'One moment.' })
    try {
      setBusy('request')
      const rules: UserRules = { basketId, floorPct, ...(cashOut ? { cashOutAt: dateToIso(cashOut) } : {}) }
      const req = await api.linkRequest(address, { ...rules, mode })
      setBusy('sign')
      toast({ kind: 'pending', title: 'Check your wallet', body: req.message !== undefined ? 'Sign a short message. It costs nothing.' : 'Sign the trade-only permission. It costs nothing.' }, t)
      let signature: string
      if (req.message !== undefined) signature = await signMessageAsync({ message: req.message })
      else if (!req.typedData) throw new Error('The agent sent nothing to sign.')
      else {
        // Wallets refuse typed data whose domain chain differs from the active chain; switchChain also adds the chain if missing.
        if (chainId !== valuechainTestnet.id) await switchChainAsync({ chainId: valuechainTestnet.id })
        signature = await signTypedDataAsync(reviveTypedData(req.typedData) as Parameters<typeof signTypedDataAsync>[0])
      }
      setBusy('link')
      toast({ kind: 'pending', title: 'Setting up your basket', body: mode === 'live' ? 'Registering the key with SoDEX and checking it.' : 'Adding $1,000 of practice money.' }, t)
      const view = await api.link(address, { signature, nonce: req.nonce })
      qc.setQueryData(['user', address.toLowerCase()], view)
      qc.invalidateQueries({ queryKey: ['log'] })
      toast({ kind: 'success', title: 'Your basket is set up', body: 'Nest takes it from here.' }, t)
      window.location.hash = '#home'
    } catch (e) {
      toast(null, t)
      setErr(e instanceof AgentError && e.status === 409
        ? 'Your SoDEX testnet account is not activated yet. Claim test tokens at testnet.sodex.com and move them to your Spot account, then try again.'
        : explain(e))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Set up your savings in four steps</h1>
        <p>Nothing moves until you sign at the end, and signing costs nothing.</p>
      </div>

      {existing.data && (
        <Notice tone="warn">This wallet already has a Nest basket ({existing.data.basketId}). <a href="#home">See it in My money</a> or <a href="#settings">change it in Settings</a>.</Notice>
      )}

      <form className="stack" onSubmit={(e) => { e.preventDefault(); go() }}>
        <section className="acard">
          <fieldset>
            <legend><span className="step-n" aria-hidden="true">1</span>Choose a basket</legend>
            {baskets.isLoading && <Skeleton label="Loading baskets" />}
            {baskets.error && <ErrorNotice error={baskets.error} what="the baskets" />}
            <div className="choices">
              {baskets.data?.map(({ basket }) => (
                <label className="choice" key={basket.id}>
                  <input type="radio" name="basket" value={basket.id} checked={basketId === basket.id} onChange={() => setBasketId(basket.id)} />
                  <b>{basket.name}</b>
                  <span>{basket.blurb}</span>
                  <span className="chips"><RiskChip risk={basket.risk} /></span>
                </label>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 10 }}>Not sure? <a href="#discover">Compare the baskets</a>.</p>
          </fieldset>
        </section>

        <section className="acard">
          <fieldset>
            <legend><span className="step-n" aria-hidden="true">2</span>Choose your safety floor</legend>
            <FloorSlider value={floorPct} onChange={setFloor} />
          </fieldset>
        </section>

        <section className="acard">
          <fieldset>
            <legend><span className="step-n" aria-hidden="true">3</span>Cash-out date <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></legend>
            <div className="field">
              <label htmlFor="cashout">On this date, move everything to dollars</label>
              <input id="cashout" type="date" min={tomorrow()} value={cashOut} onChange={(e) => setCashOut(e.target.value)} />
              <p className="hint">Handy if you need the money for something on a set day. Leave it empty to keep going.</p>
            </div>
          </fieldset>
        </section>

        <section className="acard">
          <fieldset>
            <legend><span className="step-n" aria-hidden="true">4</span>Which money?</legend>
            <div className="choices">
              <label className="choice">
                <input type="radio" name="mode" value="paper" checked={mode === 'paper'} onChange={() => setMode('paper')} />
                <b>Practice money</b>
                <span>$1,000 of pretend dollars, no setup. Prices come from the real SoDEX testnet order books.</span>
              </label>
              <label className="choice" aria-disabled={!liveOn}>
                <input type="radio" name="mode" value="live" checked={mode === 'live'} disabled={!liveOn} onChange={() => setMode('live')} />
                <b>My SoDEX testnet account</b>
                <span>{liveOn ? 'Nest trades test tokens in your own SoDEX testnet account.' : 'Live testnet trading is switched off on this server.'}</span>
              </label>
            </div>
            {mode === 'live' && liveOn && (
              <Notice>
                <p>This needs a wallet that SoDEX has let into its testnet, with test tokens claimed at <ExtLink href={SODEX_APP}>testnet.sodex.com</ExtLink> and moved to your Spot account. <ExtLink href={SODEX_ONBOARDING}>How to get set up</ExtLink>.</p>
                <p>Your wallet will add the ValueChain testnet network (chain 138565) and ask you to sign one permission for Nest's key: <b>it can buy and sell, it cannot withdraw or transfer</b>.</p>
              </Notice>
            )}
          </fieldset>
        </section>

        <section className="acard">
          <h2 style={{ marginBottom: 12 }}>Connect and sign</h2>
          {!isConnected ? (
            <div className="empty-state">
              <p>Connect a browser wallet. Nest only asks for signatures, never for a transaction or your keys.</p>
              <button className="abtn" type="button" disabled={connecting} onClick={() => connect({ connector: connectors[0] })}>{connecting ? 'Check your wallet' : 'Connect wallet'}</button>
              {connectError && <Notice tone="bad">{explain(connectError)}</Notice>}
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {!basketId && <p className="reason">Pick a basket in step 1 first.</p>}
              <button className="abtn wide" type="submit" disabled={!valid || !!busy || !!existing.data}>
                {busy === 'request' ? 'Asking Nest' : busy === 'sign' ? 'Check your wallet' : busy === 'link' ? 'Setting up' : 'Sign and start'}
              </button>
              {err && <Notice tone="bad">{err}</Notice>}
            </div>
          )}
          <details className="how" style={{ marginTop: 14 }}>
            <summary>What exactly do I sign?</summary>
            <div>
              <p>Practice money: a short text message that proves you own this address. It cannot move anything.</p>
              <p>SoDEX testnet: SoDEX's <code>addPermissionedAPIKey</code> request (EIP-712, permissions 14), which registers Nest's key for your account with withdraw, transfer and cancel turned off. You can check it any time on My money.</p>
            </div>
          </details>
        </section>
      </form>
    </>
  )
}
