// Node entry: SQLite file, HTTP server, and the check loop. Cloudflare uses worker.ts instead.
import http from 'node:http'
import { createApp, EXCHANGE } from './server.ts'
import { openDb } from './db-node.ts'
import { paperExchange } from './exchange/paper.ts'
import { liveExchange } from './exchange/live.ts'
import { apiKeyFor, inEnclave, journalAccount } from './keys.ts'
import { sosoMode } from './soso.ts'
import { tick } from './loop.ts'

/** Serves a fetch-style handler over node:http. */
export function nodeServer(handle: (req: Request) => Promise<Response>) {
  return http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : Buffer.concat(chunks)
    const r = await handle(new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers: req.headers as HeadersInit, body }))
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()))
  })
}

if (import.meta.main) {
  const PORT = Number(process.env.PORT ?? 8790)
  const LOOP_MS = Number(process.env.LOOP_MS ?? 60_000)
  const db = openDb()
  const { handle, ctx, ensureDemo } = createApp(db, { paper: paperExchange(db), live: liveExchange(a => apiKeyFor(a)) })
  nodeServer(handle).listen(PORT, async () => {
    console.log(`nest agent on :${PORT} · exchange ${EXCHANGE} · data ${sosoMode()} · enclave ${inEnclave()} · journal ${journalAccount().address}`)
    await ensureDemo().catch(e => console.error('demo:', (e as Error).message))
    const loop = () => tick(ctx).catch(e => console.error('tick:', (e as Error).message)).finally(() => setTimeout(loop, LOOP_MS))
    loop()
  })
}
