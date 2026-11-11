import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { useHealth, useLog, type Address, type LogEntry } from '../api'
import { journalDigest, verifyEntry } from '../journal'
import { assetName, fmtUsd, fmtWhen, short } from '../format'
import { Chip, ErrorNotice, ExtLink, Skeleton, useViewAs } from '../ui'

const KIND: Record<LogEntry['kind'], string> = {
  link: 'Started', rebalance: 'Rebalanced', exit: 'Moved to dollars', hold: 'No change needed', skip: 'Skipped a trade', settings: 'Settings changed', resume: 'Resumed',
}
const FILL: Record<string, string> = { filled: 'Done', partial: 'Partly done', rejected: 'Refused', skipped: 'Skipped' }

function Verified({ entry, signer }: { entry: LogEntry; signer?: Address }) {
  const v = useQuery({ queryKey: ['verify', entry.id, entry.signature, signer], queryFn: () => verifyEntry(entry, signer!), enabled: !!signer, staleTime: Infinity })
  if (!signer) return <Chip tone="plain">Not checked</Chip>
  if (!v.data) return <Chip tone="plain">Checking</Chip>
  return v.data === 'verified' ? <Chip tone="ok">Verified</Chip> : <Chip tone="bad">{v.data === 'wrong-signer' ? 'Not signed by Nest' : 'Bad signature'}</Chip>
}

function Entry({ e, signer, showWho }: { e: LogEntry; signer?: Address; showWho: boolean }) {
  return (
    <li>
      <span className={`dot-badge ${e.kind}`} aria-hidden="true" />
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="what"><strong>{KIND[e.kind]}</strong><Verified entry={e} signer={signer} /></div>
        <p>{e.text}</p>
        {e.fills.length > 0 && (
          <div className="table-scroll">
            <table className="fills">
              <caption className="sr-only">Trades</caption>
              <thead><tr><th scope="col">Asset</th><th scope="col">Side</th><th scope="col">Amount</th><th scope="col">Price</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {e.fills.map((f, i) => (
                  <tr key={i}>
                    <td>{assetName(f.order.symbol)}</td>
                    <td>{f.order.side === 'buy' ? 'Bought' : 'Sold'}</td>
                    <td className="num">{f.status === 'filled' || f.status === 'partial' ? fmtUsd(f.filledQty * f.avgPrice) : `${fmtUsd(f.order.notional)} planned`}</td>
                    <td className="num">{f.avgPrice ? fmtUsd(f.avgPrice) : '–'}</td>
                    <td title={f.error}>{FILL[f.status]}{f.error ? `: ${f.error}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="meta">
          <span className="when">{fmtWhen(e.ts)}</span>
          <span>Value after: <b className="num">{fmtUsd(e.valueUsd)}</b></span>
          {showWho && <a href={`#home-${e.address}`}>{short(e.address)}</a>}
          {e.sources.map((s) => <ExtLink key={s.url + s.label} href={s.url}>{s.label}</ExtLink>)}
        </div>
      </div>
    </li>
  )
}

export function Activity() {
  const { address: connected } = useAccount()
  const viewAs = useViewAs()
  const mine = viewAs ?? connected
  const [who, setWho] = useState<'mine' | 'all'>(mine ? 'mine' : 'all')
  const scope = who === 'mine' && mine ? mine : undefined
  const log = useLog(scope, 200)
  const health = useHealth()
  const signer = health.data?.journalSigner
  return (
    <>
      <div className="page-head">
        <h1>Everything the agent did</h1>
        <p>Every check, trade and settings change, in plain words with its sources. Each note is signed by Nest's journal key, and your browser checks that signature itself.</p>
      </div>
      {mine && (
        <div className="btn-row" role="group" aria-label="Whose notes">
          <button type="button" className={who === 'mine' ? 'abtn small' : 'btn small'} aria-pressed={who === 'mine'} onClick={() => setWho('mine')}>{viewAs ? short(viewAs) : 'Mine'}</button>
          <button type="button" className={who === 'all' ? 'abtn small' : 'btn small'} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone (public record)</button>
        </div>
      )}
      <section className="acard" aria-label="Notes">
        {log.isLoading ? <Skeleton lines={5} label="Loading notes" /> : log.error ? <ErrorNotice error={log.error} what="the notes" />
          : !log.data?.length ? <p className="muted">No notes yet.</p>
          : <ul className="feed">{log.data.map((e) => <Entry key={e.id} e={e} signer={signer} showWho={!scope} />)}</ul>}
      </section>
      <details className="how">
        <summary>How we check this</summary>
        <div>
          <p>For each note your browser rebuilds its fingerprint: <code>keccak256</code> of the note as JSON with keys sorted, without its <code>signature</code>. It then recovers who signed that fingerprint (EIP-191 personal sign) and compares it with the journal signer the agent publishes at <code>/health</code>{signer ? <>: <code>{signer}</code></> : null}.</p>
          {log.data?.[0] && <p>Newest note fingerprint: <code>{journalDigest(log.data[0])}</code></p>}
          <p>"Verified" means the note is exactly what Nest signed. It does not mean the agent was right, only that nobody edited the record afterwards.</p>
        </div>
      </details>
    </>
  )
}
