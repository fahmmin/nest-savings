import { useAccount, useConnect } from 'wagmi'
import { useBaskets, useHealth, useLog, useUser, type Address, type Health, type LogEntry, type UserView } from '../api'
import { apiKeysUrl } from '../config'
import { assetName, explain, fmtDate, fmtPct, fmtSignedPct, fmtSignedUsd, fmtUsd, fmtWhen, short } from '../format'
import { Chip, ErrorNotice, ExtLink, Notice, Skeleton, Stat, Weights, useViewAs, type Tone } from '../ui'

/** The public practice account the agent runs for visitors (/health demoAddress). */
export const useDemoAddress = (): Address | undefined => useHealth().data?.demoAddress

const STATUS: Record<UserView['status'], { tone: Tone; label: string }> = {
  active: { tone: 'ok', label: 'Active' },
  exited: { tone: 'bad', label: 'Moved to dollars' },
  paused: { tone: 'warn', label: 'Paused' },
}

function statusSentence(u: UserView, lastExit?: LogEntry) {
  if (u.status === 'active') return `Nest is looking after your basket and keeps it on target. If your savings fall to ${fmtUsd(u.floorUsd)}, it moves everything to dollars.`
  if (u.status === 'paused') return 'Paused. Nest will not buy or sell anything until you resume in Settings.'
  return `${lastExit ? lastExit.text + ' ' : 'Nest moved everything to dollars. '}It will not trade again until you resume in Settings.`
}

export function Home() {
  const { address: connected } = useAccount()
  const viewAs = useViewAs()
  const address = viewAs ?? connected
  return (
    <>
      <div className="page-head">
        <h1>{viewAs ? `Savings of ${short(viewAs)}` : 'What is my money doing?'}</h1>
        <p>Your basket, your safety floor and every note the agent wrote, read from the Nest agent and SoDEX testnet.</p>
      </div>
      {address ? <MyMoney address={address} readOnly={!!viewAs} /> : <Empty />}
    </>
  )
}

function Empty() {
  const { connect, connectors, isPending, error } = useConnect()
  const demo = useDemoAddress()
  return (
    <div className="grid-2">
      <section className="acard" aria-labelledby="t-empty">
        <div className="acard-head"><h2 id="t-empty">Your savings show up here</h2></div>
        <div className="empty-state">
          <p>Connect the wallet you started with. Nest only asks for signatures, never for your keys.</p>
          <div className="btn-row">
            <button className="abtn" type="button" disabled={isPending} onClick={() => connect({ connector: connectors[0] })}>{isPending ? 'Check your wallet' : 'Connect wallet'}</button>
            <a className="btn" href="#discover">Pick a basket</a>
          </div>
          {error && <Notice tone="bad">{explain(error)}</Notice>}
        </div>
      </section>
      <section className="acard" aria-labelledby="t-demo">
        <div className="acard-head"><h2 id="t-demo">Look around first</h2></div>
        <div className="empty-state">
          <p>No wallet needed: open the public practice account and see exactly what Nest shows its owner.</p>
          {demo ? <a className="btn" href={`#home-${demo}`}>Open the demo account</a> : <p className="hint">The demo account appears once the agent is running.</p>}
        </div>
      </section>
    </div>
  )
}

function MyMoney({ address, readOnly }: { address: Address; readOnly: boolean }) {
  const user = useUser(address)
  const log = useLog(address, 200)
  const baskets = useBaskets()
  const health = useHealth()

  if (user.isLoading) return <div className="stats-row">{[0, 1, 2, 3].map((i) => <Stat key={i} label="Loading" />)}</div>
  if (user.error) return <ErrorNotice error={user.error} what="these savings" />
  const u = user.data
  if (!u)
    return (
      <section className="acard">
        <div className="empty-state">
          <h2 style={{ color: 'var(--ink)' }}>No Nest basket for {readOnly ? 'this address' : 'this wallet'} yet</h2>
          {readOnly ? <p>Nothing has been set up for {short(address)}.</p> : <><p>Pick a basket and a safety floor. It takes about a minute.</p><a className="abtn" href="#discover">Pick a basket</a></>}
        </div>
      </section>
    )

  const entries = log.data ?? []
  const start = [...entries].reverse().find((e) => e.kind === 'link')?.valueUsd
  const change = start !== undefined ? u.valueUsd - start : undefined
  const basket = baskets.data?.find((b) => b.basket.id === u.basketId)?.basket
  const st = STATUS[u.status]
  const lastExit = entries.find((e) => e.kind === 'exit')

  return (
    <>
      <div className="stats-row">
        <Stat label="Total value" value={fmtUsd(u.valueUsd)} sub={`${basket?.name ?? u.basketId} basket, ${u.mode === 'paper' ? 'practice money' : 'SoDEX testnet'}`} />
        <Stat label="Change since start" value={log.isLoading ? undefined : change === undefined ? 'n/a' : <span className={change >= 0 ? 'tone-ok' : 'tone-bad'}>{fmtSignedUsd(change)}</span>}
          sub={change !== undefined && start ? `${fmtSignedPct((change / start) * 100)} since ${fmtDate(u.linkedAt)}, from ${fmtUsd(start)}` : 'Start value not in the log yet.'} />
        <Stat label="Safety floor" value={fmtUsd(u.floorUsd)} sub={`Moves to dollars below ${fmtUsd(u.floorUsd)}: ${fmtPct(u.floorPct, 0)} under the highest value so far (${fmtUsd(u.hwmUsd)}).${u.cashOutAt ? ` Cash-out date ${fmtDate(u.cashOutAt)}.` : ''}`} />
        <div className="stat">
          <span className="stat-label">Status</span>
          <span><Chip tone={st.tone}>{st.label}</Chip></span>
          <span className="stat-sub">{statusSentence(u, lastExit)}</span>
        </div>
      </div>

      <div className="grid-2">
        <section className="acard" aria-labelledby="t-hold">
          <div className="acard-head"><h2 id="t-hold">What's in the basket</h2>{!readOnly && <a className="link" href="#settings">Change →</a>}</div>
          {u.holdings.length === 0 ? <p className="muted">Nothing held yet.</p> : (
            <>
              <Weights label="Holdings compared with target" rows={u.holdings.map((h) => ({ symbol: h.symbol, now: h.weight, mark: h.target, markLabel: 'target' }))} />
              <p className="hint" style={{ marginTop: 12 }}>Bars show what you hold now. The dark tick is the target. Nest trades back to target when anything is more than 5 points off, or once a week.</p>
              <ul className="checks" style={{ marginTop: 12 }}>
                {u.holdings.map((h) => <li key={h.symbol}><span>{assetName(h.symbol)} <span className="muted small">{h.qty.toLocaleString('en-US', { maximumFractionDigits: 6 })} {h.symbol.split('_')[0]}</span></span><span className="num">{fmtUsd(h.valueUsd)}</span></li>)}
              </ul>
            </>
          )}
        </section>

        <section className="acard" aria-labelledby="t-notes">
          <div className="acard-head"><h2 id="t-notes">Latest notes from the agent</h2><a className="link" href="#activity">See all →</a></div>
          {log.isLoading ? <Skeleton label="Loading notes" /> : log.error ? <ErrorNotice error={log.error} what="the notes" /> : entries.length === 0 ? <p className="muted">No notes yet.</p> : (
            <ul className="feed">
              {entries.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <span className={`dot-badge ${e.kind}`} aria-hidden="true" />
                  <div className="stack" style={{ gap: 4 }}>
                    <p>{e.text}</p>
                    <span className="when">{fmtWhen(e.ts)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Trust u={u} health={health.data} />
    </>
  )
}

function Trust({ u, health }: { u: UserView; health?: Health }) {
  const k = u.apiKey
  const yesNo = (bad: boolean) => <Chip tone={bad ? 'bad' : 'ok'}>{bad ? 'Yes' : 'No'}</Chip>
  return (
    <section className="acard" aria-labelledby="t-trust">
      <div className="acard-head"><h2 id="t-trust">Can Nest run off with my money?</h2></div>
      {u.mode === 'paper' || !u.apiKey ? (
        <p>No. This is a practice account: the $1,000 is pretend money kept by the agent, and no SoDEX key exists for it. Trades are priced from the live SoDEX testnet order books.</p>
      ) : (
        <div className="grid-2" style={{ gap: 20 }}>
          <div className="stack" style={{ gap: 10 }}>
            <p>No. Your money stays in your own SoDEX account. Nest holds a key that can only buy and sell.</p>
            <ul className="checks">
              <li><span>Agent key</span><span className="mono">{k?.name ?? u.apiKeyName}</span></li>
              <li><span>Can buy and sell</span><Chip tone="acc">Yes</Chip></li>
              <li><span>Can withdraw</span>{k ? yesNo(k.canWithdraw) : <span className="muted">not checked yet</span>}</li>
              <li><span>Can transfer</span>{k ? yesNo(k.canTransfer) : <span className="muted">not checked yet</span>}</li>
            </ul>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <p>Check it yourself on SoDEX, without trusting us:</p>
            <ExtLink href={`${apiKeysUrl(u.address)}?accountID=${u.accountId}`}>SoDEX key list for this account</ExtLink>
            <details className="how">
              <summary>How we check this</summary>
              <div>
                <p>SoDEX lists every API key of an account at <code>GET {apiKeysUrl(u.address)}</code>. Nest's key is registered as a permissioned key{k?.permissions !== undefined ? <> with <code>permissions = {k.permissions}</code></> : null}: the withdraw (2), transfer (4) and cancel (8) bits are turned off, which SoDEX enforces on its side.</p>
                {k && <p>Key address <code>{k.publicKey}</code>, read from {k.source}.</p>}
              </div>
            </details>
          </div>
        </div>
      )}
      <p className="hint" style={{ marginTop: 14 }}>
        {health ? (health.enclave
          ? <>The agent runs in a secure enclave (TEE).{health.attestationUrl && <> <ExtLink href={health.attestationUrl}>See the attestation</ExtLink>.</>}</>
          : 'The agent is not running in a secure enclave right now; its keys come from a server secret.') : 'Enclave status unknown while the agent is not answering.'}
      </p>
    </section>
  )
}
