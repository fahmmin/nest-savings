// Journal verification in the browser. Mirrors agent/src/journal.ts exactly (canonicalJson + journalDigest); keep in sync.
//   payload   = the LogEntry without `signature` (`signer`, `id`, `ts` and every other field included)
//   digest    = keccak256(utf8(canonicalJson(payload))), keys sorted at every level, undefined fields dropped
//   signature = EIP-191 personal_sign over the 32 raw digest bytes by the journal key
// Pure (viem only): unit tested, and scripts/mock-agent.ts signs its sample entries with it.
import { keccak256, recoverMessageAddress, stringToBytes, type Hex } from 'viem'
import type { Address, LogEntry } from './types.ts'

/** JSON with object keys sorted at every level; undefined fields dropped (like JSON.stringify). Same code as the agent. */
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

export type Verdict = 'verified' | 'wrong-signer' | 'invalid'

/** Recovers the signer of an entry and compares it with the agent's published journal signer from /health. */
export async function verifyEntry(entry: LogEntry, journalSigner: Address): Promise<Verdict> {
  const { signature, ...rest } = entry
  try {
    const signer = await recoverMessageAddress({ message: { raw: journalDigest(rest) }, signature })
    return signer.toLowerCase() === journalSigner.toLowerCase() ? 'verified' : 'wrong-signer'
  } catch {
    return 'invalid'
  }
}
