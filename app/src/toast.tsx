import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Toast = { id: number; kind: 'pending' | 'success' | 'error'; title: string; body?: string }
/** Shows or replaces a toast; null removes the toast with that id. */
type Push = (t: Omit<Toast, 'id'> | null, replace?: number) => number

const Ctx = createContext<Push>(() => 0)
export const useToast = () => useContext(Ctx)

let next = 1

/** Open Bucket's toasts: one pending card that turns into a success or error card. Errors stay until dismissed. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback<Push>((t, replace) => {
    const id = replace ?? next++
    setToasts((all) => (t ? [...all.filter((x) => x.id !== id), { ...t, id }] : all.filter((x) => x.id !== id)))
    if (t?.kind === 'success') setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 6000)
    return id
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon" aria-hidden="true">{t.kind === 'pending' ? <i className="spinner" /> : t.kind === 'success' ? '✓' : '!'}</span>
            <div>
              <strong>{t.title}</strong>
              {t.body && <p>{t.body}</p>}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
