// Signed log entries. The app mirrors canonicalJson + journalDigest to verify entries itself.
import { keccak256, stringToBytes, verifyMessage } from 'viem'
import type { Hex } from 'viem'
import type { LogEntry } from './types.ts'
import { journalAccount } from './keys.ts'

/** JSON with object keys sorted at every level; undefined fields dropped (like JSON.stringify). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

/** keccak256 of the canonical JSON of the entry without its signature (signer included). */
export const journalDigest = (entry: Omit<LogEntry, 'signature'>): Hex => keccak256(stringToBytes(canonicalJson(entry)))

/** Adds signer + EIP-191 personal_sign over the 32 digest bytes. */
export async function signEntry(entry: Omit<LogEntry, 'signature' | 'signer'>): Promise<LogEntry> {
  const account = journalAccount()
  const unsigned = { ...entry, signer: account.address }
  const signature = await account.signMessage({ message: { raw: journalDigest(unsigned) } })
  return { ...unsigned, signature }
}

export async function verifyEntry(entry: LogEntry): Promise<boolean> {
  const { signature, ...rest } = entry
  try {
    return await verifyMessage({ address: entry.signer, message: { raw: journalDigest(rest) }, signature })
  } catch {
    return false
  }
}
