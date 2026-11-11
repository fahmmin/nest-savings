// 20px stroke icons for the app navigation (Open Bucket style).
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export const icons = {
  baskets: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h14l-1.6 8.5H4.6L3 8z" {...P} /><path d="M6.5 8L9 3.5M13.5 8L11 3.5" {...P} /></svg>,
  money: <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1.5" {...P} /><rect x="11" y="3" width="6" height="6" rx="1.5" {...P} /><rect x="3" y="11" width="6" height="6" rx="1.5" {...P} /><rect x="11" y="11" width="6" height="6" rx="1.5" {...P} /></svg>,
  activity: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5h10M5 10h10M5 15h6" {...P} /></svg>,
  settings: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h6M14 6h2M4 14h2M10 14h6" {...P} /><circle cx="12" cy="6" r="2" {...P} /><circle cx="8" cy="14" r="2" {...P} /></svg>,
  crash: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5l4.5 4.5 3-3L17 13" {...P} /><path d="M12.5 13H17V8.5" {...P} /></svg>,
  start: <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" {...P} /><path d="M10 7v6M7 10h6" {...P} /></svg>,
  copy: <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" {...P} /><path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" {...P} /></svg>,
  external: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M11 4h5v5M16 4l-7 7" {...P} /></svg>,
  logout: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h3M12 6l4 4-4 4M16 10H8" {...P} /></svg>,
}
