import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useConnect, useSignMessage } from 'wagmi'
import { api, useBaskets, useUser, type UserRules, type UserView } from '../api'
import { explain, fmtUsd } from '../format'
import { settingsBody, settingsMessage, type SettingsChange } from '../settings'
import { useToast } from '../toast'
import { ErrorNotice, Notice, RiskChip, Skeleton, useViewAs } from '../ui'
import { FloorSlider, dateToIso } from './Start'

export function Settings() {
  const viewAs = useViewAs()
  const { address } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const user = useUser(address)
  return (
    <>
      <div className="page-head">
        <h1>Change your plan</h1>
        <p>Every change is a free signature from your wallet, so only you can make it.</p>
      </div>
      {viewAs ? <Notice>You are viewing someone else's savings, read only. <a href="#home">Stop viewing</a> to change your own.</Notice>
        : !address ? (
          <section className="acard"><div className="empty-state">
            <p>Connect the wallet you started with to change its plan.</p>
            <button className="abtn" type="button" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>{isPending ? 'Check your wallet' : 'Connect wallet'}</button>
          </div></section>
        ) : user.isLoading ? <section className="acard"><Skeleton label="Loading your plan" /></section>
        : user.error ? <ErrorNotice error={user.error} what="your plan" />
        : !user.data ? <Notice>This wallet has no Nest basket yet. <a href="#discover">Pick a basket</a>.</Notice>
        : <Form u={user.data} key={`${user.data.basketId}-${user.data.floorPct}-${user.data.cashOutAt}-${user.data.status}`} />}
    </>
  )
}

function Form({ u }: { u: UserView }) {
  const baskets = useBaskets()
  const { signMessageAsync } = useSignMessage()
  const qc = useQueryClient()
  const toast = useToast()
  const [basketId, setBasketId] = useState(u.basketId)
  const [floorPct, setFloor] = useState(u.floorPct)
  const [cashOut, setCashOut] = useState(u.cashOutAt?.slice(0, 10) ?? '')
  const [busy, setBusy] = useState<string>()
  const [err, setErr] = useState<string>()

  const rules: Partial<UserRules> = {}
  if (basketId !== u.basketId) rules.basketId = basketId
  if (floorPct !== u.floorPct) rules.floorPct = floorPct
  if (cashOut !== (u.cashOutAt?.slice(0, 10) ?? '')) rules.cashOutAt = cashOut ? dateToIso(cashOut) : '' // '' clears the date
  const changed = Object.keys(rules).length > 0

  async function send(change: SettingsChange, label: string) {
    setErr(undefined); setBusy(label)
    try {
      const message = settingsMessage(u.address, Date.now(), change)
      const signature = await signMessageAsync({ message })
      const view = await api.settings(u.address, settingsBody(change, message, signature))
      qc.setQueryData(['user', u.address.toLowerCase()], view)
      qc.invalidateQueries({ queryKey: ['log'] })
      toast({ kind: 'success', title: 'Saved', body: label === 'pause' ? 'Nest is paused.' : label === 'resume' ? 'Nest is looking after your basket again.' : 'Your new plan is in place.' })
    } catch (e) {
      setErr(explain(e))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (changed) send({ rules }, 'save') }}>
      <section className="acard">
        <div className="acard-head"><h2>Pause or resume</h2></div>
        {u.status === 'active' ? (
          <div className="empty-state">
            <p>Nest is looking after your basket. Pausing stops all trading, including the safety floor, until you resume.</p>
            <button className="btn" type="button" disabled={!!busy} onClick={() => send({ rules: {}, status: 'paused' }, 'pause')}>{busy === 'pause' ? 'Check your wallet' : 'Pause Nest'}</button>
          </div>
        ) : (
          <div className="empty-state">
            <p>{u.status === 'paused' ? 'Nest is paused and will not trade.' : 'Nest moved everything to dollars and stopped.'} Resuming starts the safety floor again from today's value ({fmtUsd(u.valueUsd)}).</p>
            <button className="abtn" type="button" disabled={!!busy} onClick={() => send({ rules, status: 'active' }, 'resume')}>{busy === 'resume' ? 'Check your wallet' : changed ? 'Save changes and resume' : 'Resume'}</button>
          </div>
        )}
      </section>

      <section className="acard">
        <fieldset>
          <legend>Basket</legend>
          {baskets.isLoading && <Skeleton label="Loading baskets" />}
          {baskets.error && <ErrorNotice error={baskets.error} what="the baskets" />}
          <div className="choices">
            {baskets.data?.map(({ basket }) => (
              <label className="choice" key={basket.id}>
                <input type="radio" name="basket" value={basket.id} checked={basketId === basket.id} onChange={() => setBasketId(basket.id)} />
                <b>{basket.name}{basket.id === u.basketId && <span className="muted" style={{ fontWeight: 500 }}> (current)</span>}</b>
                <span>{basket.blurb}</span>
                <span className="chips"><RiskChip risk={basket.risk} /></span>
              </label>
            ))}
          </div>
          {basketId !== u.basketId && <p className="hint" style={{ marginTop: 10 }}>Nest will trade your current holdings into the new basket on its next check.</p>}
        </fieldset>
      </section>

      <section className="acard">
        <fieldset>
          <legend>Safety floor</legend>
          <FloorSlider value={floorPct} onChange={setFloor} />
        </fieldset>
      </section>

      <section className="acard">
        <fieldset>
          <legend>Cash-out date</legend>
          <div className="field">
            <label htmlFor="cashout">On this date, move everything to dollars (leave empty for none)</label>
            <input id="cashout" type="date" min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} value={cashOut} onChange={(e) => setCashOut(e.target.value)} />
            {cashOut && <button className="link" type="button" style={{ background: 'none', border: 0, padding: 0, justifySelf: 'start', cursor: 'pointer' }} onClick={() => setCashOut('')}>Remove the date</button>}
          </div>
        </fieldset>
      </section>

      <div className="stack" style={{ gap: 10 }}>
        <button className="abtn wide" type="submit" disabled={!changed || !!busy}>{busy === 'save' ? 'Check your wallet' : changed ? 'Sign and save changes' : 'No changes yet'}</button>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </form>
  )
}
