// HTTP client for the Nest agent (docs/api.md). Types mirror agent/src/types.ts (see ./types.ts).
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { TypedDataDefinition } from 'viem'
import { AGENT_URL } from './config'
import type { Address, Basket, Health, LogEntry, Replay, Signal, UserRules, UserView } from './types.ts'

export * from './types.ts'

/** Thrown for every failed agent call. `offline` means the agent could not be reached at all. */
export class AgentError extends Error {
  status?: number
  offline: boolean
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
    this.offline = status === undefined
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  try {
    r = await fetch(`${AGENT_URL}${path}`, init)
  } catch {
    throw new AgentError(`The Nest agent at ${AGENT_URL} is not reachable.`)
  }
  const text = await r.text()
  let body: unknown
  try { body = text ? JSON.parse(text) : undefined } catch { body = undefined }
  if (!r.ok) throw new AgentError((body as { error?: string } | undefined)?.error ?? (text.trim() || `HTTP ${r.status}`), r.status)
  return body as T
}

const get = <T,>(path: string) => call<T>(path)
const post = <T,>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export type BasketView = { basket: Basket; target: Record<string, number>; signals: Signal[] }
export type Mode = 'live' | 'paper'

/** Agent's answer to link-request: live sends EIP-712 `typedData` to sign, paper a plain `message` (EIP-191). */
export interface LinkRequest {
  apiKeyName: string
  publicKey: Address
  accountId: number
  typedData?: TypedDataJson
  message?: string
  nonce: number
}
/** /health plus the extras the agent server sends beyond the shared Health type. */
export type HealthView = Health & { demoAddress?: Address; sample?: boolean /* scripts/mock-agent.ts only */ }
export interface TypedDataJson {
  domain: Record<string, unknown>
  types: Record<string, { name: string; type: string }[]>
  primaryType: string
  message: Record<string, unknown>
}

export const api = {
  health: () => get<HealthView>('/health'),
  baskets: () => get<BasketView[]>('/baskets'),
  user: async (a: Address) => {
    try { return await get<UserView>(`/users/${a.toLowerCase()}`) } catch (e) {
      if (e instanceof AgentError && e.status === 404) return null
      throw e
    }
  },
  log: (a: Address | undefined, limit = 50) => get<LogEntry[]>(a ? `/users/${a.toLowerCase()}/log?limit=${limit}` : `/log?limit=${limit}`),
  replay: (id: Basket['id'], floorPct: number, drop: number) => get<Replay>(`/replay/${id}?floorPct=${floorPct}&drop=${drop}`),
  linkRequest: (a: Address, body: UserRules & { mode: Mode }) => post<LinkRequest>(`/users/${a.toLowerCase()}/link-request`, body),
  link: (a: Address, body: { signature: string; nonce: number }) => post<UserView>(`/users/${a.toLowerCase()}/link`, body),
  settings: (a: Address, body: object) => post<UserView>(`/users/${a.toLowerCase()}/settings`, body),
}

export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15_000, retry: false })
export const useBaskets = () => useQuery({ queryKey: ['baskets'], queryFn: api.baskets, staleTime: 60_000 })
export const useUser = (a: Address | undefined) =>
  useQuery({ queryKey: ['user', a?.toLowerCase()], queryFn: () => api.user(a!), enabled: !!a, refetchInterval: 15_000 })
export const useLog = (a: Address | undefined, limit = 50) =>
  useQuery({ queryKey: ['log', a?.toLowerCase() ?? 'all', limit], queryFn: () => api.log(a, limit), refetchInterval: 30_000 })
export const useReplay = (id: Basket['id'], floorPct: number, drop: number) =>
  useQuery({ queryKey: ['replay', id, floorPct, drop], queryFn: () => api.replay(id, floorPct, drop), placeholderData: keepPreviousData, staleTime: Infinity })

/** JSON typed data -> viem typed data: uint/int message fields become bigint, domain.chainId a number. */
export function reviveTypedData(td: TypedDataJson): TypedDataDefinition {
  const { EIP712Domain: _d, ...types } = td.types
  void _d
  const fields = types[td.primaryType] ?? []
  const message = { ...td.message }
  for (const f of fields) if (/^u?int\d*$/.test(f.type) && message[f.name] !== undefined) message[f.name] = BigInt(message[f.name] as string | number)
  const domain = { ...td.domain, ...(td.domain.chainId !== undefined ? { chainId: Number(td.domain.chainId) } : {}) }
  return { domain, types, primaryType: td.primaryType, message } as unknown as TypedDataDefinition
}
