// The few Cloudflare Workers types worker.ts uses (avoids @cloudflare/workers-types fighting @types/node).
declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    ctx: DurableObjectState
    env: Env
    constructor(ctx: DurableObjectState, env: Env)
  }
}
interface DurableObjectState {
  storage: {
    sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[]; rowsWritten: number } }
    transactionSync<T>(fn: () => T): T
    getAlarm(): Promise<number | null>
    setAlarm(time: number): Promise<void>
  }
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
}
interface DurableObjectNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } }
