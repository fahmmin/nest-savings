// Root secret and derived keys. Nothing here is logged or stored.
import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { isAddress } from 'viem'
import type { Hex, LocalAccount } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address } from './types.ts'

const DSTACK_SOCK = '/var/run/dstack.sock'
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

export const inEnclave = (): boolean => existsSync(DSTACK_SOCK)

/** dstack guest API: POST /GetKey {path, purpose} over the unix socket -> { key: hex, signature_chain }. */
function dstackKey(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ path, purpose: 'nest-root', algorithm: 'secp256k1' })
    const req = request(
      { socketPath: DSTACK_SOCK, path: '/GetKey', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            const key = String(JSON.parse(data).key ?? '').replace(/^0x/, '')
            if (res.statusCode !== 200 || !/^[0-9a-f]{64,}$/i.test(key)) throw new Error(`dstack GetKey failed (HTTP ${res.statusCode})`)
            resolve(Buffer.from(key, 'hex'))
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

const enclaveRoot = inEnclave() ? await dstackKey('nest/root/v1') : undefined

function root(): Buffer {
  if (enclaveRoot) return enclaveRoot
  const s = process.env.ROOT_SECRET
  if (s) {
    if (s.length < 16) throw new Error('ROOT_SECRET must be at least 16 characters')
    return Buffer.from(s, 'utf8')
  }
  if (process.env.NODE_ENV === 'test') return Buffer.from('nest-test-root-secret', 'utf8')
  throw new Error('ROOT_SECRET is not set and no dstack enclave socket was found. Set ROOT_SECRET for local runs.')
}

/** HMAC-SHA256(root, label) reduced to a valid secp256k1 private key (rehash while 0 or >= n). */
function derive(label: string): Hex {
  let k = createHmac('sha256', root()).update(label).digest()
  while (BigInt('0x' + k.toString('hex')) === 0n || BigInt('0x' + k.toString('hex')) >= N) k = createHash('sha256').update(k).digest()
  return `0x${k.toString('hex')}`
}

export function apiKeyFor(address: Address): { name: string; account: LocalAccount; publicKey: Address } {
  if (!isAddress(address, { strict: false })) throw new Error(`bad address ${address}`)
  const a = address.toLowerCase()
  const account = privateKeyToAccount(derive('api:' + a))
  return { name: 'nest-' + a.slice(2, 10), account, publicKey: account.address }
}

let journal: LocalAccount | undefined
export const journalAccount = (): LocalAccount => (journal ??= privateKeyToAccount(derive('journal')))
