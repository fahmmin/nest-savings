// Cloudflare entry: one Durable Object holds the SQLite data and runs the check loop on its alarm.
// Node uses main.ts instead; both serve the same createApp() routes.
import { DurableObject } from 'cloudflare:workers'
import { migrate, type Db } from './db.ts'
import { createApp } from './server.ts'
import { paperExchange } from './exchange/paper.ts'
import { liveExchange } from './exchange/live.ts'
import { apiKeyFor } from './keys.ts'
import { tick } from './loop.ts'

interface Env { NEST: DurableObjectNamespace; LOOP_MS?: string }

/** Durable Object SQLite behind the same small interface as node:sqlite. */
function doDb(storage: DurableObjectState['storage']): Db {
  return {
    exec: q => { storage.sql.exec(q) },
    prepare: q => ({
      run: (...p) => ({ changes: storage.sql.exec(q, ...p).rowsWritten }),
      get: (...p) => storage.sql.exec(q, ...p).toArray()[0],
      all: (...p) => storage.sql.exec(q, ...p).toArray(),
    }),
    transaction: fn => storage.transactionSync(fn),
  }
}

export class NestAgent extends DurableObject<Env> {
  app: ReturnType<typeof createApp>
  loopMs: number

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.loopMs = Number(env.LOOP_MS ?? 60_000)
    const db = doDb(ctx.storage)
    migrate(db)
    this.app = createApp(db, { paper: paperExchange(db), live: liveExchange(a => apiKeyFor(a)) })
    ctx.blockConcurrencyWhile(async () => {
      await this.app.ensureDemo().catch(e => console.error('demo:', (e as Error).message))
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + this.loopMs)
    })
  }

  fetch(req: Request) { return this.app.handle(req) }

  async alarm() {
    try { await tick(this.app.ctx) } catch (e) { console.error('tick:', (e as Error).message) }
    await this.ctx.storage.setAlarm(Date.now() + this.loopMs)
  }
}

export default {
  fetch: (req: Request, env: Env) => env.NEST.get(env.NEST.idFromName('nest')).fetch(req),
}
